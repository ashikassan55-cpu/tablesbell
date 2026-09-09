'use server';

/**
 * src/server/actions/table.actions.ts
 *
 * Manager Table Management (ARCHITECTURE.md §1.6, §8.1). Two actions,
 * both `tb_staff`-cookie-verified and `canManageTables`-gated
 * (`manager` / `owner`), Admin SDK — `tables/{tableId}` and the root
 * `tableSlugs/{slug}` are BOTH `allow write: if false` in
 * `firestore.rules`, so a client can never do this.
 *
 *   upsertTable      -- create a table (mint its cryptographic slug + the
 *                       `tableSlugs/{slug}` mapping) or edit an existing
 *                       one's code / label / zone / capacity / status.
 *   rotateTableSlug  -- §8.1 rotation: mint a fresh slug, flip the old
 *                       mapping `active: false` (old QR now resolves to
 *                       the generic invalid page, never a redirect), bump
 *                       `slugVersion`. For a photographed / leaked QR.
 *
 * WHY THE SLUG, NOT `/{tenantSlug}/{branchSlug}?table={tableId}`: §8.1 is
 * explicit that a semantic guest URL (`/t/alserkal/T-04`) is trivially
 * enumerable — table 4 implies 1–24, and the tenant name is public. The
 * guest boot URL is `/t/{opaque 12-char slug}` and nothing else; the QR
 * exporter encodes exactly that. `tableId` never appears in a guest-
 * reachable URL.
 */

import { cookies } from 'next/headers';
import { adminDb } from '@/lib/firebase/admin';
import { verifyStaffSessionToken, STAFF_SESSION_COOKIE_NAME } from '@/server/auth/staff-session-cookie';
import { canManageTables } from '@/lib/console/staff-permissions';
import { generateTableSlug } from '@/server/services/slug.service';
import type { Table, TableSlugDoc } from '@/types/firestore';

const MAX_CODE = 24;
const MAX_LABEL = 60;
const MAX_ZONE = 40;
const MIN_SEATS = 1;
const MAX_SEATS = 99;
const ID_RE = /^[A-Za-z0-9][A-Za-z0-9_-]{1,63}$/;
const EDITABLE_STATUSES = new Set<Table['status']>(['available', 'disabled']);

function cleanText(value: unknown, max: number): string {
  if (typeof value !== 'string') return '';
  let out = '';
  for (const ch of value) {
    const code = ch.codePointAt(0) ?? 0;
    out += code < 0x20 || (code >= 0x7f && code <= 0x9f) ? ' ' : ch;
  }
  return out.replace(/\s+/g, ' ').trim().slice(0, max);
}

function cleanSeats(value: unknown): number {
  const n = typeof value === 'number' ? value : Number(value);
  if (!Number.isFinite(n)) return 2;
  return Math.min(MAX_SEATS, Math.max(MIN_SEATS, Math.trunc(n)));
}

interface TableManagerAuth {
  ok: true;
  tenantId: string;
  branchId: string;
  uid: string;
  branchPath: string;
}

async function verifyTableManager(
  branchId: string,
): Promise<TableManagerAuth | { ok: false; reason: string }> {
  if (typeof branchId !== 'string' || branchId.length === 0 || branchId.length > 128) {
    return { ok: false, reason: 'INVALID_BRANCH' };
  }
  const cookieStore = await cookies();
  const token = cookieStore.get(STAFF_SESSION_COOKIE_NAME)?.value;
  const session = token ? await verifyStaffSessionToken(token) : null;
  if (!session) return { ok: false, reason: 'NOT_AUTHENTICATED' };
  if (!session.bids.includes(branchId)) return { ok: false, reason: 'BRANCH_NOT_AUTHORIZED' };
  if (!canManageTables({ role: session.role, overrideAuth: session.overrideAuth })) {
    return { ok: false, reason: 'ROLE_NOT_PERMITTED' };
  }
  return {
    ok: true,
    tenantId: session.tid,
    branchId,
    uid: session.uid,
    branchPath: `tenants/${session.tid}/branches/${branchId}`,
  };
}

// --- upsertTable -----------------------------------------------------

export interface UpsertTableInput {
  branchId: string;
  /** Omit to create; provide to edit. */
  tableId?: string;
  /** The table number — "T-04", "12", "Bar 3". */
  code: string;
  /** Display label; falls back to `code` when blank. */
  label?: string;
  /** Section / zone — free text ("Indoor", "Terrace"). Blank allowed. */
  zoneId?: string;
  /** Capacity. */
  seats?: number;
  status: 'available' | 'disabled';
}

export type UpsertTableResult =
  | { outcome: 'created'; tableId: string; slug: string }
  | { outcome: 'updated'; tableId: string; slug: string }
  | { outcome: 'rejected'; reason: string };

export async function upsertTable(input: UpsertTableInput): Promise<UpsertTableResult> {
  const auth = await verifyTableManager(input.branchId);
  if (!auth.ok) return { outcome: 'rejected', reason: auth.reason };

  const code = cleanText(input.code, MAX_CODE);
  if (code.length === 0) return { outcome: 'rejected', reason: 'CODE_REQUIRED' };
  const label = cleanText(input.label, MAX_LABEL) || code;
  const zoneId = cleanText(input.zoneId, MAX_ZONE);
  const seats = cleanSeats(input.seats);
  if (!EDITABLE_STATUSES.has(input.status)) return { outcome: 'rejected', reason: 'INVALID_STATUS' };
  const status = input.status;

  // ---- EDIT ----
  if (typeof input.tableId === 'string' && input.tableId.length > 0) {
    if (!ID_RE.test(input.tableId)) return { outcome: 'rejected', reason: 'INVALID_TABLE_ID' };
    const tableRef = adminDb.doc(`${auth.branchPath}/tables/${input.tableId}`);

    return adminDb.runTransaction(async (tx): Promise<UpsertTableResult> => {
      const snap = await tx.get(tableRef);
      if (!snap.exists) return { outcome: 'rejected', reason: 'TABLE_NOT_FOUND' };
      const existing = snap.data() as Table;
      // Only the manager-editable fields — never `slug`, `parties`,
      // `partyCount`, `activeCall`, … which belong to the ops runtime.
      tx.update(tableRef, { code, label, zoneId, seats, status });
      return { outcome: 'updated', tableId: input.tableId as string, slug: existing.slug };
    });
  }

  // ---- CREATE ----
  // `sortIndex` from a non-transactional pre-read: a tie between two
  // simultaneous creates is cosmetic (the grid just `orderBy`s it).
  const existingSnap = await adminDb.collection(`${auth.branchPath}/tables`).get();
  const nextSortIndex = existingSnap.docs.reduce((max, d) => {
    const s = (d.data() as { sortIndex?: number }).sortIndex;
    return typeof s === 'number' && s > max ? s : max;
  }, -1) + 1;

  const tableRef = adminDb.collection(`${auth.branchPath}/tables`).doc();
  const tableId = tableRef.id;
  const slug = generateTableSlug();
  const slugRef = adminDb.doc(`tableSlugs/${slug}`);

  return adminDb.runTransaction(async (tx): Promise<UpsertTableResult> => {
    const slugSnap = await tx.get(slugRef);
    if (slugSnap.exists) {
      // ~1 in 58^12 — a retry mints a different slug.
      return { outcome: 'rejected', reason: 'SLUG_COLLISION' };
    }

    const newTable: Table = {
      code,
      label,
      zoneId,
      seats,
      sortIndex: nextSortIndex,
      status,
      slug,
      slugVersion: 1,
      slugRotatedAt: null,
      parties: [],
      partyCount: 0,
      openTabFils: 0,
      activeCall: null,
      assignedServerUid: null,
      lastSanitizedAt: null,
      nfcTagId: null,
    };
    tx.set(tableRef, newTable);

    const slugDoc: TableSlugDoc = {
      tenantId: auth.tenantId,
      branchId: auth.branchId,
      tableId,
      version: 1,
      active: true,
    };
    tx.set(slugRef, slugDoc);

    return { outcome: 'created', tableId, slug };
  });
}

// --- rotateTableSlug ------------------------------------------------

export interface RotateTableSlugInput {
  branchId: string;
  tableId: string;
}

export type RotateTableSlugResult =
  | { outcome: 'rotated'; slug: string; version: number }
  | { outcome: 'rejected'; reason: string };

export async function rotateTableSlug(input: RotateTableSlugInput): Promise<RotateTableSlugResult> {
  const auth = await verifyTableManager(input.branchId);
  if (!auth.ok) return { outcome: 'rejected', reason: auth.reason };
  if (typeof input.tableId !== 'string' || !ID_RE.test(input.tableId)) {
    return { outcome: 'rejected', reason: 'INVALID_TABLE_ID' };
  }

  const tableRef = adminDb.doc(`${auth.branchPath}/tables/${input.tableId}`);
  const newSlug = generateTableSlug();
  const newSlugRef = adminDb.doc(`tableSlugs/${newSlug}`);

  return adminDb.runTransaction(async (tx): Promise<RotateTableSlugResult> => {
    const tableSnap = await tx.get(tableRef);
    if (!tableSnap.exists) return { outcome: 'rejected', reason: 'TABLE_NOT_FOUND' };
    const table = tableSnap.data() as Table;

    const newSlugSnap = await tx.get(newSlugRef);
    if (newSlugSnap.exists) return { outcome: 'rejected', reason: 'SLUG_COLLISION' };

    const oldSlugRef = table.slug ? adminDb.doc(`tableSlugs/${table.slug}`) : null;
    const oldSlugSnap = oldSlugRef ? await tx.get(oldSlugRef) : null;

    const nextVersion = (typeof table.slugVersion === 'number' ? table.slugVersion : 1) + 1;
    const nowMs = Date.now();

    tx.update(tableRef, { slug: newSlug, slugVersion: nextVersion, slugRotatedAt: nowMs });

    if (oldSlugRef && oldSlugSnap?.exists) {
      // Rotated-away-from → resolves as `not_found`, identical to a slug
      // that never existed (§8.1 uniform failure). Never deleted — an
      // audit trail of retired slugs.
      tx.update(oldSlugRef, { active: false });
    }

    const slugDoc: TableSlugDoc = {
      tenantId: auth.tenantId,
      branchId: auth.branchId,
      tableId: input.tableId,
      version: nextVersion,
      active: true,
    };
    tx.set(newSlugRef, slugDoc);

    return { outcome: 'rotated', slug: newSlug, version: nextVersion };
  });
}
