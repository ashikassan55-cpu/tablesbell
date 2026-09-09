/**
 * src/lib/console/staff-permissions.ts
 *
 * The REAL staff role/permission predicates, replacing the ones that
 * lived in `lib/cashier/mock-staff.ts` (now deleted). Nothing here is
 * mock -- these are the authorization boundaries themselves. The mock
 * file's own header always said "the TYPE ... outlives that file" about
 * `StaffRole`; the same is true of these predicates, so they move to a
 * real, non-mock home rather than dying with it.
 *
 * WHY `lib/console/` (client-importable), not `server/`: these run in
 * client components (`alerts-inbox.tsx` hides a button, `table-detail-
 * panel.tsx` renders a permission-explanation state) AS WELL AS in the
 * server actions that actually gate the write (`bill.actions.ts`'s
 * `voidTicketLine`). The client use is courtesy/UX; the server use is
 * authority. Same predicate, both places, exactly the "check it more than
 * once" discipline `advanceTicket` and `firestore.rules`' IDOR gate
 * already follow.
 *
 * PERMISSION BOUNDARY REVISION (2026-09-09) -- see DECISIONS.md ADR-5.
 * The Waiter Floor's per-action step-up PIN challenge
 * (`pin-challenge-modal.tsx`) is GONE, along with `canToggleOpenFloorMode`
 * and Open Floor Mode itself. The new boundary is role-based off the
 * terminal's own `tb_staff` session, no per-action re-auth:
 *   - a `server` (waiter) can remove lines from a DRAFT cart only, never
 *     void a line once the order is sent -- so there is deliberately no
 *     "canVoid" predicate that returns true for `server`;
 *   - `cashier`/`manager`/`owner` void sent lines from their own terminal;
 *   - `kitchen` retains line-void via the KDS path (ARCHITECTURE.md §2.5),
 *     which will call the same `voidTicketLine` action once wired.
 */

import type { StaffRole } from '@/types/firestore';

/** The minimum a permission check needs. Both `StaffIdentity` and the
 *  full `StaffSessionPayload` (`server/auth/staff-session-cookie.ts`)
 *  satisfy it structurally -- deliberately NOT importing that server-only
 *  type here, so this module stays clean to bundle into a client
 *  component. */
export interface StaffPermissionSubject {
  role: StaffRole;
  overrideAuth: boolean;
}

/**
 * The client-facing identity a console surface renders and checks against
 * -- the `tb_staff` session minus the fields only middleware / server
 * actions care about (`tid`, `bids`). Derived once in a Server Component
 * and passed down as a prop.
 */
export interface StaffIdentity {
  uid: string;
  displayName: string;
  role: StaffRole;
  overrideAuth: boolean;
}

/** Narrow a verified `tb_staff` session payload down to the client-facing
 *  identity. Called only in Server Components. Takes the structural shape
 *  rather than importing `StaffSessionPayload` from `server/`. */
export function toStaffIdentity(session: {
  uid: string;
  displayName: string;
  role: StaffRole;
  overrideAuth: boolean;
}): StaffIdentity {
  return {
    uid: session.uid,
    displayName: session.displayName,
    role: session.role,
    overrideAuth: session.overrideAuth,
  };
}

const ROLE_LABEL: Record<StaffRole, string> = {
  owner: 'Owner',
  manager: 'Manager',
  cashier: 'Cashier',
  server: 'Server',
  kitchen: 'Kitchen',
};

export function roleLabel(role: StaffRole): string {
  return ROLE_LABEL[role];
}

/**
 * `flagGhostOrder`'s permanent-ban effect (ARCHITECTURE.md §8.7).
 * manager/owner AND `overrideAuth` -- never a cashier, never a server,
 * never kitchen. Unchanged by the 2026-09-09 revision.
 */
export function canExecuteBan(s: StaffPermissionSubject): boolean {
  return (s.role === 'manager' || s.role === 'owner') && s.overrideAuth;
}

/**
 * Void a line on an already-SENT order (ARCHITECTURE.md §2.5, as revised
 * by DECISIONS.md ADR-5). Everyone EXCEPT `server`: cashier/manager/owner
 * gain this at their terminal, kitchen keeps it via KDS. A waiter who
 * needs a sent line voided asks the cashier verbally -- there is no
 * terminal path for it, by design.
 */
export function canVoidSentLine(s: StaffPermissionSubject): boolean {
  return s.role === 'cashier' || s.role === 'kitchen' || s.role === 'manager' || s.role === 'owner';
}

/**
 * 86 a menu item or a modifier option — ARCHITECTURE.md §2.4's
 * `toggleStock`, "role-gated kitchen/manager/owner". Front-of-house
 * (cashier/server) never touches the kitchen's stock state.
 */
export function canToggleStock(s: StaffPermissionSubject): boolean {
  return s.role === 'kitchen' || s.role === 'manager' || s.role === 'owner';
}

/**
 * Take an order on a party's behalf (`placeStaffOrder`, DECISIONS.md
 * ADR-6). Front-of-house — `server` is the primary; `cashier`/`manager`/
 * `owner` can too. `kitchen` cannot (they cook, they don't take orders).
 */
export function canPlaceStaffOrder(s: StaffPermissionSubject): boolean {
  return s.role === 'server' || s.role === 'cashier' || s.role === 'manager' || s.role === 'owner';
}

/**
 * Drive the bill lifecycle for a party (DECISIONS.md ADR-7): flip a
 * session to `billing` via `requestBill`, run `printBill` (incl. a
 * duplicate reprint), and dismiss a `bill_request` alert
 * (`resolveStaffAlert`). Same front-of-house set as `canPlaceStaffOrder`
 * — a waiter fields "can we get the bill?" at the table and a cashier
 * settles it; `kitchen` has no part in it. Kept a distinct predicate from
 * `canPlaceStaffOrder` so the two can diverge (e.g. a future "servers
 * can request but not print") without disturbing order entry.
 */
export function canHandleBilling(s: StaffPermissionSubject): boolean {
  return s.role === 'server' || s.role === 'cashier' || s.role === 'manager' || s.role === 'owner';
}

/**
 * The Manager Menu Maker (DECISIONS.md ADR-8): edit the draft catalog and
 * `publishMenu` a new `menuPublished/v{n}`. `manager` / `owner` ONLY — a
 * cashier or server never touches menu structure or prices, and kitchen
 * only ever toggles *availability* (`canToggleStock`), never the menu
 * itself. This is the same `hasRole(['owner','manager'])` line
 * `firestore.rules` draws for every other back-office collection
 * (`members`, `bannedIdentities`, `analyticsDaily`, the `menuDraft` doc).
 */
export function canManageMenu(s: StaffPermissionSubject): boolean {
  return s.role === 'manager' || s.role === 'owner';
}

/**
 * Manager Table Management (ARCHITECTURE.md §1.6, §8.1): define physical
 * tables, toggle `available`/`disabled`, mint / rotate the printed
 * cryptographic slug. `manager` / `owner` only — the same back-office
 * line as `canManageMenu`. Kept a distinct predicate so the two can
 * diverge (a chain might let a branch manager edit tables but not the
 * shared menu).
 */
export function canManageTables(s: StaffPermissionSubject): boolean {
  return s.role === 'manager' || s.role === 'owner';
}

/**
 * Manager Staff Management (ARCHITECTURE.md §1.6, DECISIONS.md ADR-10):
 * add team members, set their `staffCode` / PIN / role / branches /
 * override authority, and revoke access (`status`). `manager` / `owner`
 * only — the same `hasRole(['owner','manager'])` line `firestore.rules`
 * already draws for reading `members`. A distinct predicate from
 * `canManageMenu` / `canManageTables` so a deployment could, later, let a
 * branch manager edit tables but not staff.
 */
export function canManageStaff(s: StaffPermissionSubject): boolean {
  return s.role === 'manager' || s.role === 'owner';
}

/**
 * Manager Store Settings (DECISIONS.md ADR-11): branch display name,
 * currency code, VAT rate, receipt footer. `manager` / `owner` only —
 * the VAT rate feeds `priceOrderRequest`'s money math, so this is not a
 * front-of-house control.
 */
export function canManageSettings(s: StaffPermissionSubject): boolean {
  return s.role === 'manager' || s.role === 'owner';
}
