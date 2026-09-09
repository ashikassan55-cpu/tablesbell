/**
 * src/types/firestore.ts
 *
 * Canonical Firestore document interfaces — the single source of truth
 * RULES.md §4.2 mandates: "Types flow one way: types/firestore.ts →
 * converters → services → actions → components... If the canonical type
 * doesn't yet cover a field a component needs, the fix is to add the
 * field to the canonical type, not to work around it locally."
 *
 * PARTIAL FILE: the `orders/{orderId}` shape (ARCHITECTURE.md §1.8) was
 * defined first, because it's what the KDS ticket queue needed. The
 * `menuItems`/`modifierGroups` shapes below were added for the Stock
 * Board — every collection's type gets added here the same way, as the
 * surface that needs it gets built.
 *
 * `MenuItem`/`ModifierGroup`/`ModifierOption` were never spelled out
 * field-for-field anywhere in the approved v3.0 architecture (§1.5 only
 * lists the collection paths, `/menuItems/{itemId}`,
 * `/modifierGroups/{groupId}`, without expanding them) — but
 * `order.service.ts`'s `resolveAndPriceLines` already depends on this
 * exact shape (its local `ModifierOption`/`ModifierGroup`/
 * `MenuPublishedItem` interfaces), so these definitions match that
 * already-reviewed, already-shipped code rather than inventing a second,
 * possibly-divergent version. `categoryId` is the one field added beyond
 * what `order.service.ts` needed: that file only ever sees an item
 * already nested inside `MenuPublishedCategory.items[]` (category
 * membership expressed structurally), but the raw `menuItems/{itemId}`
 * document this type represents is a Firestore document with no such
 * nesting — it needs its own field to record which category it belongs
 * to.
 *
 * `Table`/`TableParty`/`TableActiveCall` (added for the Cashier
 * Dashboard) match ARCHITECTURE.md §1.6's `tables/{tableId}` schema
 * field-for-field — that section, unlike §1.5, was written out in full
 * detail, so this is a direct transcription rather than a gap-fill.
 *
 * `StaffAlert` (also added for the Cashier Dashboard) is new: §8.7
 * describes `staffAlerts += { type: 'ghost_flagged' }` as one step of the
 * real `flagGhostOrder` transaction, but never formalized the collection's
 * full document shape. `'ghost_suspected'` is a value this build
 * introduced in the KDS ticket-detail pass (see
 * ghost-order-report-dialog.tsx) specifically to distinguish an
 * unconfirmed kitchen report from `'ghost_flagged'`'s confirmed,
 * already-executed ban event — the two must never be the same value, or
 * a reviewing manager could not tell a suspicion from a completed ban.
 */

export type LocalizedText = { en: string; ar: string };

export interface ModifierOption {
  id: string;
  name: LocalizedText;
  priceDeltaFils: number;
  isDefault: boolean;
  available: boolean;
}

export interface ModifierGroup {
  id: string;
  name: LocalizedText;
  minSelect: number;
  maxSelect: number;
  required: boolean;
  options: ModifierOption[];
}

export type MenuItemStatus = 'active' | 'draft' | 'archived';

export interface MenuItem {
  id: string;
  categoryId: string;
  sku: string;
  name: LocalizedText;
  priceFils: number;
  stationId: string;
  status: MenuItemStatus;
  modifierGroups: ModifierGroup[];
}

/**
 * The menu as an editable / publishable TREE (DECISIONS.md ADR-8). A
 * category finally carries a real `name` — closing the "raw category id
 * shown to guests" gap `use-live-menu.ts` / `use-live-catalog.ts` both
 * flagged — plus a `sortIndex`. Items nest structurally; each is a
 * canonical `MenuItem` whose `categoryId` is kept equal to its parent's
 * `id` on every write.
 *
 * `MenuDraftDoc` lives at `tenants/{t}/branches/{b}/menuDraft/current`
 * (owner/manager-only, never guest-readable — it may hold a not-yet-live
 * price). `publishMenu` snapshots its `categories` into
 * `menuPublished/v{n}` as a `MenuPublishedDoc` and bumps
 * `branches/{b}.menuVersion`.
 */
export interface MenuTreeCategory {
  id: string;
  name: LocalizedText;
  sortIndex: number;
  items: MenuItem[];
}

export interface MenuPublishedDoc {
  version: number;
  publishedAt: number;
  publishedByUid: string;
  categories: MenuTreeCategory[];
}

export interface MenuDraftDoc {
  updatedAt: number;
  updatedByUid: string;
  /** Highest `menuPublished` version cut from this draft; `0` = never. */
  lastPublishedVersion: number;
  categories: MenuTreeCategory[];
}

/**
 * Matches `firestore.rules`' own `isStaff()` role list exactly
 * (`request.auth.token.role in ['owner','manager','cashier','server',
 * 'kitchen']`). Was briefly defined in `lib/cashier/mock-staff.ts` and
 * promoted here when that mock file still existed; `mock-staff.ts` is now
 * DELETED and the real role predicates that used to sit beside it live in
 * `lib/console/staff-permissions.ts` (`canExecuteBan`,
 * `canVoidSentLine`). This type is their single source of truth.
 */
export type StaffRole = 'cashier' | 'server' | 'kitchen' | 'manager' | 'owner';

export type StaffMemberStatus = 'active' | 'inactive' | 'suspended';

/**
 * `tenants/{t}/members/{uid}` — ARCHITECTURE.md §1.6, field-for-field, and
 * the exact shape `scripts/seed-staff-member.ts` writes and
 * `staff-login.service.ts` reads a subset of. `uid` is the document id.
 * `allow write: if false` for every client — only the Admin SDK
 * (`staff.actions.ts`'s `upsertStaff`, or the seed script) creates or
 * edits one. Manager / owner can READ the collection (`firestore.rules`),
 * but the browser is never handed `pinHash` — `listStaff` returns
 * sanitised summaries only.
 *
 * ROLE IS SINGLE, not a set (see DECISIONS.md ADR-10): the `tb_staff`
 * cookie, the Firebase custom claims, and every `firestore.rules` check
 * carry exactly one `role`. `manager` already subsumes the front-of-house
 * abilities of `cashier` / `server`; `kitchen` is the one genuinely
 * separate capability.
 *
 * Timestamp fields (`pinUpdatedAt`, `pinLockedUntil`, `lastActiveAt`,
 * `createdAt`) are written as `serverTimestamp()` and read back as
 * Firestore `Timestamp`; normalised to epoch-ms on the read paths that
 * surface them.
 */
export interface StaffMember {
  uid: string;
  displayName: string;
  /** The identifier a member types first at `/lock`; `[A-Za-z0-9]{1,10}`,
   *  unique within the tenant. NOT an email — this system is PIN-pad auth. */
  staffCode: string;
  role: StaffRole;
  jobTitle: string;
  branchIds: string[];
  zoneIds: string[];
  stationIds: string[];
  /** argon2id PHC string (`staff-pin.ts`). Never leaves the server. */
  pinHash: string;
  pinUpdatedAt: number | null;
  pinFailedAttempts: number;
  pinLockedUntil: number | null;
  overrideAuth: boolean;
  status: StaffMemberStatus;
  lastActiveAt: number | null;
  createdAt: number | null;
  createdBy: string;
}

/** The browser-safe projection of `StaffMember` — no `pinHash`, no lockout
 *  internals beyond "is it locked right now". Returned by `listStaff`. */
export interface StaffMemberSummary {
  uid: string;
  displayName: string;
  staffCode: string;
  role: StaffRole;
  jobTitle: string;
  branchIds: string[];
  overrideAuth: boolean;
  status: StaffMemberStatus;
  lastActiveAt: number | null;
  pinSetAt: number | null;
  lockedUntil: number | null;
}

/**
 * `branches/{b}.settings` — per-branch localization (DECISIONS.md ADR-11),
 * editable in the Manager Store Settings view. `vatPpm` is VAT as
 * parts-per-million (50_000 = 5%, 85_000 = 8.5%) — the same unit
 * `pricing.service.ts`'s `splitInclusive` takes, so no float ever touches
 * the money path. Absent / partial ⇒ AED / 5% / empty footer
 * (`lib/branch-settings.ts` `DEFAULT_BRANCH_SETTINGS`). `priceOrderRequest`
 * SNAPSHOTS `currency` + `vatPpm` onto every `Order` at price time, so a
 * mid-meal settings change never retro-alters an existing ticket or bill.
 */
export interface BranchSettings {
  currency: string; // ISO-4217-ish code: 'AED' | 'USD' | 'GBP' | 'EUR' | 'SAR'
  vatPpm: number;
  receiptFooter: string;
}

export type OrderStatus = 'new' | 'prep' | 'ready' | 'served' | 'voided';
export type LineStatus = 'queued' | 'prep' | 'ready' | 'served';
export type OrderPriority = 'normal' | 'urgent';
export type PaymentStatus = 'UNPAID' | 'PAID_CASH' | 'PAID_CARD';

export interface OrderModifier {
  groupId: string;
  optionId: string;
  nameSnapshot: LocalizedText;
  priceDeltaFils: number;
}

export interface OrderLineVoid {
  // Tightened from a loose `string`. Kept in lockstep BY HAND with
  // `lib/console/void-reasons.ts`'s `VoidReasonCode` (not imported from
  // there -- `types/firestore.ts` must not depend on `lib/`, RULES.md
  // §4.2). `'server_error'` added with DECISIONS.md ADR-5.
  reason: 'out_of_stock' | 'damaged_accident' | 'customer_changed_mind' | 'server_error';
  note: string;
  byUid: string;
  byRole: string;
  at: number; // epoch ms in this client-side representation — see note below
  creditFils: number;
}

export interface OrderLine {
  lineId: string;
  menuItemId: string;
  sku: string;
  nameSnapshot: LocalizedText;
  qty: number;
  unitPriceFils: number;
  modifiers: OrderModifier[];
  stationId: string;
  status: 'active' | 'voided';
  lineStatus: LineStatus;
  lineTotalFils: number;
  void: OrderLineVoid | null;
}

export interface OrderAdjustment {
  type: 'discount' | 'void_credit' | 'comp' | 'note';
  amountFils: number;
  reason: string;
  byUid: string;
  byRole: string;
  at: number;
}

/**
 * ARCHITECTURE.md §1.8, field-for-field.
 *
 * `placedAt`/`prepStartedAt`/`readyAt`/`servedAt`/`updatedAt` are plain
 * epoch-ms numbers in this client-side type — the real Firestore documents
 * hold `Timestamp` objects. Translating between the two is the job of the
 * eventual `server/firebase/converters.ts` (ARCHITECTURE.md §7.2, not yet
 * built), never a UI component's — components here only ever read `number`.
 */
export interface Order {
  code: string;
  requestId: string;
  clientRequestId: string;
  sessionId: string;
  partyLabel: string;
  tableId: string;
  tableCode: string;
  zoneId: string;
  status: OrderStatus;
  stationIds: string[];
  items: OrderLine[];
  grossFils: number;
  netFils: number;
  vatFils: number;
  voidedFils: number;
  covers: number;
  placedAt: number;
  prepStartedAt: number | null;
  readyAt: number | null;
  servedAt: number | null;
  slaTargetSec: number;
  slaBreached: boolean;
  priority: OrderPriority;
  placedBy: { kind: 'guest' | 'staff'; uid: string };
  /** Denormalised at price time for the KDS / Cashier ticket header
   *  (ADR-11): the staff member's display name for a staff order, else
   *  `null`. `guestName` carries the guest-supplied name for a guest
   *  order (also `null` when not given). */
  placedByName: string | null;
  guestName: string | null;
  /** Localization snapshot (ADR-11) — the branch's `settings` at the
   *  moment this ticket was priced. Every money figure on this document
   *  is in `currency`; net/VAT were split at `vatPpm`. */
  currency: string;
  vatPpm: number;
  guestNote: string;
  requiresStaffApproval: boolean;
  billId: string | null;
  riskScore: number;
  adjustments: OrderAdjustment[];
  paymentStatus: PaymentStatus;
  receiptPrintedAt: number | null;
  updatedAt: number | null;
  updatedBy: string | null;
}

export type TableStatus = 'available' | 'occupied' | 'attention' | 'dirty' | 'disabled';
export type PartyStatus = 'active' | 'idle' | 'billing';

export interface TableParty {
  sessionId: string;
  label: string;
  guestCount: number;
  openTabFils: number;
  status: PartyStatus;
  riskFlagged: boolean;
  openedAt: number;
}

export interface TableActiveCall {
  callId: string;
  // Kept loose here rather than importing serviceCalls' own type enum —
  // that collection's full shape hasn't been added to this file yet, and
  // this field only needs to be legible, not authoritative, from a table
  // document's point of view.
  type: string;
  priority: number;
  createdAt: number;
}

/** ARCHITECTURE.md §1.6, field-for-field. */
export interface Table {
  code: string;
  label: string;
  zoneId: string;
  seats: number;
  sortIndex: number;
  status: TableStatus;
  slug: string;
  slugVersion: number;
  slugRotatedAt: number | null;
  parties: TableParty[];
  partyCount: number;
  openTabFils: number;
  activeCall: TableActiveCall | null;
  assignedServerUid: string | null;
  lastSanitizedAt: number | null;
  nfcTagId: string | null;
}

/**
 * `tableSlugs/{slug}` — the ROOT collection ARCHITECTURE.md §8.1 maps an
 * opaque printed slug to its location. `allow read, write: if false`;
 * only the Admin SDK (`slug.service.ts` to resolve, `table.actions.ts`
 * to mint / rotate) ever touches it. `version` mirrors
 * `Table.slugVersion`; `active: false` is a rotated-away-from slug, which
 * `resolveTableSlug` collapses into the same `not_found` as "never
 * existed" (the §8.1 uniform-failure guarantee).
 */
export interface TableSlugDoc {
  tenantId: string;
  branchId: string;
  tableId: string;
  version: number;
  active: boolean;
}

export type StaffAlertType = 'ghost_suspected' | 'ghost_flagged' | 'table_move' | 'bill_request';
export type StaffAlertStatus = 'open' | 'resolved';

export interface StaffAlert {
  id: string;
  type: StaffAlertType;
  tableCode: string;
  orderCode: string | null;
  sessionId: string | null;
  note: string;
  reportedByRole: string;
  createdAt: number;
  status: StaffAlertStatus;
  /** Set when the alert is resolved (Cashier/Waiter "Dismiss", or a
   *  future auto-resolve). Absent while `status === 'open'`. */
  resolvedByUid?: string | null;
  resolvedAt?: number | null;
}

/**
 * `live/availability` — formalized here now that the founder has made an
 * explicit call `lib/kds/stock-catalog.ts` had left open: modifier-option
 * toggles get the SAME sub-second broadcast path as item toggles, not a
 * slower `menuPublished`-republish one. "During peak rushes we cannot
 * risk taking orders for 86'd modifiers" — so `unavailableModifierOptions`
 * is not a nice-to-have addition, it's the schema this decision requires.
 *
 * KEYING NOTE, the one real design decision this formalization required:
 * a modifier option's `id` (e.g. `opt_oat`) is only unique WITHIN its
 * parent item's group — `stock-catalog.ts`'s own mock data already reuses
 * `opt_oat`/`opt_whole` verbatim across two different items (Cortado and
 * Brioche both have an `mg_milk` group with those exact option ids). A
 * flat map keyed by the bare option id would make toggling "oat milk" on
 * one item incorrectly affect the other. Keys here are therefore
 * `${menuItemId}:${optionId}` — qualified, never ambiguous.
 */
export interface AvailabilityEntry {
  reason: string;
  until: number | null;
  byUid: string;
  at: number;
}

export interface AvailabilityDoc {
  updatedAt: number;
  unavailableItems: Record<string, AvailabilityEntry>; // keyed by menuItemId
  unavailableModifierOptions: Record<string, AvailabilityEntry>; // keyed by `${menuItemId}:${optionId}`
}

// --- Guest session (ARCHITECTURE.md §3.1) ----------------------------
//
// The FULL `tenants/{t}/branches/{b}/sessions/{sessionId}` document,
// typed for the first time here -- previously only referenced by field
// name in comments and mock data, never formalized. `TableParty` above
// is the smaller, DENORMALIZED copy of a slice of this that lives on
// `tables/{tableId}.parties[]`; the two are related but not identical
// shapes, and are kept in sync by whoever writes both (currently
// `session.service.ts`'s `resolveGuestSession` -- see that file's header
// for why it, not a `sessions` onWrite trigger, currently owns that
// sync).

export type GuestSessionStatus = 'active' | 'idle' | 'billing' | 'closed';

export type GuestSessionSource = 'qr' | 'nfc' | 'invite' | 'staff';

export interface GuestSessionMoveHistoryEntry {
  fromTableId: string;
  toTableId: string;
  at: number;
  by: 'guest' | 'staff';
  actorUid: string;
}

/**
 * Risk-scoring inputs. ARCHITECTURE.md names this field but the
 * network.service.ts that would actually populate `asn`/`venueMatch`
 * doesn't exist yet -- every field below is written as an honest null/0
 * default at session creation, not a guess at what real scoring output
 * looks like.
 */
export interface GuestSessionNetwork {
  firstIpHash: string | null;
  currentIpHash: string | null;
  asn: number | null;
  venueMatch: boolean | null;
  mismatchCount: number;
  lastCheckedAt: number | null;
}

export interface GuestSessionRisk {
  score: number;
  flags: string[];
}

export interface GuestSessionRunningTotals {
  grossFils: number;
  netFils: number;
  vatFils: number;
}

// --- Guest order request (ARCHITECTURE.md §1.7) -----------------------
//
// The one collection a guest write path actually creates documents in.
// Mirrors `order.service.ts`'s own local `OrderRequestDoc`/
// `OrderRequestLine` interfaces field-for-field, confirmed against that
// file directly rather than assumed from ARCHITECTURE.md's §1.7 example
// alone -- `status` there includes `'duplicate'`, a fourth value the
// architecture doc's inline snippet doesn't show (it only ever shows a
// document at CREATE time, when `status` is always `'pending'`). Typed
// here, for the first time, so the guest-side write
// (`cart-checkout-view.tsx`) and the server-side reader
// (`order.service.ts`, once relocated into `src/` -- see MEMORY.md §4)
// share one definition instead of two hand-copied ones drifting apart.

export type OrderRequestStatus = 'pending' | 'priced' | 'rejected' | 'duplicate';

export interface OrderRequestLine {
  itemId: string;
  qty: number;
  modifierOptionIds: string[];
}

/**
 * Who authored an `orderRequests` document. ABSENT on a guest write (the
 * `cart-checkout-view.tsx` `addDoc` path, whose `keys().hasOnly` rule
 * forbids extra keys) — treat a missing `placedBy` as `{ kind: 'guest' }`.
 * PRESENT (with `kind: 'staff'`) only on a `placeStaffOrder` write, which
 * runs through the Admin SDK and so isn't bound by that rule. `priceOrder-
 * Request` reads it to skip the party-membership check and to stamp the
 * priced ticket's own `placedBy`. See DECISIONS.md ADR-6.
 */
export interface OrderRequestPlacedBy {
  kind: 'guest' | 'staff';
  uid: string;
}

/**
 * The shape a GUEST WRITES. `createdAt` is typed as `number` here for
 * consistency with every other canonical type in this file (all of which
 * represent an already-read, already-resolved document as plain epoch
 * ms) -- the actual client write sends Firestore's `serverTimestamp()`
 * sentinel for this field, not a number; see `cart-checkout-view.tsx`'s
 * own comment on why that distinction matters (`firestore.rules`'
 * `authoredNow()` requires it to equal `request.time` exactly, which a
 * client-computed `Date.now()` value never does).
 */
export interface OrderRequest {
  sessionId: string;
  tableId: string;
  lines: OrderRequestLine[];
  note: string;
  clientRequestId: string;
  createdBy: string;
  createdAt: number;
  status: OrderRequestStatus;
  /** Absent = guest-placed. `{ kind: 'staff', uid }` on a `placeStaffOrder`
   *  write (DECISIONS.md ADR-6). */
  placedBy?: OrderRequestPlacedBy;
  /** ADR-11 order attribution. `guestName` is the optional name a diner
   *  types on the checkout screen (guest write — allowed by
   *  `firestore.rules` `keys().hasOnly`); `placedByName` is the staff
   *  member's display name, written by `placeStaffOrder` (Admin SDK).
   *  Both copied onto the priced `Order`. */
  guestName?: string;
  placedByName?: string;
  // Present only once a Cloud Functions trigger (`priceOrderRequest`)
  // has actually resolved this request. All optional because a freshly-
  // created, still-`'pending'` document has none of them.
  orderId?: string;
  pricedAt?: number;
  rejectedAt?: number;
  resolvedAt?: number;
  /** A machine-readable code (`'CALLER_BANNED'`, `'RATE_LIMITED'`,
   *  `'ITEM_NOT_FOUND'`, …) -- NEVER shown to a guest verbatim. See
   *  `cart-checkout-view.tsx`'s rejection-message mapping for why. */
  reason?: string;
  /** Present only alongside a small subset of `reason` values
   *  (`order.service.ts`'s `ITEM_NOT_FOUND` case, currently the only
   *  one) -- optional, not guaranteed on every rejection. */
  rejectionDetail?: string;
}

export interface GuestSession {
  partyLabel: string;
  tableId: string;
  tableCode: string;
  zoneId: string;
  status: GuestSessionStatus;
  hostUid: string;
  joinedUids: string[];
  deviceIds: string[];
  /**
   * A 4-digit numeric string minted once by `createPartySession`, never
   * mutated. The planned solution to the "QR-scan divergence" (DECISIONS.md
   * ADR-7): a guest scanning a table that already has an open party is
   * asked for this PIN before being merged onto the existing bill, so a
   * stranger at a neighbouring table cannot cart-bomb someone else's tab.
   * Readable only by staff and by guests already in the party
   * (`firestore.rules` `sessions` read gate) — a not-yet-joined scanner
   * never sees it, they submit a candidate to a server action that checks
   * it. The guest-facing PIN-entry UI and that join action are NOT built
   * yet; this field is the backend prep for them.
   */
  joinPin: string;
  guestCount: number;
  openedAt: number;
  lastActivityAt: number;
  idleAt: number | null;
  wokenAt: number | null;
  closedAt: number | null;
  closedBy: string | null;
  closeReason: string | null;
  network: GuestSessionNetwork;
  risk: GuestSessionRisk;
  runningTotals: GuestSessionRunningTotals;
  orderCount: number;
  itemCount: number;
  billId: string | null;
  moveHistory: GuestSessionMoveHistoryEntry[];
  locale: string;
  source: GuestSessionSource;
  /**
   * The staff member's uid when a waiter opened this table manually
   * (`openTableSession` — a guest with no phone / no internet who ordered
   * verbally); `null` for a normal QR/NFC/invite session. `source` is
   * `'staff'` in the same case, so this field is the *who*, not the
   * *whether*.
   */
  openedByStaffUid: string | null;
  /**
   * The bill-print / bill-request workflow (`server/actions/bill.actions.ts`).
   * `billingRequestedAt` is stamped when `requestBill` flips `status` to
   * `'billing'`. `printCount` starts at 0; `printBill` increments it —
   * `printCount > 0` at print time means the copy is a DUPLICATE.
   */
  billingRequestedAt: number | null;
  printCount: number;
  lastPrintedAt: number | null;
  /** ADR-11 — the guest-supplied name from the checkout screen, copied
   *  onto the session the first time any order in the party carries one
   *  (so the Cashier can label the whole tab, not just one ticket).
   *  `null` until then. Never asked at QR scan. */
  guestName: string | null;
}
