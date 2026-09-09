'use server';

/**
 * src/server/actions/menu.actions.ts
 *
 * The Manager Menu Maker's write surface (DECISIONS.md ADR-8). Three
 * actions, all `tb_staff`-cookie-verified and `canManageMenu`-gated
 * (`manager` / `owner` only — the same `hasRole(['owner','manager'])`
 * line `firestore.rules` draws for the `menuDraft` doc and every other
 * back-office collection):
 *
 *   seedMenuDraft  -- create `menuDraft/current` from the branch's current
 *                     live `menuPublished/v{n}` (or empty, if none). No-op
 *                     if a draft already exists.
 *   saveMenuDraft  -- replace the draft's whole `categories` tree with a
 *                     re-validated, re-sanitised copy of what the editor
 *                     sent. Last-write-wins (single-editor assumption).
 *   publishMenu    -- snapshot the draft into `menuPublished/v{n+1}`, bump
 *                     `branches/{b}.menuVersion`, and stamp the draft's
 *                     `lastPublishedVersion`. One transaction.
 *
 * WHY A DRAFT DOC, NOT DIRECT `menuPublished` EDITS: a price a manager is
 * still typing must not reach a guest or a kitchen ticket. The draft is
 * owner/manager-only (never guest-readable); only `publishMenu` promotes
 * it, deliberately, to a NEW version — `order.service.ts` prices against
 * whatever `branches/{b}.menuVersion` points at, and a guest mid-meal
 * keeps the version their page loaded (price stability), picking up the
 * new menu on their next navigation. That "new menu on next load, not
 * mid-session" behaviour is the same one `menu-version.ts` already
 * documents; it is intentional, not a limitation of this action.
 *
 * NOT BUILT HERE (skeleton scope): modifier-group editing in the UI
 * (existing groups are preserved untouched through save/publish), item
 * images, per-branch menu divergence beyond the version pointer, and any
 * `menuItems/{itemId}` normalised collection (§1.5) — the draft tree is
 * the single source of truth for now.
 */

import { cookies } from 'next/headers';
import { adminDb } from '@/lib/firebase/admin';
import { verifyStaffSessionToken, STAFF_SESSION_COOKIE_NAME } from '@/server/auth/staff-session-cookie';
import { canManageMenu } from '@/lib/console/staff-permissions';
import type {
  LocalizedText,
  MenuItem,
  MenuItemStatus,
  ModifierGroup,
  ModifierOption,
  MenuTreeCategory,
  MenuDraftDoc,
  MenuPublishedDoc,
} from '@/types/firestore';

const DRAFT_DOC_ID = 'current';

const MAX_CATEGORIES = 40;
const MAX_ITEMS_PER_CATEGORY = 150;
const MAX_TOTAL_ITEMS = 800;
const MAX_GROUPS_PER_ITEM = 20;
const MAX_OPTIONS_PER_GROUP = 40;
const MAX_TEXT = 120;
const MAX_SKU = 60;
const MAX_STATION = 40;
const MAX_PRICE_FILS = 1_000_000; // AED 10,000 — a sane ceiling, not a real menu price
const MIN_PRICE_DELTA = -100_000;
const MAX_PRICE_DELTA = 100_000;

const ID_RE = /^[A-Za-z0-9][A-Za-z0-9_-]{1,63}$/;
const ITEM_STATUSES: readonly MenuItemStatus[] = ['active', 'draft', 'archived'];

/**
 * Staff-entered display text hygiene: drop C0 (< 0x20) and C1
 * (0x7F..0x9F) control characters — the same bytes `order.service.ts`'s
 * Layer-2 pass strips (ESC-POS / bidi safety), kept light here — then
 * collapse whitespace runs and cap the length. Done with a code-point
 * scan rather than a regex so the source carries no literal control
 * bytes.
 */
function cleanText(value: unknown, max: number): string {
  if (typeof value !== 'string') return '';
  let out = '';
  for (const ch of value) {
    const code = ch.codePointAt(0) ?? 0;
    out += code < 0x20 || (code >= 0x7f && code <= 0x9f) ? ' ' : ch;
  }
  return out.replace(/\s+/g, ' ').trim().slice(0, max);
}

function cleanLocalized(value: unknown): LocalizedText | null {
  const v = (value ?? {}) as Record<string, unknown>;
  const en = cleanText(v.en, MAX_TEXT);
  const ar = cleanText(v.ar, MAX_TEXT);
  if (en.length === 0) return null; // `en` is the required display string everywhere downstream
  return { en, ar };
}

function cleanInt(value: unknown, min: number, max: number, fallback: number): number {
  const n = typeof value === 'number' ? value : Number(value);
  if (!Number.isFinite(n)) return fallback;
  return Math.min(max, Math.max(min, Math.trunc(n)));
}

type SanitizeOk = { ok: true; categories: MenuTreeCategory[] };
type SanitizeErr = { ok: false; reason: string };

function sanitizeOptions(raw: unknown): ModifierOption[] {
  if (!Array.isArray(raw)) return [];
  const out: ModifierOption[] = [];
  for (const entry of raw.slice(0, MAX_OPTIONS_PER_GROUP)) {
    const o = (entry ?? {}) as Record<string, unknown>;
    const id = typeof o.id === 'string' && ID_RE.test(o.id) ? o.id : null;
    const name = cleanLocalized(o.name);
    if (!id || !name) continue;
    out.push({
      id,
      name,
      priceDeltaFils: cleanInt(o.priceDeltaFils, MIN_PRICE_DELTA, MAX_PRICE_DELTA, 0),
      isDefault: o.isDefault === true,
      // Availability is the Stock Board's concern (`live/availability`),
      // never the menu tree's — always published `true`.
      available: true,
    });
  }
  return out;
}

function sanitizeGroups(raw: unknown): ModifierGroup[] {
  if (!Array.isArray(raw)) return [];
  const out: ModifierGroup[] = [];
  for (const entry of raw.slice(0, MAX_GROUPS_PER_ITEM)) {
    const g = (entry ?? {}) as Record<string, unknown>;
    const id = typeof g.id === 'string' && ID_RE.test(g.id) ? g.id : null;
    const name = cleanLocalized(g.name);
    if (!id || !name) continue;
    const options = sanitizeOptions(g.options);
    const minSelect = cleanInt(g.minSelect, 0, MAX_OPTIONS_PER_GROUP, 0);
    const maxSelect = cleanInt(g.maxSelect, minSelect, MAX_OPTIONS_PER_GROUP, Math.max(minSelect, 1));
    out.push({ id, name, minSelect, maxSelect, required: g.required === true, options });
  }
  return out;
}

function sanitizeCategories(raw: unknown): SanitizeOk | SanitizeErr {
  if (!Array.isArray(raw)) return { ok: false, reason: 'NOT_AN_ARRAY' };
  if (raw.length > MAX_CATEGORIES) return { ok: false, reason: 'TOO_MANY_CATEGORIES' };

  const seenCategoryIds = new Set<string>();
  const seenItemIds = new Set<string>();
  let totalItems = 0;
  const categories: MenuTreeCategory[] = [];

  for (let i = 0; i < raw.length; i += 1) {
    const c = (raw[i] ?? {}) as Record<string, unknown>;
    const id = typeof c.id === 'string' && ID_RE.test(c.id) ? c.id : null;
    const name = cleanLocalized(c.name);
    if (!id) return { ok: false, reason: `CATEGORY_${i}_BAD_ID` };
    if (!name) return { ok: false, reason: `CATEGORY_${i}_NAME_REQUIRED` };
    if (seenCategoryIds.has(id)) return { ok: false, reason: `CATEGORY_${id}_DUPLICATE` };
    seenCategoryIds.add(id);

    const rawItems = Array.isArray(c.items) ? c.items : [];
    if (rawItems.length > MAX_ITEMS_PER_CATEGORY) return { ok: false, reason: `CATEGORY_${id}_TOO_MANY_ITEMS` };

    const items: MenuItem[] = [];
    for (let j = 0; j < rawItems.length; j += 1) {
      const it = (rawItems[j] ?? {}) as Record<string, unknown>;
      const itemId = typeof it.id === 'string' && ID_RE.test(it.id) ? it.id : null;
      const itemName = cleanLocalized(it.name);
      if (!itemId) return { ok: false, reason: `ITEM_${id}_${j}_BAD_ID` };
      if (!itemName) return { ok: false, reason: `ITEM_${itemId}_NAME_REQUIRED` };
      if (seenItemIds.has(itemId)) return { ok: false, reason: `ITEM_${itemId}_DUPLICATE` };
      seenItemIds.add(itemId);

      const status = ITEM_STATUSES.includes(it.status as MenuItemStatus)
        ? (it.status as MenuItemStatus)
        : 'active';

      items.push({
        id: itemId,
        categoryId: id, // structural membership, kept in sync on every write
        sku: cleanText(it.sku, MAX_SKU),
        name: itemName,
        priceFils: cleanInt(it.priceFils, 0, MAX_PRICE_FILS, 0),
        stationId: cleanText(it.stationId, MAX_STATION) || 'kitchen',
        status,
        modifierGroups: sanitizeGroups(it.modifierGroups),
      });
      totalItems += 1;
      if (totalItems > MAX_TOTAL_ITEMS) return { ok: false, reason: 'TOO_MANY_ITEMS_TOTAL' };
    }

    categories.push({
      id,
      name,
      sortIndex: cleanInt(c.sortIndex, 0, 9_999, i),
      items,
    });
  }

  categories.sort((a, b) => a.sortIndex - b.sortIndex || a.id.localeCompare(b.id));
  return { ok: true, categories };
}

/** Map a stored `menuPublished/v{n}` doc's categories into the editable
 *  tree shape, tolerating older docs that predate `name` / `sortIndex`. */
function publishedToTree(published: unknown): MenuTreeCategory[] {
  const cats = (published as { categories?: unknown })?.categories;
  if (!Array.isArray(cats)) return [];
  const remapped = cats.map((c, i) => {
    const cat = (c ?? {}) as Record<string, unknown>;
    const rawName = (cat.name ?? {}) as Record<string, unknown>;
    const en =
      typeof rawName.en === 'string' && rawName.en.trim().length > 0
        ? rawName.en
        : String(cat.id ?? `Category ${i + 1}`);
    return {
      ...cat,
      name: { en, ar: typeof rawName.ar === 'string' ? rawName.ar : '' },
      sortIndex: typeof cat.sortIndex === 'number' ? cat.sortIndex : i,
    };
  });
  const sanitized = sanitizeCategories(remapped);
  return sanitized.ok ? sanitized.categories : [];
}

interface ManagerAuth {
  ok: true;
  uid: string;
  branchPath: string;
}

async function verifyMenuManager(branchId: string): Promise<ManagerAuth | { ok: false; reason: string }> {
  if (typeof branchId !== 'string' || branchId.length === 0 || branchId.length > 128) {
    return { ok: false, reason: 'INVALID_BRANCH' };
  }
  const cookieStore = await cookies();
  const token = cookieStore.get(STAFF_SESSION_COOKIE_NAME)?.value;
  const session = token ? await verifyStaffSessionToken(token) : null;
  if (!session) return { ok: false, reason: 'NOT_AUTHENTICATED' };
  if (!session.bids.includes(branchId)) return { ok: false, reason: 'BRANCH_NOT_AUTHORIZED' };
  if (!canManageMenu({ role: session.role, overrideAuth: session.overrideAuth })) {
    return { ok: false, reason: 'ROLE_NOT_PERMITTED' };
  }
  return { ok: true, uid: session.uid, branchPath: `tenants/${session.tid}/branches/${branchId}` };
}

// --- seedMenuDraft -----------------------------------------------------

export interface SeedMenuDraftInput {
  branchId: string;
}

export type SeedMenuDraftResult =
  | { outcome: 'seeded'; fromVersion: number; categoryCount: number }
  | { outcome: 'exists' }
  | { outcome: 'rejected'; reason: string };

export async function seedMenuDraft(input: SeedMenuDraftInput): Promise<SeedMenuDraftResult> {
  const auth = await verifyMenuManager(input.branchId);
  if (!auth.ok) return { outcome: 'rejected', reason: auth.reason };

  const draftRef = adminDb.doc(`${auth.branchPath}/menuDraft/${DRAFT_DOC_ID}`);
  const draftSnap = await draftRef.get();
  if (draftSnap.exists) return { outcome: 'exists' };

  const branchSnap = await adminDb.doc(auth.branchPath).get();
  const liveVersion = Number((branchSnap.data() as { menuVersion?: number } | undefined)?.menuVersion) || 1;

  const publishedSnap = await adminDb.doc(`${auth.branchPath}/menuPublished/v${liveVersion}`).get();
  const categories = publishedSnap.exists ? publishedToTree(publishedSnap.data()) : [];

  const draft: MenuDraftDoc = {
    updatedAt: Date.now(),
    updatedByUid: auth.uid,
    lastPublishedVersion: publishedSnap.exists ? liveVersion : 0,
    categories,
  };
  await draftRef.set(draft);

  return {
    outcome: 'seeded',
    fromVersion: publishedSnap.exists ? liveVersion : 0,
    categoryCount: categories.length,
  };
}

// --- saveMenuDraft ---------------------------------------------------

export interface SaveMenuDraftInput {
  branchId: string;
  categories: unknown;
}

export type SaveMenuDraftResult =
  | { outcome: 'saved'; categoryCount: number; itemCount: number }
  | { outcome: 'rejected'; reason: string };

export async function saveMenuDraft(input: SaveMenuDraftInput): Promise<SaveMenuDraftResult> {
  const auth = await verifyMenuManager(input.branchId);
  if (!auth.ok) return { outcome: 'rejected', reason: auth.reason };

  const sanitized = sanitizeCategories(input.categories);
  if (!sanitized.ok) return { outcome: 'rejected', reason: `INVALID_MENU:${sanitized.reason}` };

  const draftRef = adminDb.doc(`${auth.branchPath}/menuDraft/${DRAFT_DOC_ID}`);
  const existing = (await draftRef.get()).data() as MenuDraftDoc | undefined;

  const draft: MenuDraftDoc = {
    updatedAt: Date.now(),
    updatedByUid: auth.uid,
    lastPublishedVersion: existing?.lastPublishedVersion ?? 0,
    categories: sanitized.categories,
  };
  await draftRef.set(draft);

  const itemCount = sanitized.categories.reduce((n, c) => n + c.items.length, 0);
  return { outcome: 'saved', categoryCount: sanitized.categories.length, itemCount };
}

// --- publishMenu ---------------------------------------------------

export interface PublishMenuInput {
  branchId: string;
}

export type PublishMenuResult =
  | { outcome: 'published'; version: number; categoryCount: number; itemCount: number }
  | { outcome: 'rejected'; reason: string };

export async function publishMenu(input: PublishMenuInput): Promise<PublishMenuResult> {
  const auth = await verifyMenuManager(input.branchId);
  if (!auth.ok) return { outcome: 'rejected', reason: auth.reason };

  const draftRef = adminDb.doc(`${auth.branchPath}/menuDraft/${DRAFT_DOC_ID}`);
  const branchRef = adminDb.doc(auth.branchPath);

  return adminDb.runTransaction(async (tx): Promise<PublishMenuResult> => {
    const [draftSnap, branchSnap] = await Promise.all([tx.get(draftRef), tx.get(branchRef)]);

    if (!draftSnap.exists) return { outcome: 'rejected', reason: 'NO_DRAFT' };
    const draft = draftSnap.data() as MenuDraftDoc;

    const sanitized = sanitizeCategories(draft.categories);
    if (!sanitized.ok) return { outcome: 'rejected', reason: `INVALID_MENU:${sanitized.reason}` };

    const itemCount = sanitized.categories.reduce((n, c) => n + c.items.length, 0);
    if (sanitized.categories.length === 0 || itemCount === 0) {
      // Publishing an empty menu would leave the guest surface with
      // nothing orderable — a mistake, not an intent.
      return { outcome: 'rejected', reason: 'EMPTY_MENU' };
    }

    const currentVersion = Math.max(
      Number((branchSnap.data() as { menuVersion?: number } | undefined)?.menuVersion) || 0,
      draft.lastPublishedVersion || 0,
    );
    const nextVersion = currentVersion + 1;

    const publishedDoc: MenuPublishedDoc = {
      version: nextVersion,
      publishedAt: Date.now(),
      publishedByUid: auth.uid,
      categories: sanitized.categories,
    };

    tx.set(adminDb.doc(`${auth.branchPath}/menuPublished/v${nextVersion}`), publishedDoc);
    tx.set(branchRef, { menuVersion: nextVersion }, { merge: true });
    tx.update(draftRef, { lastPublishedVersion: nextVersion });

    return {
      outcome: 'published',
      version: nextVersion,
      categoryCount: sanitized.categories.length,
      itemCount,
    };
  });
}
