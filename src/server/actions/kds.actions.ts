'use server';

/**
 * src/server/actions/kds.actions.ts
 *
 * `advanceTicket` — now backed by real staff authentication. THIS IS THE
 * FIX to the exact gap flagged when this file was first built: last
 * pass, `advanceTicket` took an `actor: { uid, role, overrideAuth }`
 * parameter supplied by the CALLING CLIENT CODE. That was flagged
 * explicitly at the time as trusting a CLAIMED identity, not a VERIFIED
 * one — and it remained genuinely insecure regardless of what the
 * rendering page itself had verified, because a Server Action is a real
 * network endpoint: a malicious caller could always construct a forged
 * `actor: { role: 'owner', ... }` and POST it directly, bypassing
 * whatever the UI would have sent. Passing server-verified data down
 * through component props never makes a Server Action verify anything
 * on its own — only the action itself, independently, can do that.
 *
 * WHAT CHANGED: this function no longer accepts `tenantId` or `actor` as
 * input AT ALL. It reads and verifies the real staff session cookie
 * (`server/auth/staff-session-cookie.ts`, the same one
 * `middleware.ts` already checks for page-level routing) directly,
 * inside itself, via `next/headers`'s `cookies()` — Server Actions have
 * the same access to the incoming request's cookies as a Server
 * Component or Route Handler does. `tenantId` comes from the verified
 * cookie's `tid` claim; the actor's `uid`/`role`/`overrideAuth` come from
 * the same place. `branchId` remains a caller-supplied parameter (a
 * multi-branch staff member legitimately might operate in more than one
 * of their authorized branches) but is checked against the cookie's
 * `bids` array before anything proceeds — never trusted blindly. This is
 * RULES.md's zero-trust discipline applied at a Server Action boundary
 * specifically, not just at a page or a Firestore rule.
 *
 * STILL TRUE, restated rather than silently improved past: role
 * enforcement inside `checkTransition` was always real. What was missing
 * — and is now closed — is that the IDENTITY being checked is finally
 * cryptographically verified (a real argon2id-gated login, a signed
 * cookie) instead of merely asserted by whoever called this function.
 * What is STILL NOT built: the terminal device-secret factor
 * ARCHITECTURE.md §1.6 names as the third leg of staff auth (no
 * `devices/{deviceId}` registration exists anywhere in this codebase) —
 * this function now has a VERIFIED staff identity, but not yet
 * confirmation that the specific TERMINAL making the call is a
 * registered one. A stolen, still-valid staff session cookie remains
 * usable from any browser until that piece exists.
 */

import { cookies } from 'next/headers';
import { FieldValue } from 'firebase-admin/firestore';
import { adminDb } from '@/lib/firebase/admin';
import { verifyStaffSessionToken, STAFF_SESSION_COOKIE_NAME } from '@/server/auth/staff-session-cookie';
import { checkTransition } from '@/server/services/ticket-state.service';
import { canToggleStock } from '@/lib/console/staff-permissions';
import type { AvailabilityDoc, AvailabilityEntry, OrderStatus } from '@/types/firestore';

export interface AdvanceTicketInput {
  branchId: string;
  orderId: string;
  to: OrderStatus;
}

export type AdvanceTicketResult =
  | { outcome: 'advanced'; status: OrderStatus }
  | { outcome: 'already_there'; status: OrderStatus }
  | { outcome: 'rejected'; reason: string };

export async function advanceTicket(input: AdvanceTicketInput): Promise<AdvanceTicketResult> {
  const { branchId, orderId, to } = input;

  const cookieStore = await cookies();
  const staffToken = cookieStore.get(STAFF_SESSION_COOKIE_NAME)?.value;
  const staffSession = staffToken ? await verifyStaffSessionToken(staffToken) : null;

  if (!staffSession) {
    // Missing, expired, or tampered -- treated identically, matching
    // `verifyStaffSessionToken`'s own contract. A guest-triggerable-
    // shaped outcome in form only; a real caller never legitimately
    // reaches this without a valid session, so this is closer to
    // "middleware's own gate was somehow bypassed" than a normal path --
    // still a typed rejection, not thrown, since a raced/expired cookie
    // between page load and button tap is a real, if rare, possibility.
    return { outcome: 'rejected', reason: 'NOT_AUTHENTICATED' };
  }

  if (!staffSession.bids.includes(branchId)) {
    // Mirrors firestore.rules' own `inBranch(b)` check exactly -- this
    // Admin SDK action bypasses those rules entirely, so it has to
    // reimplement this specific guarantee itself, not inherit it.
    return { outcome: 'rejected', reason: 'BRANCH_NOT_AUTHORIZED' };
  }

  const tenantId = staffSession.tid;
  const actorUid = staffSession.uid;
  const actor = { role: staffSession.role, overrideAuth: staffSession.overrideAuth };

  const orderRef = adminDb.doc(`tenants/${tenantId}/branches/${branchId}/orders/${orderId}`);

  return adminDb.runTransaction(async (tx): Promise<AdvanceTicketResult> => {
    const snap = await tx.get(orderRef);
    if (!snap.exists) {
      return { outcome: 'rejected', reason: 'ORDER_NOT_FOUND' };
    }

    const current = snap.data()?.status as OrderStatus;
    const check = checkTransition(current, to, actor);

    if (!check.legal) {
      return { outcome: 'rejected', reason: check.reason };
    }
    if (check.alreadyThere) {
      return { outcome: 'already_there', status: current };
    }

    const now = FieldValue.serverTimestamp();

    const update: Record<string, unknown> = {
      status: to,
      updatedAt: now,
      updatedBy: actorUid,
    };
    if (check.sideEffectField) {
      update[check.sideEffectField] = now;
    }
    tx.update(orderRef, update);

    // Append-only audit spine, ARCHITECTURE.md §2.2 -- firestore.rules'
    // `events` subcollection is `allow write: if false` for every
    // client; this Admin SDK write is the only thing that can populate
    // it.
    const eventRef = orderRef.collection('events').doc();
    tx.set(eventRef, {
      from: current,
      to,
      actorUid,
      actorRole: actor.role,
      deviceId: null, // terminal device-secret system doesn't exist yet -- see file header
      at: now,
    });

    return { outcome: 'advanced', status: to };
  });
}

/**
 * `toggleStock` — ARCHITECTURE.md §2.4's 86 toggle, real now (was a local
 * `useState` mock on the Stock Board). Same cookie-verified, role-gated
 * shape as `advanceTicket`: no client-supplied actor/tenant, reads
 * identity from `tb_staff` itself, `canToggleStock` = kitchen/manager/
 * owner.
 *
 * WRITES `live/availability` ONLY — the single-doc broadcast channel
 * every guest phone and every KDS screen already listens to (one delta
 * per phone; §2.4's "Why one document"). §2.4 also names a durable
 * `menuState/{itemId}` per-item record alongside the broadcast; that
 * collection has no schema anywhere in this codebase (no `firestore.rules`
 * match, no `types/firestore.ts` type), so it is DEFERRED, not silently
 * skipped — same scoping choice as `voidTicketLine` leaving its bill/
 * session fan-out for later. `live/availability` is the part that makes
 * the Stock Board function and reaches guests.
 *
 * READ-MODIFY-WRITE IN A TRANSACTION, whole-doc `set` (no merge): a
 * merge-set can't reliably DELETE a nested map key (restoring an item to
 * available), and the doc may not exist yet (first-ever 86). Rewriting
 * the whole `AvailabilityDoc` each toggle is cheap — it holds a handful
 * of 86'd keys — and the transaction makes concurrent toggles from two
 * chefs safe.
 *
 * `at` is `Date.now()` (a number, matching `AvailabilityEntry`'s
 * client-side type) rather than `serverTimestamp()`; nothing reads it and
 * this keeps the whole doc plain numbers. See MEMORY.md's standing note
 * on the `Date.now()` vs `serverTimestamp()` inconsistency `converters.ts`
 * will unify.
 */

export type ToggleStockTarget =
  | { kind: 'item'; itemId: string }
  | { kind: 'modifierOption'; itemId: string; optionId: string };

export interface ToggleStockInput {
  branchId: string;
  target: ToggleStockTarget;
  /** The desired NEW state: `true` = available (restore), `false` = 86'd. */
  available: boolean;
  reason?: string;
}

export type ToggleStockResult = { outcome: 'toggled' } | { outcome: 'rejected'; reason: string };

export async function toggleStock(input: ToggleStockInput): Promise<ToggleStockResult> {
  const { branchId, target, available } = input;

  const cookieStore = await cookies();
  const staffToken = cookieStore.get(STAFF_SESSION_COOKIE_NAME)?.value;
  const staffSession = staffToken ? await verifyStaffSessionToken(staffToken) : null;

  if (!staffSession) {
    return { outcome: 'rejected', reason: 'NOT_AUTHENTICATED' };
  }
  if (!staffSession.bids.includes(branchId)) {
    return { outcome: 'rejected', reason: 'BRANCH_NOT_AUTHORIZED' };
  }
  if (!canToggleStock({ role: staffSession.role, overrideAuth: staffSession.overrideAuth })) {
    return { outcome: 'rejected', reason: 'ROLE_NOT_PERMITTED' };
  }

  const tenantId = staffSession.tid;
  const actorUid = staffSession.uid;
  const availabilityRef = adminDb.doc(`tenants/${tenantId}/branches/${branchId}/live/availability`);

  const key = target.kind === 'item' ? target.itemId : `${target.itemId}:${target.optionId}`;

  return adminDb.runTransaction(async (tx): Promise<ToggleStockResult> => {
    const snap = await tx.get(availabilityRef);
    const current = ((snap.exists ? snap.data() : undefined) ?? {}) as Partial<AvailabilityDoc>;

    const items: Record<string, AvailabilityEntry> = { ...(current.unavailableItems ?? {}) };
    const options: Record<string, AvailabilityEntry> = { ...(current.unavailableModifierOptions ?? {}) };
    const targetMap = target.kind === 'item' ? items : options;

    if (available) {
      // restoring — drop the key entirely (`Reflect.deleteProperty`
      // rather than `delete`, which strict TS refuses on a non-optional
      // `Record` value).
      Reflect.deleteProperty(targetMap, key);
    } else {
      targetMap[key] = {
        reason: input.reason ?? '86',
        until: null,
        byUid: actorUid,
        at: Date.now(),
      };
    }

    // Whole-doc `set` (no merge) so the delete above actually removes the
    // key from Firestore, and so a first-ever 86 creates the doc.
    tx.set(availabilityRef, {
      updatedAt: Date.now(),
      unavailableItems: items,
      unavailableModifierOptions: options,
    } satisfies AvailabilityDoc);

    return { outcome: 'toggled' };
  });
}

/**
 * `markOrderServed` — `ready → served`. A thin, purpose-named wrapper over
 * `advanceTicket`: same cookie verification, the same `checkTransition`
 * role gate (§2.2's `ready → served` row = server/cashier/manager/owner),
 * the same transaction that stamps `servedAt` and appends the `events`
 * audit row, the same idempotency (`already_there` if it was already
 * served — a double-tap on a laggy handheld never errors). Replaces the
 * Waiter Ready-Tickets panel's local-`Set` mock.
 *
 * Kept as its own export rather than having the panel call
 * `advanceTicket({ to: 'served' })` directly, so "mark served" reads as
 * one named operation at the call site and a future served-specific
 * concern (a floor FCM, a covers rollup) has an obvious home.
 */
export async function markOrderServed(input: { branchId: string; orderId: string }): Promise<AdvanceTicketResult> {
  return advanceTicket({ branchId: input.branchId, orderId: input.orderId, to: 'served' });
}
