/**
 * src/lib/console/void-reasons.ts
 *
 * `void.reason` (ARCHITECTURE.md §1.8, §2.5). Moved here from `lib/kds/`
 * once the void flow stopped being KDS-only: as of DECISIONS.md ADR-5 the
 * Cashier terminal is a first-class void surface too, so a KDS-namespaced
 * home no longer fits. Importers: `components/ops/void-line-dialog.tsx`
 * (KDS, dark), `components/cashier/void-line-dialog.tsx` (Cashier, light),
 * `server/actions/bill.actions.ts` (the real transaction), and
 * `components/ops/ticket-detail-view.tsx`.
 *
 * Casing: lowercase snake_case, matching the one prior precedent for this
 * field (`'out_of_stock'` in §2.5's sequence diagram) and every other
 * enum-like string on the Order document. `types/firestore.ts`'s
 * `OrderLineVoid.reason` union is kept in lockstep with `VoidReasonCode`
 * below by hand -- adding a code here means adding it there too.
 *
 * `'server_error'` was added with ADR-5: a cashier voiding a mis-keyed
 * line ("wrong item sent to the kitchen") is a distinct accountability
 * category from a guest changing their mind or a dropped plate, and the
 * revised boundary makes cashier-initiated voids common enough to name it.
 */

export type VoidReasonCode = 'out_of_stock' | 'damaged_accident' | 'customer_changed_mind' | 'server_error';

export interface VoidReasonOption {
  code: VoidReasonCode;
  label: string;
}

export const VOID_REASON_OPTIONS: VoidReasonOption[] = [
  { code: 'customer_changed_mind', label: 'Guest Changed Mind' },
  { code: 'server_error', label: 'Server / Keying Error' },
  { code: 'damaged_accident', label: 'Dropped / Damaged' },
  { code: 'out_of_stock', label: 'Out of Stock' },
];

const VALID_CODES = new Set<string>(VOID_REASON_OPTIONS.map((option) => option.code));

/** Runtime guard for an untrusted `reason` string arriving at a server
 *  action boundary -- narrows to `VoidReasonCode` or returns false. */
export function isVoidReasonCode(value: unknown): value is VoidReasonCode {
  return typeof value === 'string' && VALID_CODES.has(value);
}
