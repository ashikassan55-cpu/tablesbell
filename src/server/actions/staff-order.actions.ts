'use server';

/**
 * src/server/actions/staff-order.actions.ts
 *
 * `placeStaffOrder` — the Waiter Floor's real "Send to Kitchen", replacing
 * the `submitStaffOrder` mock in `waiter-menu-entry.tsx`.
 *
 * DESIGN REVERSAL — DECISIONS.md ADR-6. The prior plan (this action's
 * long-standing header comment in `waiter-menu-entry.tsx`, and MEMORY.md)
 * was for a staff order to write DIRECTLY to `orders`, re-implementing the
 * `resolveAndPriceLines()` / `splitInclusive()` orchestration inline. That
 * was decided BEFORE the `orderRequests` → `priceOrderRequestTrigger` →
 * `orders` pipeline was actually built. It exists now. So this action
 * writes an `orderRequests` document (Admin SDK — NOT bound by the
 * `isGuest`-gated create rule that blocks a guest *client* from that
 * write) and lets the ONE existing price authority run. No second
 * pricing path, no duplicated money math.
 *
 * The only concession `priceOrderRequest` makes for a staff request is a
 * `placedBy: { kind: 'staff', uid }` marker on the doc: it skips the
 * party-membership check (a waiter is not a party member) and stamps the
 * ticket's own `placedBy` honestly. Everything else — menu resolution,
 * 86 checks, qty caps, the per-tenant staff-approval ceiling, the
 * per-session rate limit, idempotency by `(sessionId, clientRequestId)` —
 * applies to a waiter order exactly as it does to a guest one.
 *
 * ZERO-TRUST, same shape as `advanceTicket` / `voidTicketLine`: no
 * client-supplied actor or tenant. Cookie-verify `tb_staff`, derive
 * identity from it, check `branchId ∈ bids` and `canPlaceStaffOrder`, and
 * read the session document server-side to get its `tableId` (never
 * trusting a table id from the client) and confirm it is open.
 *
 * IDEMPOTENCY: the client sends a `clientRequestId` that is stable across
 * a retried submit of the same cart (rotates when the cart changes). A
 * double-tap therefore creates two `orderRequests` docs with the same
 * `(sessionId, clientRequestId)`; `priceOrderRequest`'s deterministic
 * order id collapses them to ONE ticket, the second resolving as
 * `'duplicate'`. This action does not itself dedupe — it does not need to.
 */

import { cookies } from 'next/headers';
import { FieldValue } from 'firebase-admin/firestore';
import { adminDb } from '@/lib/firebase/admin';
import { verifyStaffSessionToken, STAFF_SESSION_COOKIE_NAME } from '@/server/auth/staff-session-cookie';
import { canPlaceStaffOrder } from '@/lib/console/staff-permissions';
import { createPartySession } from '@/server/services/session.service';
import type { Table } from '@/types/firestore';

const MAX_LINES = 40;
const MAX_QTY_PER_LINE = 20;
const MAX_NOTE_CHARS = 150;
const MAX_MODIFIERS_PER_LINE = 12;
const CLIENT_REQUEST_ID_PATTERN = /^[A-Za-z0-9_-]{8,64}$/;
const OPEN_SESSION_STATUSES = new Set(['active', 'idle', 'billing']);

export interface StaffOrderLine {
  itemId: string;
  qty: number;
  modifierOptionIds: string[];
}

export interface PlaceStaffOrderInput {
  branchId: string;
  sessionId: string;
  lines: StaffOrderLine[];
  note: string;
  clientRequestId: string;
}

export type PlaceStaffOrderResult =
  | { outcome: 'submitted'; requestId: string }
  | { outcome: 'rejected'; reason: string };

function sanitizeLines(raw: unknown): StaffOrderLine[] | null {
  if (!Array.isArray(raw) || raw.length === 0 || raw.length > MAX_LINES) return null;
  const out: StaffOrderLine[] = [];
  for (const line of raw) {
    if (typeof line !== 'object' || line === null) return null;
    const { itemId, qty, modifierOptionIds } = line as Record<string, unknown>;
    if (typeof itemId !== 'string' || itemId.length === 0 || itemId.length > 128) return null;
    if (typeof qty !== 'number' || !Number.isInteger(qty) || qty < 1 || qty > MAX_QTY_PER_LINE) return null;
    if (!Array.isArray(modifierOptionIds) || modifierOptionIds.length > MAX_MODIFIERS_PER_LINE) return null;
    if (!modifierOptionIds.every((id) => typeof id === 'string' && id.length > 0 && id.length <= 128)) return null;
    out.push({ itemId, qty, modifierOptionIds: modifierOptionIds as string[] });
  }
  return out;
}

export async function placeStaffOrder(input: PlaceStaffOrderInput): Promise<PlaceStaffOrderResult> {
  const { branchId, sessionId, clientRequestId } = input;

  const cookieStore = await cookies();
  const staffToken = cookieStore.get(STAFF_SESSION_COOKIE_NAME)?.value;
  const staffSession = staffToken ? await verifyStaffSessionToken(staffToken) : null;

  if (!staffSession) {
    return { outcome: 'rejected', reason: 'NOT_AUTHENTICATED' };
  }
  if (!staffSession.bids.includes(branchId)) {
    return { outcome: 'rejected', reason: 'BRANCH_NOT_AUTHORIZED' };
  }
  if (!canPlaceStaffOrder({ role: staffSession.role, overrideAuth: staffSession.overrideAuth })) {
    return { outcome: 'rejected', reason: 'ROLE_NOT_PERMITTED' };
  }

  if (typeof sessionId !== 'string' || sessionId.length === 0 || sessionId.length > 128) {
    return { outcome: 'rejected', reason: 'INVALID_SESSION' };
  }
  if (typeof clientRequestId !== 'string' || !CLIENT_REQUEST_ID_PATTERN.test(clientRequestId)) {
    return { outcome: 'rejected', reason: 'INVALID_REQUEST_ID' };
  }
  const lines = sanitizeLines(input.lines);
  if (!lines) {
    return { outcome: 'rejected', reason: 'INVALID_LINES' };
  }
  // Basic hygiene only — `priceOrderRequest`'s `sanitizeGuestText` does the
  // real Layer-2 pass on whatever lands in the doc.
  const note = (typeof input.note === 'string' ? input.note : '').slice(0, MAX_NOTE_CHARS);

  const tenantId = staffSession.tid;
  const branchPath = `tenants/${tenantId}/branches/${branchId}`;

  const sessionSnap = await adminDb.doc(`${branchPath}/sessions/${sessionId}`).get();
  if (!sessionSnap.exists) {
    return { outcome: 'rejected', reason: 'SESSION_NOT_FOUND' };
  }
  const session = sessionSnap.data() as { tableId?: string; status?: string };
  if (!session.status || !OPEN_SESSION_STATUSES.has(session.status)) {
    return { outcome: 'rejected', reason: 'SESSION_CLOSED' };
  }
  if (typeof session.tableId !== 'string' || session.tableId.length === 0) {
    return { outcome: 'rejected', reason: 'SESSION_MALFORMED' };
  }

  const requestRef = adminDb.collection(`${branchPath}/orderRequests`).doc();
  await requestRef.set({
    sessionId,
    tableId: session.tableId, // server-read, never trusted from the client
    lines,
    note,
    clientRequestId,
    createdBy: staffSession.uid,
    placedBy: { kind: 'staff', uid: staffSession.uid },
    // ADR-11 — denormalise the name now so the KDS / Cashier ticket header
    // shows "by <waiter>" without a `members/{uid}` lookup. `displayName`
    // is already on the verified cookie.
    placedByName: staffSession.displayName,
    createdAt: FieldValue.serverTimestamp(),
    status: 'pending',
  });

  // `priceOrderRequestTrigger` takes it from here → prices → `orders`.
  return { outcome: 'submitted', requestId: requestRef.id };
}

/**
 * `openTableSession` — a waiter manually opens a tab for a table with no
 * active party. TableBells is QR-first, but a guest with no phone / no
 * data who sits down and orders verbally still needs a session for the
 * order to hang off. This runs the SAME `createPartySession` write
 * `resolveGuestSession` does on a QR scan, flagged `source: 'staff'` and
 * `openedByStaffUid: <uid>`, with `deviceIds: []` (no guest device yet).
 *
 * Same cookie-verified, `canPlaceStaffOrder`-gated shape as
 * `placeStaffOrder`. The transaction re-reads the table (never trusts a
 * client-supplied count) and enforces the per-branch `maxPartiesPerTable`
 * cap, exactly as the guest path does — just returning a typed
 * `'rejected'` instead of the guest path's `'table_full'` outcome.
 */

const DEFAULT_MAX_PARTIES_PER_TABLE = 6;

export interface OpenTableSessionInput {
  branchId: string;
  tableId: string;
}

export type OpenTableSessionResult =
  | { outcome: 'opened'; sessionId: string; partyLabel: string }
  | { outcome: 'rejected'; reason: string };

export async function openTableSession(input: OpenTableSessionInput): Promise<OpenTableSessionResult> {
  const { branchId, tableId } = input;

  const cookieStore = await cookies();
  const staffToken = cookieStore.get(STAFF_SESSION_COOKIE_NAME)?.value;
  const staffSession = staffToken ? await verifyStaffSessionToken(staffToken) : null;

  if (!staffSession) {
    return { outcome: 'rejected', reason: 'NOT_AUTHENTICATED' };
  }
  if (!staffSession.bids.includes(branchId)) {
    return { outcome: 'rejected', reason: 'BRANCH_NOT_AUTHORIZED' };
  }
  if (!canPlaceStaffOrder({ role: staffSession.role, overrideAuth: staffSession.overrideAuth })) {
    return { outcome: 'rejected', reason: 'ROLE_NOT_PERMITTED' };
  }
  if (typeof tableId !== 'string' || tableId.length === 0 || tableId.length > 128) {
    return { outcome: 'rejected', reason: 'INVALID_TABLE' };
  }

  const tenantId = staffSession.tid;
  const branchPath = `tenants/${tenantId}/branches/${branchId}`;
  const tableRef = adminDb.doc(`${branchPath}/tables/${tableId}`);
  const branchRef = adminDb.doc(branchPath);

  return adminDb.runTransaction(async (tx): Promise<OpenTableSessionResult> => {
    const [tableSnap, branchSnap] = await Promise.all([tx.get(tableRef), tx.get(branchRef)]);

    if (!tableSnap.exists) {
      return { outcome: 'rejected', reason: 'TABLE_NOT_FOUND' };
    }
    const table = tableSnap.data() as Table;
    if (table.status === 'disabled') {
      return { outcome: 'rejected', reason: 'TABLE_DISABLED' };
    }

    const maxParties =
      (branchSnap.data() as { session?: { maxPartiesPerTable?: number } } | undefined)?.session
        ?.maxPartiesPerTable ?? DEFAULT_MAX_PARTIES_PER_TABLE;
    if ((table.partyCount ?? (table.parties ?? []).length) >= maxParties) {
      return { outcome: 'rejected', reason: 'TABLE_FULL' };
    }

    const created = createPartySession(tx, {
      tenantId,
      branchId,
      tableId,
      table,
      deviceIds: [],
      source: 'staff',
      openedByStaffUid: staffSession.uid,
      guestCount: 1, // no UI collects a real headcount yet — 1 is an honest default
      nowMs: Date.now(),
    });

    return { outcome: 'opened', sessionId: created.sessionId, partyLabel: created.partyLabel };
  });
}
