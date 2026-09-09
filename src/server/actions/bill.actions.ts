'use server';

/**
 * src/server/actions/bill.actions.ts
 *
 * Four Admin-SDK, `tb_staff`-cookie-verified staff actions, all built to
 * the `advanceTicket` pattern (no client-supplied actor/tenant — the
 * function reads and verifies the cookie itself):
 *
 *   voidTicketLine    -- ADR-5 sent-line void (below).
 *   requestBill       -- ADR-7. Flip a party's session to `billing` and
 *                        raise a `staffAlerts` doc (`type:'bill_request'`)
 *                        that surfaces on BOTH the Cashier inbox and the
 *                        Waiter floor strip. Idempotent on the status
 *                        flip; re-notifies (fresh alert) if asked again.
 *   printBill         -- ADR-7. Increment `session.printCount`. The first
 *                        print returns `duplicate:false`; every reprint
 *                        after that returns `duplicate:true` so the UI can
 *                        stamp the copy "DUPLICATE". No physical printer
 *                        is wired (that stays the deferred ESC-POS Layer-5
 *                        route, ADR-2) — this owns the DB state only.
 *   resolveStaffAlert -- mark a `staffAlerts` doc `resolved` (+ who/when).
 *                        Currently the "Dismiss" behind a `bill_request`
 *                        row; ghost alerts still route through the ban
 *                        flow, not this.
 *   closeSession      -- ADR-7's final step. Settle & close ONE party's
 *                        session: `status:'closed'` + stamps, strip its
 *                        `tables/{id}.parties[]` entry (recompute count /
 *                        openTab / status so an emptied table reads
 *                        `available`), and resolve its lingering
 *                        `bill_request` alerts. No payment gateway — the
 *                        cash/card was taken on a standalone machine.
 *
 * All four ADR-7 actions gate on `canHandleBilling`
 * (server/cashier/manager/owner). GUEST-INITIATED "Request Bill" is NOT
 * here: a guest has no `tb_staff` cookie and `firestore.rules` lets no
 * guest client flip a session to `billing`, so the guest path needs a
 * guest-token-verified action that this codebase has no precedent for
 * yet (guests write Firestore directly). Deferred, documented in ADR-7 —
 * a waiter tapping "Request Bill" on the guest's behalf is the wired path.
 *
 * `voidTicketLine` -- the real, Admin-SDK, cookie-verified line void.
 * Built to the same pattern `kds.actions.ts`'s `advanceTicket`
 * established: no client-supplied `actor` or `tenantId`, ever -- the
 * function reads and verifies the `tb_staff` session cookie itself and
 * derives identity from it. This is the action MEMORY.md §2 item 7 listed
 * as still mocked.
 *
 * ROLE BOUNDARY -- DECISIONS.md ADR-5 (2026-09-09). This is the void of an
 * ALREADY-SENT line, from the Cashier terminal. `canVoidSentLine` gates
 * it to cashier/manager/owner (and kitchen, which keeps the authority via
 * the KDS path and will call this same action once that screen is wired).
 * A `server` (waiter) is deliberately excluded: a waiter can only remove
 * lines from a DRAFT cart before it is sent (`waiter-menu-entry.tsx`),
 * and asks a cashier verbally for anything already in the kitchen.
 *
 * WHAT IT WRITES (ARCHITECTURE.md §2.5, order-document portion):
 *   1. `items[i]` -> `status:'voided'` + a `void{}` audit block naming the
 *      reason, the free-text note, the acting member, and the credited
 *      amount.
 *   2. `grossFils`/`netFils`/`vatFils` RECOMPUTED from the surviving
 *      active lines via the one real `splitInclusive()` -- never adjusted
 *      incrementally (ARCHITECTURE.md §2.6).
 *   3. `voidedFils` incremented by the credit.
 *   4. `status:'voided'` iff every line is now voided -> the ticket
 *      leaves the KDS queue.
 *   5. an append-only `orders/{id}/events` row -- `firestore.rules` makes
 *      that subcollection `allow write: if false`, so this Admin write is
 *      the only thing that can populate the audit spine. Retained
 *      indefinitely for UAE 5-year VAT accountability (ADR-5).
 *
 * WHAT IT DOES NOT DO YET, named not hidden: the §2.5 fan-out beyond the
 * order document -- `bills/{billId}` gross, `session.runningTotals`, and
 * the `sessions/{s}/alerts += { type:'item_voided', creditFils }` guest
 * notification -- needs the real session/bill wiring that does not exist
 * (the Cashier surface still runs on mock tables). Same scoping as
 * `advanceTicket`, which also stops at the order doc + events and leaves
 * FCM / floor fan-out for later.
 *
 * `void.at` is `Date.now()`, NOT `FieldValue.serverTimestamp()`:
 * Firestore rejects the server-timestamp sentinel inside an array
 * element, and `void` lives inside `items[]`. Top-level `updatedAt` and
 * the events row's `at` still use the real sentinel. `types/firestore.ts`
 * already types `OrderLineVoid.at` as an epoch-ms `number` for this exact
 * reason.
 */

import { cookies } from 'next/headers';
import { FieldValue } from 'firebase-admin/firestore';
import { adminDb } from '@/lib/firebase/admin';
import { verifyStaffSessionToken, STAFF_SESSION_COOKIE_NAME } from '@/server/auth/staff-session-cookie';
import { splitInclusive } from '@/server/services/pricing.service';
import { isVoidReasonCode } from '@/lib/console/void-reasons';
import { canVoidSentLine, canHandleBilling } from '@/lib/console/staff-permissions';
import type { Order, OrderLine, GuestSession, StaffAlert, Table } from '@/types/firestore';

const MAX_NOTE_CHARS = 150;

export interface VoidTicketLineInput {
  branchId: string;
  orderId: string;
  lineId: string;
  reason: string;
  note: string;
}

export type VoidTicketLineResult =
  | { outcome: 'voided'; orderVoided: boolean; creditFils: number }
  | { outcome: 'already_voided' }
  | { outcome: 'rejected'; reason: string };

export async function voidTicketLine(input: VoidTicketLineInput): Promise<VoidTicketLineResult> {
  const { branchId, orderId, lineId } = input;

  const cookieStore = await cookies();
  const staffToken = cookieStore.get(STAFF_SESSION_COOKIE_NAME)?.value;
  const staffSession = staffToken ? await verifyStaffSessionToken(staffToken) : null;

  if (!staffSession) {
    return { outcome: 'rejected', reason: 'NOT_AUTHENTICATED' };
  }
  if (!staffSession.bids.includes(branchId)) {
    // Mirrors firestore.rules' `inBranch(b)` -- this Admin write bypasses
    // rules, so it re-checks the guarantee itself.
    return { outcome: 'rejected', reason: 'BRANCH_NOT_AUTHORIZED' };
  }
  if (!canVoidSentLine({ role: staffSession.role, overrideAuth: staffSession.overrideAuth })) {
    return { outcome: 'rejected', reason: 'ROLE_NOT_PERMITTED' };
  }
  if (!isVoidReasonCode(input.reason)) {
    return { outcome: 'rejected', reason: 'INVALID_REASON' };
  }

  const reason = input.reason;
  const note = (typeof input.note === 'string' ? input.note : '').slice(0, MAX_NOTE_CHARS);
  const tenantId = staffSession.tid;
  const actorUid = staffSession.uid;
  const actorRole = staffSession.role;

  const orderRef = adminDb.doc(`tenants/${tenantId}/branches/${branchId}/orders/${orderId}`);

  return adminDb.runTransaction(async (tx): Promise<VoidTicketLineResult> => {
    const snap = await tx.get(orderRef);
    if (!snap.exists) {
      return { outcome: 'rejected', reason: 'ORDER_NOT_FOUND' };
    }

    const order = snap.data() as Order;

    if (order.status === 'voided') {
      return { outcome: 'rejected', reason: 'ORDER_ALREADY_VOIDED' };
    }

    const target = order.items.find((line) => line.lineId === lineId);
    if (!target) {
      return { outcome: 'rejected', reason: 'LINE_NOT_FOUND' };
    }
    if (target.status !== 'active') {
      // Idempotent: a double-tap on the same line is not an error.
      return { outcome: 'already_voided' };
    }

    const creditFils = target.lineTotalFils;
    const voidedAtMs = Date.now();

    const items: OrderLine[] = order.items.map((line) =>
      line.lineId === lineId
        ? {
            ...line,
            status: 'voided' as const,
            void: {
              reason,
              note,
              byUid: actorUid,
              byRole: actorRole,
              at: voidedAtMs,
              creditFils,
            },
          }
        : line,
    );

    const survivingGross = items
      .filter((line) => line.status === 'active')
      .reduce((sum, line) => sum + line.lineTotalFils, 0);
    // ADR-11 — recompute at the SAME VAT rate this order was priced at
    // (snapshotted onto the doc by `priceOrderRequest`); fall back to 5%
    // only for a pre-ADR-11 ticket that has no `vatPpm`.
    const orderVatPpm = typeof order.vatPpm === 'number' ? order.vatPpm : 50_000;
    const { netFils, vatFils } = splitInclusive(survivingGross, orderVatPpm);
    const allVoided = items.every((line) => line.status === 'voided');

    const now = FieldValue.serverTimestamp();

    tx.update(orderRef, {
      items,
      grossFils: survivingGross,
      netFils,
      vatFils,
      voidedFils: order.voidedFils + creditFils,
      status: allVoided ? 'voided' : order.status,
      updatedAt: now,
      updatedBy: actorUid,
    });

    tx.set(orderRef.collection('events').doc(), {
      kind: 'line_voided',
      lineId,
      reason,
      note,
      actorUid,
      actorRole,
      deviceId: null, // terminal device-secret factor still unbuilt -- see kds.actions.ts header
      at: now,
    });

    if (allVoided) {
      tx.set(orderRef.collection('events').doc(), {
        kind: 'transition',
        from: order.status,
        to: 'voided',
        actorUid,
        actorRole,
        deviceId: null,
        at: now,
      });
    }

    return { outcome: 'voided', orderVoided: allVoided, creditFils };
  });
}

// --- ADR-7: bill request / print / alert dismissal -----------------------

/**
 * Shared front of every ADR-7 action: verify the `tb_staff` cookie, check
 * the branch is in `bids`, and gate on `canHandleBilling`. Returns the
 * verified session + the branch doc path, or a machine reason string.
 * (`voidTicketLine` above keeps its own inline copy — it predates this and
 * gates on a different predicate.)
 */
async function verifyBillingStaff(
  branchId: string,
): Promise<
  | { ok: true; uid: string; role: string; branchPath: string }
  | { ok: false; reason: string }
> {
  const cookieStore = await cookies();
  const staffToken = cookieStore.get(STAFF_SESSION_COOKIE_NAME)?.value;
  const staffSession = staffToken ? await verifyStaffSessionToken(staffToken) : null;

  if (!staffSession) {
    return { ok: false, reason: 'NOT_AUTHENTICATED' };
  }
  if (!staffSession.bids.includes(branchId)) {
    return { ok: false, reason: 'BRANCH_NOT_AUTHORIZED' };
  }
  if (!canHandleBilling({ role: staffSession.role, overrideAuth: staffSession.overrideAuth })) {
    return { ok: false, reason: 'ROLE_NOT_PERMITTED' };
  }
  return {
    ok: true,
    uid: staffSession.uid,
    role: staffSession.role,
    branchPath: `tenants/${staffSession.tid}/branches/${branchId}`,
  };
}

const BILLABLE_STATUSES = new Set<GuestSession['status']>(['active', 'billing']);

export interface RequestBillInput {
  branchId: string;
  sessionId: string;
}

export type RequestBillResult =
  | { outcome: 'requested'; alreadyBilling: boolean }
  | { outcome: 'rejected'; reason: string };

/**
 * A waiter (or, later, a guest via a separate action) asks for the bill.
 * One transaction: flip `sessions/{id}.status` to `billing` (stamping
 * `billingRequestedAt`) unless it is already there, and write a
 * `staffAlerts` doc the Cashier inbox and Waiter floor both listen to.
 * The alert is written every time — a second "we're still waiting" tap
 * re-notifies without disturbing the original `billingRequestedAt`.
 */
export async function requestBill(input: RequestBillInput): Promise<RequestBillResult> {
  const { branchId, sessionId } = input;

  if (typeof sessionId !== 'string' || sessionId.length === 0 || sessionId.length > 128) {
    return { outcome: 'rejected', reason: 'INVALID_SESSION' };
  }

  const auth = await verifyBillingStaff(branchId);
  if (!auth.ok) {
    return { outcome: 'rejected', reason: auth.reason };
  }

  const sessionRef = adminDb.doc(`${auth.branchPath}/sessions/${sessionId}`);
  const alertRef = adminDb.collection(`${auth.branchPath}/staffAlerts`).doc();

  return adminDb.runTransaction(async (tx): Promise<RequestBillResult> => {
    const snap = await tx.get(sessionRef);
    if (!snap.exists) {
      return { outcome: 'rejected', reason: 'SESSION_NOT_FOUND' };
    }
    const session = snap.data() as GuestSession;
    if (session.status === 'closed') {
      return { outcome: 'rejected', reason: 'SESSION_CLOSED' };
    }

    const alreadyBilling = session.status === 'billing';
    if (!alreadyBilling) {
      tx.update(sessionRef, { status: 'billing', billingRequestedAt: Date.now() });
    }

    // Shape matches `StaffAlert` (types/firestore.ts) minus the doc-id
    // `id` and with `createdAt` as the server-timestamp sentinel — the
    // shared `convertAlertSnapshot` maps it back to epoch-ms on read.
    const alert: Record<string, unknown> = {
      type: 'bill_request' satisfies StaffAlert['type'],
      tableCode: session.tableCode,
      orderCode: null,
      sessionId,
      note: alreadyBilling
        ? `Party ${session.partyLabel} is still waiting for the bill`
        : `Party ${session.partyLabel} requested the bill`,
      reportedByRole: auth.role,
      createdAt: FieldValue.serverTimestamp(),
      status: 'open' satisfies StaffAlert['status'],
    };
    tx.set(alertRef, alert);

    return { outcome: 'requested', alreadyBilling };
  });
}

export interface PrintBillInput {
  branchId: string;
  sessionId: string;
}

export type PrintBillResult =
  | { outcome: 'printed'; printCount: number; duplicate: boolean }
  | { outcome: 'rejected'; reason: string };

/**
 * Increment `session.printCount` for a party whose session is `active` or
 * `billing`. `duplicate` is `true` when a copy was already printed before
 * this one (i.e. `printCount` was already > 0) — the caller stamps the
 * reprint "DUPLICATE". No ESC-POS / physical printer here; ADR-2's
 * Layer-5 print route stays deferred.
 */
export async function printBill(input: PrintBillInput): Promise<PrintBillResult> {
  const { branchId, sessionId } = input;

  if (typeof sessionId !== 'string' || sessionId.length === 0 || sessionId.length > 128) {
    return { outcome: 'rejected', reason: 'INVALID_SESSION' };
  }

  const auth = await verifyBillingStaff(branchId);
  if (!auth.ok) {
    return { outcome: 'rejected', reason: auth.reason };
  }

  const sessionRef = adminDb.doc(`${auth.branchPath}/sessions/${sessionId}`);

  return adminDb.runTransaction(async (tx): Promise<PrintBillResult> => {
    const snap = await tx.get(sessionRef);
    if (!snap.exists) {
      return { outcome: 'rejected', reason: 'SESSION_NOT_FOUND' };
    }
    const session = snap.data() as GuestSession;
    if (!BILLABLE_STATUSES.has(session.status)) {
      return { outcome: 'rejected', reason: 'SESSION_NOT_BILLABLE' };
    }

    const priorCount = typeof session.printCount === 'number' ? session.printCount : 0;
    const printCount = priorCount + 1;
    tx.update(sessionRef, { printCount, lastPrintedAt: Date.now() });

    return { outcome: 'printed', printCount, duplicate: priorCount > 0 };
  });
}

export interface ResolveStaffAlertInput {
  branchId: string;
  alertId: string;
}

export type ResolveStaffAlertResult =
  | { outcome: 'resolved' }
  | { outcome: 'rejected'; reason: string };

/**
 * Mark a `staffAlerts` doc `resolved` with who/when. The "Dismiss" on a
 * `bill_request` row (Cashier inbox + Waiter strip). Deliberately generic
 * — but ghost-order alerts are still closed by the manager ban flow
 * (`flagGhostOrder`, unbuilt), not this.
 */
export async function resolveStaffAlert(input: ResolveStaffAlertInput): Promise<ResolveStaffAlertResult> {
  const { branchId, alertId } = input;

  if (typeof alertId !== 'string' || alertId.length === 0 || alertId.length > 128) {
    return { outcome: 'rejected', reason: 'INVALID_ALERT' };
  }

  const auth = await verifyBillingStaff(branchId);
  if (!auth.ok) {
    return { outcome: 'rejected', reason: auth.reason };
  }

  const alertRef = adminDb.doc(`${auth.branchPath}/staffAlerts/${alertId}`);
  const snap = await alertRef.get();
  if (!snap.exists) {
    return { outcome: 'rejected', reason: 'ALERT_NOT_FOUND' };
  }

  await alertRef.update({
    status: 'resolved',
    resolvedByUid: auth.uid,
    resolvedAt: Date.now(),
  });

  return { outcome: 'resolved' };
}

export interface CloseSessionInput {
  branchId: string;
  sessionId: string;
}

export type CloseSessionResult =
  | { outcome: 'closed'; tableAvailable: boolean; alertsResolved: number }
  | { outcome: 'rejected'; reason: string };

/**
 * Settle & close (DECISIONS.md ADR-7's final step). The Cashier has taken
 * cash/card on a standalone machine — no payment gateway here — and this
 * closes out the software state for ONE party's session:
 *
 *   1. `sessions/{id}` → `status: 'closed'`, `closedAt` / `closedBy` /
 *      `closeReason` stamped.
 *   2. The denormalised `tables/{tableId}.parties[]` entry for this
 *      session is removed, `partyCount` and `openTabFils` recomputed from
 *      what's left. When that empties the table, its `status` drops back
 *      to `available` (unless it is `disabled` / `attention`, which are
 *      staff-set and not ours to clear) so the Waiter floor shows it free
 *      immediately — the mirror of `createPartySession`'s promote-on-open.
 *   3. Every still-open `bill_request` alert for this session is resolved
 *      so it stops lingering in the Cashier inbox / Waiter strip. Other
 *      alert types (a ghost-order report tied to this session) are left
 *      for a manager — a table close is not a review.
 *
 * All in one transaction. `canHandleBilling`-gated, Admin SDK, cookie-
 * verified — same front as `requestBill` / `printBill`.
 */
export async function closeSession(input: CloseSessionInput): Promise<CloseSessionResult> {
  const { branchId, sessionId } = input;

  if (typeof sessionId !== 'string' || sessionId.length === 0 || sessionId.length > 128) {
    return { outcome: 'rejected', reason: 'INVALID_SESSION' };
  }

  const auth = await verifyBillingStaff(branchId);
  if (!auth.ok) {
    return { outcome: 'rejected', reason: auth.reason };
  }

  const sessionRef = adminDb.doc(`${auth.branchPath}/sessions/${sessionId}`);
  // Single-field equality only — no composite index needed; `status` /
  // `type` are filtered in code below.
  const alertsQuery = adminDb
    .collection(`${auth.branchPath}/staffAlerts`)
    .where('sessionId', '==', sessionId);

  return adminDb.runTransaction(async (tx): Promise<CloseSessionResult> => {
    const sessionSnap = await tx.get(sessionRef);
    if (!sessionSnap.exists) {
      return { outcome: 'rejected', reason: 'SESSION_NOT_FOUND' };
    }
    const session = sessionSnap.data() as GuestSession;
    if (session.status === 'closed') {
      // Idempotent-ish: a double-tap after the listener already dropped
      // the party is not an error worth alarming the cashier over.
      return { outcome: 'rejected', reason: 'SESSION_ALREADY_CLOSED' };
    }

    const tableRef = adminDb.doc(`${auth.branchPath}/tables/${session.tableId}`);
    const tableSnap = await tx.get(tableRef);
    const alertsSnap = await tx.get(alertsQuery);

    const nowMs = Date.now();

    // (1) session -> closed
    tx.update(sessionRef, {
      status: 'closed',
      closedAt: nowMs,
      closedBy: auth.uid,
      closeReason: 'settled_by_staff',
    });

    // (2) table denorm cleanup
    let tableAvailable = false;
    if (tableSnap.exists) {
      const table = tableSnap.data() as Table;
      const existing = table.parties ?? [];
      const remaining = existing.filter((p) => p.sessionId !== sessionId);
      const removedCount = existing.length - remaining.length;
      const emptyNow = remaining.length === 0;
      const nextStatus =
        emptyNow && table.status !== 'disabled' && table.status !== 'attention'
          ? 'available'
          : table.status;
      tableAvailable = emptyNow && nextStatus === 'available';
      tx.update(tableRef, {
        parties: remaining,
        partyCount: Math.max(0, (table.partyCount ?? existing.length) - removedCount),
        openTabFils: remaining.reduce((sum, p) => sum + (p.openTabFils ?? 0), 0),
        status: nextStatus,
      });
    }

    // (3) resolve lingering bill_request alerts for this session
    let alertsResolved = 0;
    for (const doc of alertsSnap.docs) {
      const data = doc.data() as Pick<StaffAlert, 'type' | 'status'>;
      if (data.type === 'bill_request' && data.status === 'open') {
        tx.update(doc.ref, { status: 'resolved', resolvedByUid: auth.uid, resolvedAt: nowMs });
        alertsResolved += 1;
      }
    }

    return { outcome: 'closed', tableAvailable, alertsResolved };
  });
}
