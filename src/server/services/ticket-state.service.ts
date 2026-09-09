/**
 * src/server/services/ticket-state.service.ts
 *
 * ARCHITECTURE.md §2.2's transition matrix, transcribed as data rather
 * than scattered `if` statements — that section names this exact file as
 * "the single source of truth, unit-tested exhaustively over the
 * transition matrix," so the matrix is written out completely here (all
 * five rows), even though only two of them have a real caller as of this
 * pass (`advanceTicket`'s `new → prep` and `prep → ready` — see
 * `server/actions/kds.actions.ts`). The `ready → prep` back-step,
 * `ready → served`, and any-non-terminal `→ voided` rows are real,
 * present, and already correct against the architecture doc — just not
 * yet called from anywhere, since this pass's task named "advancing
 * tickets from new to prep to ready" specifically, not the full state
 * machine. Building the other three rows as unreachable dead code would
 * have been worse than not building them; building them as CORRECT,
 * inert data the next caller (a `markServed`/`ready→prep`/`voidTicket`
 * action) can query without re-deriving the matrix is not the same
 * thing.
 *
 * PURE, NO I/O — deliberately, matching `order.service.ts`'s own
 * "pure domain logic ... unit-tested" framing for `resolveAndPriceLines`.
 * `server/actions/kds.actions.ts` is where this gets combined with an
 * actual Firestore transaction; this file only ever answers "is this
 * transition legal for this actor," nothing more.
 *
 * IDEMPOTENCY, ARCHITECTURE.md §2.2's own explicit requirement: "All
 * transitions are idempotent: replaying a landed transition returns the
 * current document rather than erroring. A chef double-tapping on a
 * laggy tablet must never see a failure toast." `checkTransition` below
 * returns a distinct `{ legal: true; alreadyThere: true }` result when
 * the ticket is ALREADY at the requested target status — the caller
 * (`advanceTicket`) is expected to treat that as a successful no-op, not
 * attempt a write.
 */

import type { OrderStatus, StaffRole } from '@/types/firestore';

export type TicketSideEffectField = 'prepStartedAt' | 'readyAt' | 'servedAt';

export interface TicketActor {
  role: StaffRole;
  /** Only meaningful for the `→ voided` row (ARCHITECTURE.md §8.7's
   *  ban-execution authority pattern, reused here for the identical
   *  "manager/owner, AND specifically authorized" gate on a full-order
   *  void). Ignored by every other row. */
  overrideAuth: boolean;
}

interface TransitionRule {
  from: OrderStatus;
  to: OrderStatus;
  roles: readonly StaffRole[];
  requireOverrideAuth: boolean;
  /** The field a successful transition stamps with the transaction's
   *  server timestamp. `null` for `voided`, whose write shape is
   *  different in kind (a bill credit + guest alert, not a single
   *  timestamp field) and out of THIS file's scope to model until the
   *  `voidTicket` action that actually needs it is built. */
  sideEffectField: TicketSideEffectField | null;
}

// ARCHITECTURE.md §2.2's table, field-for-field, in table order.
const TRANSITIONS: readonly TransitionRule[] = [
  { from: 'new', to: 'prep', roles: ['kitchen', 'manager', 'owner'], requireOverrideAuth: false, sideEffectField: 'prepStartedAt' },
  { from: 'prep', to: 'ready', roles: ['kitchen', 'manager', 'owner'], requireOverrideAuth: false, sideEffectField: 'readyAt' },
  { from: 'ready', to: 'served', roles: ['server', 'cashier', 'manager', 'owner'], requireOverrideAuth: false, sideEffectField: 'servedAt' },
  { from: 'ready', to: 'prep', roles: ['kitchen', 'manager', 'owner'], requireOverrideAuth: false, sideEffectField: 'prepStartedAt' },
  // "Any non-terminal → voided" is four rows here (new/prep/ready), not
  // one — an explicit table lookup needs a concrete `from` per row; a
  // wildcard would need its own matching path in checkTransition() for
  // one row only, which is more special-casing than just listing three.
  { from: 'new', to: 'voided', roles: ['manager', 'owner'], requireOverrideAuth: true, sideEffectField: null },
  { from: 'prep', to: 'voided', roles: ['manager', 'owner'], requireOverrideAuth: true, sideEffectField: null },
  { from: 'ready', to: 'voided', roles: ['manager', 'owner'], requireOverrideAuth: true, sideEffectField: null },
] as const;

export type TransitionCheckResult =
  | { legal: true; alreadyThere: true }
  | { legal: true; alreadyThere: false; sideEffectField: TicketSideEffectField | null }
  | { legal: false; reason: 'ALREADY_TERMINAL' | 'ILLEGAL_TRANSITION' | 'ROLE_NOT_PERMITTED' | 'OVERRIDE_AUTH_REQUIRED' };

/**
 * The one function this file exports for a caller to actually use.
 * `current` is the ticket's status as read fresh inside the caller's own
 * transaction (never trust a client-supplied "from") — see
 * `kds.actions.ts` for why that distinction matters.
 */
export function checkTransition(current: OrderStatus, to: OrderStatus, actor: TicketActor): TransitionCheckResult {
  if (current === to) {
    return { legal: true, alreadyThere: true };
  }

  if (current === 'served' || current === 'voided') {
    // Both are genuine terminal states in ARCHITECTURE.md §2.2's diagram
    // -- nothing transitions out of either, not even a void.
    return { legal: false, reason: 'ALREADY_TERMINAL' };
  }

  const rule = TRANSITIONS.find((r) => r.from === current && r.to === to);
  if (!rule) {
    return { legal: false, reason: 'ILLEGAL_TRANSITION' };
  }

  if (!rule.roles.includes(actor.role)) {
    return { legal: false, reason: 'ROLE_NOT_PERMITTED' };
  }
  if (rule.requireOverrideAuth && !actor.overrideAuth) {
    return { legal: false, reason: 'OVERRIDE_AUTH_REQUIRED' };
  }

  return { legal: true, alreadyThere: false, sideEffectField: rule.sideEffectField };
}
