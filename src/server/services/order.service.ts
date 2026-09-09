/**
 * src/server/services/order.service.ts
 *
 * The sole price authority. Implements ARCHITECTURE.md v3.0 Section 2.1
 * (`priceOrderRequest`) end to end: re-validates an `orderRequests`
 * document against live, trusted server state; sanitizes its free-text note;
 * resolves every price from the server-side menu snapshot; derives VAT with
 * zero rounding drift; and writes the priced ticket to `orders` using the
 * Admin SDK, which bypasses `firestore.rules` entirely -- this file, not
 * the rules file, is where that trust is actually exercised.
 *
 * TWO WRITERS FEED THIS NOW (DECISIONS.md ADR-6): the guest client's
 * direct `addDoc` (`cart-checkout-view.tsx`) and the staff `placeStaffOrder`
 * Server Action (`server/actions/staff-order.actions.ts`). Both create an
 * `orderRequests` document; this function is agnostic to which, except
 * that a `placedBy.kind === 'staff'` request skips the party-membership
 * check (a waiter is not a party member) and stamps the ticket's
 * `placedBy` from the request rather than the historical guest default.
 *
 * RELOCATED into `src/` this pass -- this file's own header always named
 * this exact path (see the line above), but the physical file sat at the
 * workspace root, unmoved, since before `src/` itself existed. Moved now
 * because `functions/src/triggers/price-order-request.ts` (this pass's
 * other new file) is the first real caller this module has ever had; the
 * wiring snippet at the bottom of this file already assumed this location
 * (`'../../../src/server/services/order.service'`), so this move makes an
 * already-written import path correct rather than introducing a new one.
 *
 * INVOCATION -- this module is framework-free by design (Section 7.3: "pure
 * domain logic ... unit-tested") so it can be called from either place that
 * needs it:
 *
 *   1. The real, only production path: a Cloud Functions v2 Firestore
 *      trigger on `orderRequests` onCreate --
 *      `functions/src/triggers/price-order-request.ts`, now real, not a
 *      comment. See the wiring snippet at the bottom of this file, which
 *      that real file matches almost verbatim.
 *   2. A local/emulator harness or an internal "reprocess a stuck request"
 *      admin tool inside the Next.js server runtime, calling
 *      `priceOrderRequest()` directly.
 *
 * COMPANION FILE REQUIRED: this module imports `splitInclusive` from
 * `./pricing.service` rather than reimplementing VAT math inline, because
 * Section 1.9 states plainly: "A second implementation of this arithmetic
 * anywhere in the repo is a review-blocking defect." That file already
 * lives alongside this one.
 *
 * WHY THE ADMIN SDK IMPORT BELOW IS A RELATIVE PATH, NOT `@/lib/firebase/
 * admin` -- the one deliberate inconsistency with every sibling file in
 * this directory (`slug.service.ts`, `session.service.ts`,
 * `guest-boot.service.ts` all use the `@/*` alias). This file is compiled
 * TWICE, in two genuinely different toolchains: once by Next.js's own
 * bundler (which rewrites `@/*` per `tsconfig.json`'s `paths`), and once by
 * a PLAIN `tsc` invocation when the `functions/` package builds itself for
 * deployment. Plain `tsc` does NOT rewrite path aliases in its emitted
 * JavaScript -- without a bundler or an extra tool like `tsc-alias` in the
 * loop, a compiled `require('@/lib/firebase/admin')` would reach a deployed
 * Cloud Function and fail at runtime with "Cannot find module '@/lib/
 * firebase/admin'" -- a failure invisible to `tsc --noEmit`'s own type
 * checking, only surfacing when the function actually executes. A relative
 * import has no such failure mode under either toolchain. This is the ONE
 * file in `src/server/services/` that needs to survive being compiled
 * outside Next.js entirely, so it is the one file that pays this small
 * consistency cost on purpose.
 *
 * SCOPING NOTE on "layer" numbering: the sanitizer in this file implements
 * Section 8.4 Layer 2 (deep Unicode normalization, control-character and
 * bidi-override stripping) -- the layer explicitly deferred out of
 * `firestore.rules` because Firestore Rules' RE2 dialect cannot verifiably
 * express Unicode property classes. Layer 5 (the ESC-POS printable-ASCII
 * whitelist) is a *different*, later stage that belongs in
 * `/api/print/[billId]/route.ts`, the only place raw bytes actually reach
 * the thermal printer -- duplicating it here would be redundant and would
 * put print-wire concerns in the pricing path. Layer 2 already removes the
 * ESC byte (0x1B) and every other C0/C1 control byte, so the KDS-facing
 * note this function produces is safe on-screen and safe-in-substance
 * before it ever reaches that later, protocol-specific stage.
 *
 * AVAILABILITY SCHEMA -- RECONCILED THIS PASS, after being logged as a
 * known 3-way drift in MEMORY.md for two passes running (`types/
 * firestore.ts`'s canonical `AvailabilityDoc`, this file's own local
 * copy, and ARCHITECTURE.md §2.4's inline example all disagreed). The
 * local `AvailabilityDoc`/`AvailabilityEntry` interfaces below now match
 * `types/firestore.ts`'s canonical shape FIELD-FOR-FIELD -- two separate
 * maps, `unavailableItems` and `unavailableModifierOptions` (keyed
 * `${menuItemId}:${optionId}`, per that type's own keying note), not one
 * flat map. The one deliberate difference from the canonical client-side
 * type: `until`/`at`/`updatedAt` stay `Timestamp`, not `number`, here --
 * exactly the same server-vs-client convention this file already applies
 * to `OrderRequestDoc.createdAt` (see `Order`'s own header in
 * `types/firestore.ts` for why: `number` is a client-consumed,
 * already-converted representation; raw Admin SDK reads are Timestamps
 * until a not-yet-built `converters.ts` translates between the two).
 *
 * A REAL GAP THIS RECONCILIATION CLOSED, not just a rename: before this
 * pass, `resolveAndPriceLines` checked item-level 86 status against the
 * live `availability` doc, but modifier OPTIONS were only checked against
 * `opt.available` -- a field baked into the (debounced, up-to-5-seconds-
 * stale) `menuPublished` snapshot, never against the fast broadcast path
 * `unavailableModifierOptions` exists specifically for. The founder's own
 * documented reasoning for that fast path ("during peak rushes we cannot
 * risk taking orders for 86'd modifiers" -- `types/firestore.ts`'s
 * `AvailabilityEntry` comment) was therefore not actually being enforced
 * at the one place that prices a real order. `isCurrentlyUnavailable` is
 * now called for both items AND selected modifier options.
 */

import { getFirestore, FieldValue, Timestamp } from 'firebase-admin/firestore';
import type { Transaction } from 'firebase-admin/firestore';
import { createHash } from 'node:crypto';

// Relative, deliberately -- see this file's header for why. Ensures the
// Admin app singleton is initialized and gives us its named Firestore
// instance in one import, matching `lib/firebase/admin.ts`'s actual
// exports (`adminDb`, not a bare `getFirestore()` call against whatever
// app happens to be default-initialized).
import { adminDb as db } from '../../lib/firebase/admin';

import { splitInclusive } from './pricing.service';

// =============================================================================
// Types -- mirror ARCHITECTURE.md Section 1.7 (orderRequests), Section 1.5
// (sessions), Section 1.8 (the priced ticket), Section 1.3 (tenant limits).
// =============================================================================

type LocalizedText = { en: string; ar: string };

interface OrderRequestLine {
  itemId: string;
  qty: number;
  modifierOptionIds: string[];
}

interface OrderRequestDoc {
  sessionId: string;
  tableId: string;
  lines: OrderRequestLine[];
  note: string;
  clientRequestId: string;
  createdBy: string;
  createdAt: Timestamp;
  status: 'pending' | 'priced' | 'rejected' | 'duplicate';
  // Absent on a guest write; `{ kind: 'staff', uid }` on a
  // `placeStaffOrder` write (DECISIONS.md ADR-6). Mirrors
  // `types/firestore.ts`'s `OrderRequestPlacedBy`.
  placedBy?: { kind: 'guest' | 'staff'; uid: string };
  // ADR-11 order attribution. `guestName` — optional, guest-typed at
  // checkout (`firestore.rules` allows the extra key). `placedByName` —
  // the staff display name, written by `placeStaffOrder` (Admin SDK).
  guestName?: string;
  placedByName?: string;
}

interface SessionDoc {
  partyLabel: string;
  tableId: string;
  tableCode: string;
  zoneId: string;
  status: 'active' | 'idle' | 'billing' | 'closed';
  hostUid: string;
  joinedUids: string[];
  deviceIds: string[];
  guestCount: number;
  risk: { score: number; flags: string[] };
  guestName?: string | null; // ADR-11
}

interface ModifierOption {
  id: string;
  name: LocalizedText;
  priceDeltaFils: number;
  isDefault: boolean;
  available: boolean;
}

interface ModifierGroup {
  id: string;
  name: LocalizedText;
  minSelect: number;
  maxSelect: number;
  required: boolean;
  options: ModifierOption[];
}

interface MenuPublishedItem {
  id: string;
  sku: string;
  name: LocalizedText;
  priceFils: number;
  stationId: string;
  status?: 'active' | 'draft' | 'archived';
  modifierGroups: ModifierGroup[];
}

interface MenuPublishedCategory {
  id: string;
  items: MenuPublishedItem[];
}

interface MenuPublishedDoc {
  version: number;
  categories: MenuPublishedCategory[];
}

interface AvailabilityEntryDoc {
  reason: string;
  until: Timestamp | null;
  byUid: string;
  at: Timestamp;
}

interface AvailabilityDoc {
  updatedAt: Timestamp;
  unavailableItems: Record<string, AvailabilityEntryDoc>;
  unavailableModifierOptions: Record<string, AvailabilityEntryDoc>;
}

const EMPTY_AVAILABILITY: AvailabilityDoc = {
  updatedAt: Timestamp.fromMillis(0),
  unavailableItems: {},
  unavailableModifierOptions: {},
};

interface TenantLimits {
  maxOrderLines: number;
  maxQtyPerLine: number;
  maxNoteChars: number;
  maxOrdersPerSessionPer90s: number;
  // Per-tenant staff-approval ceiling. A casual cafe and a high-end
  // steakhouse do not share one hardcoded number -- this is read fresh
  // from each tenant's own configuration document on every order, never
  // a module-level constant. See LIMIT_DEFAULTS below for the fallback
  // used only when a tenant has not set one.
  orderApprovalThresholdFils: number;
}

interface TenantDoc {
  status: 'active' | 'trial' | 'suspended' | 'churned';
  limits?: Partial<TenantLimits>;
}

interface BranchDoc {
  menuVersion: number;
  sla: { ticketPrepSec: number };
  // ADR-11 — per-branch localization. Absent/partial ⇒ AED / 5% below.
  settings?: { currency?: string; vatPpm?: number };
}

const FALLBACK_VAT_PPM = 50_000; // 5% — mirrors pricing.service DEFAULT_VAT_PPM
const FALLBACK_CURRENCY = 'AED';

interface PricedLineItem {
  lineId: string;
  menuItemId: string;
  sku: string;
  nameSnapshot: LocalizedText;
  qty: number;
  unitPriceFils: number;
  modifiers: Array<{
    groupId: string;
    optionId: string;
    nameSnapshot: LocalizedText;
    priceDeltaFils: number;
  }>;
  stationId: string;
  status: 'active';
  lineStatus: 'queued';
  lineTotalFils: number;
}

const LIMIT_DEFAULTS: TenantLimits = {
  maxOrderLines: 40,
  maxQtyPerLine: 20,
  maxNoteChars: 150,
  maxOrdersPerSessionPer90s: 3,
  orderApprovalThresholdFils: 50_000, // AED 500.00 -- fallback ONLY; every
  // real tenant is expected to set its own value in tenants/{tenantId}.
};

type RejectionReason =
  | 'REQUEST_NOT_PENDING'      // trigger redelivery / already processed
  | 'SESSION_NOT_FOUND'
  | 'SESSION_CLOSED'
  | 'NOT_IN_PARTY'
  | 'CALLER_BANNED'
  | 'RATE_LIMITED'
  | 'TENANT_SUSPENDED'
  | 'EMPTY_LINES'
  | 'TOO_MANY_LINES'
  | 'ITEM_NOT_FOUND'
  | 'ITEM_UNAVAILABLE'
  | 'INVALID_QTY'
  | 'INVALID_MODIFIER'
  | 'MODIFIER_CONSTRAINT_VIOLATION';

type PriceOrderOutcome =
  | { outcome: 'priced'; orderId: string; orderPath: string; grossFils: number }
  | { outcome: 'duplicate'; orderId: string; orderPath: string }
  | { outcome: 'rejected'; reason: RejectionReason; detail: string };

// =============================================================================
// Layer 2 sanitizer -- deep Unicode normalization, deferred out of rules
// because Firestore Rules' RE2 dialect cannot verifiably express Unicode
// property classes (Section 8.4). Node's regex engine can, which is exactly
// why this work happens here rather than there.
// =============================================================================

// \p{Cc} = C0 + C1 control bytes (0x00-0x1F, 0x7F-0x9F) -- includes the ESC
//          byte (0x1B) that drives raw ESC-POS printer control sequences.
// \p{Cf} = Unicode "format" characters -- includes the bidi embedding,
//          override, and isolate controls (U+202A-202E, U+2066-2069) that
//          can visually reverse text on a bilingual (en/ar) KDS screen,
//          plus zero-width joiners/non-joiners.
// \p{Zl}/\p{Zp} = line/paragraph separators (U+2028, U+2029).
const CONTROL_AND_FORMAT_CHARS = /[\p{Cc}\p{Cf}\p{Zl}\p{Zp}]/gu;

// Redundant with Section 8.4 Layer 1 (Firestore Rules already reject a
// payload containing these), kept here as defense in depth in case this
// function is ever called on text that did not pass through the guest
// write path -- e.g. a future staff-entered kitchen note.
const HTML_TEMPLATE_METACHARS = /[<>{}$`\\]/g;

const NOTE_BYTE_CAP = 600; // 150 chars * 4 bytes worst-case UTF-8

/**
 * Deep-sanitizes a single guest-authored text field before it is copied
 * from the untrusted `orderRequests` document into the trusted `orders`
 * ticket that the KDS screen renders.
 */
export function sanitizeGuestText(raw: string, maxChars: number): string {
  if (typeof raw !== 'string') return '';

  let s = raw.normalize('NFKC');
  s = s.replace(CONTROL_AND_FORMAT_CHARS, '');
  s = s.replace(HTML_TEMPLATE_METACHARS, ' ');
  s = s.replace(/\s+/g, ' ').trim();

  // Truncate by Unicode codepoint (never split a multi-byte character),
  // then enforce a hard byte ceiling for the same reason.
  const codepoints = Array.from(s);
  if (codepoints.length > maxChars) {
    s = codepoints.slice(0, maxChars).join('');
  }
  while (Buffer.byteLength(s, 'utf8') > NOTE_BYTE_CAP && s.length > 0) {
    s = Array.from(s).slice(0, -1).join('');
  }
  return s;
}

// =============================================================================
// Pure pricing/validation core -- no I/O. This is the part Section 2.6's
// rounding-drift concern is actually about, so it is isolated and meant to
// be exercised by a boundary-value unit-test matrix independent of any
// emulator (tests/services/order.spec.ts).
// =============================================================================

type LineResolution =
  | { ok: true; items: PricedLineItem[]; grossFils: number; stationIds: string[] }
  | { ok: false; reason: RejectionReason; detail: string };

function flattenMenu(menu: MenuPublishedDoc): Map<string, MenuPublishedItem> {
  const map = new Map<string, MenuPublishedItem>();
  for (const category of menu.categories) {
    for (const item of category.items) map.set(item.id, item);
  }
  return map;
}

// Takes a resolved entry (or undefined) rather than the whole doc + a key
// -- the two call sites below resolve from DIFFERENT maps
// (`unavailableItems` vs `unavailableModifierOptions`, with a composite
// key for the latter), so resolving the entry is the caller's job; this
// function's only concern is the reason/until logic, shared by both.
function isCurrentlyUnavailable(entry: AvailabilityEntryDoc | undefined, now: Timestamp): boolean {
  if (!entry) return false;
  if (entry.until === null) return true;              // indefinite 86
  return entry.until.toMillis() > now.toMillis();      // still within the outage window
}

export function resolveAndPriceLines(
  lines: OrderRequestLine[],
  menuIndex: Map<string, MenuPublishedItem>,
  availability: AvailabilityDoc,
  limits: TenantLimits,
  now: Timestamp,
): LineResolution {
  if (!Array.isArray(lines) || lines.length === 0) {
    return { ok: false, reason: 'EMPTY_LINES', detail: 'Order contains no lines.' };
  }
  if (lines.length > limits.maxOrderLines) {
    return { ok: false, reason: 'TOO_MANY_LINES', detail: `${lines.length} exceeds the ${limits.maxOrderLines}-line cap.` };
  }

  const items: PricedLineItem[] = [];
  const stationIds = new Set<string>();
  let grossFils = 0;
  let lineIndex = 0;

  for (const line of lines) {
    lineIndex += 1;
    const menuItem = menuIndex.get(line.itemId);

    if (!menuItem || menuItem.status === 'archived' || menuItem.status === 'draft') {
      return { ok: false, reason: 'ITEM_NOT_FOUND', detail: `Line ${lineIndex}: item ${line.itemId} does not exist on the current menu.` };
    }
    if (isCurrentlyUnavailable(availability.unavailableItems[menuItem.id], now)) {
      return { ok: false, reason: 'ITEM_UNAVAILABLE', detail: `Line ${lineIndex}: "${menuItem.name.en}" is currently out of stock.` };
    }
    if (!Number.isInteger(line.qty) || line.qty < 1 || line.qty > limits.maxQtyPerLine) {
      return { ok: false, reason: 'INVALID_QTY', detail: `Line ${lineIndex}: qty ${line.qty} is out of range (1-${limits.maxQtyPerLine}).` };
    }

    // Resolve and validate every selected modifier option against the
    // item's OWN modifier groups -- this is the "modifiers belong to the
    // item" check Section 2.1 names explicitly, plus group-cardinality
    // enforcement (min/max/required), which is the natural completion of
    // that same check.
    const requestedIds = new Set(line.modifierOptionIds ?? []);
    if (requestedIds.size !== (line.modifierOptionIds ?? []).length) {
      return { ok: false, reason: 'INVALID_MODIFIER', detail: `Line ${lineIndex}: duplicate modifier option ids.` };
    }

    const resolvedModifiers: PricedLineItem['modifiers'] = [];
    const consumedIds = new Set<string>();

    for (const group of menuItem.modifierGroups) {
      const selectedInGroup = group.options.filter((opt) => requestedIds.has(opt.id));

      for (const opt of selectedInGroup) {
        // Two independent checks, deliberately both required: `opt.available`
        // reflects the (debounced, up-to-5s-stale) `menuPublished` snapshot;
        // the availability-doc lookup reflects the fast 86 broadcast path a
        // modifier toggled seconds ago may not have reached that snapshot
        // yet. Checking only the first is exactly the gap this pass closed
        // -- see this file's header.
        const modifierKey = `${menuItem.id}:${opt.id}`;
        if (!opt.available || isCurrentlyUnavailable(availability.unavailableModifierOptions[modifierKey], now)) {
          return { ok: false, reason: 'ITEM_UNAVAILABLE', detail: `Line ${lineIndex}: modifier "${opt.name.en}" is unavailable.` };
        }
        consumedIds.add(opt.id);
        resolvedModifiers.push({
          groupId: group.id,
          optionId: opt.id,
          nameSnapshot: opt.name,
          priceDeltaFils: opt.priceDeltaFils,
        });
      }

      if (group.required && selectedInGroup.length < Math.max(1, group.minSelect)) {
        return { ok: false, reason: 'MODIFIER_CONSTRAINT_VIOLATION', detail: `Line ${lineIndex}: group "${group.name.en}" requires a selection.` };
      }
      if (selectedInGroup.length < group.minSelect || selectedInGroup.length > group.maxSelect) {
        return { ok: false, reason: 'MODIFIER_CONSTRAINT_VIOLATION', detail: `Line ${lineIndex}: group "${group.name.en}" needs ${group.minSelect}-${group.maxSelect} selections, got ${selectedInGroup.length}.` };
      }
    }

    // Any requested id that didn't map to one of this item's own groups
    // is exactly the "modifiers belong to the item" violation.
    if (consumedIds.size !== requestedIds.size) {
      return { ok: false, reason: 'INVALID_MODIFIER', detail: `Line ${lineIndex}: a modifier option does not belong to this item.` };
    }

    const modifierDeltaFils = resolvedModifiers.reduce((sum, m) => sum + m.priceDeltaFils, 0);
    const unitPriceFils = menuItem.priceFils + modifierDeltaFils;
    const lineTotalFils = unitPriceFils * line.qty;

    stationIds.add(menuItem.stationId);
    grossFils += lineTotalFils;

    items.push({
      lineId: `ln_${lineIndex}`,
      menuItemId: menuItem.id,
      sku: menuItem.sku,
      nameSnapshot: menuItem.name,
      qty: line.qty,
      unitPriceFils,
      modifiers: resolvedModifiers,
      stationId: menuItem.stationId,
      status: 'active',
      lineStatus: 'queued',
      lineTotalFils,
    });
  }

  return { ok: true, items, grossFils, stationIds: [...stationIds] };
}

// =============================================================================
// Orchestration -- the Admin SDK I/O. Every read and the eventual write live
// inside ONE Firestore transaction, so a redelivered trigger event or a
// concurrently-changing session can never produce two tickets or price
// against stale menu state.
// =============================================================================

function deterministicOrderId(sessionId: string, clientRequestId: string): string {
  // A guest-controlled string is never used directly as a Firestore
  // document id (it could contain "/", equal ".."/".", or hit the 1500-
  // byte limit). Hashing makes the id deterministic -- so a retried
  // client write and a redelivered trigger both converge on the SAME
  // target document -- while guaranteeing a Firestore-safe, fixed-length
  // hex string.
  return createHash('sha256').update(`${sessionId}:${clientRequestId}`).digest('hex').slice(0, 32);
}

async function getRecentOrderCount(branchPath: string, sessionId: string, sinceMs: number): Promise<number> {
  // A soft abuse-deterrent, deliberately read OUTSIDE the transaction: an
  // aggregation count query is billed as a single read regardless of
  // match count, and a rare race allowing one extra order past the
  // threshold is an acceptable trade-off for a rate limit, not a
  // financial control (Section 8.7's "small ones are merely annoying").
  const snap = await db
    .collection(`${branchPath}/orders`)
    .where('sessionId', '==', sessionId)
    .where('placedAt', '>', Timestamp.fromMillis(sinceMs))
    .count()
    .get();
  return snap.data().count;
}

async function nextOrderCode(tx: Transaction, branchPath: string, now: Date): Promise<string> {
  // Daily-reset, per-branch ticket sequence ("TB-204"). Belongs long-term
  // in a shared counter.service.ts (bills need an identical receiptSeq
  // pattern) -- inlined here for now rather than duplicated incorrectly.
  const today = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Dubai' }).format(now); // YYYY-MM-DD
  const counterRef = db.doc(`${branchPath}/counters/orderSeq`);
  const counterSnap = await tx.get(counterRef);
  const current = counterSnap.exists ? counterSnap.data()! : { date: today, value: 0 };
  const next = current.date === today ? current.value + 1 : 1;
  tx.set(counterRef, { date: today, value: next }, { merge: true });
  return `TB-${String(next).padStart(3, '0')}`;
}

export async function priceOrderRequest(params: {
  tenantId: string;
  branchId: string;
  requestId: string;
}): Promise<PriceOrderOutcome> {
  const { tenantId, branchId, requestId } = params;
  const tenantPath = `tenants/${tenantId}`;
  const branchPath = `${tenantPath}/branches/${branchId}`;
  const requestRef = db.doc(`${branchPath}/orderRequests/${requestId}`);

  // The rate-limit query needs to know which session to scope itself to,
  // so we take one small read of the request doc OUTSIDE the transaction
  // purely to learn `sessionId` -- a field that is immutable once created
  // (guests cannot update their own orderRequests, per firestore.rules),
  // so a slightly-stale copy of it is safe to use here. Everything that
  // actually matters for correctness is re-read, authoritatively, inside
  // the transaction below. See getRecentOrderCount() for why the count
  // query itself is allowed to live outside the transaction too.
  const preRead = await requestRef.get();
  if (!preRead.exists) {
    return { outcome: 'rejected', reason: 'REQUEST_NOT_PENDING', detail: 'orderRequests document vanished before pricing.' };
  }
  const preData = preRead.data() as OrderRequestDoc;
  const ninetySecondsAgo = Date.now() - 90_000;
  const recentCount = await getRecentOrderCount(branchPath, preData.sessionId, ninetySecondsAgo);

  return db.runTransaction(async (tx): Promise<PriceOrderOutcome> => {
    const now = Timestamp.now();

    // ---- READS (all of them, before any write) --------------------------
    const requestSnap = await tx.get(requestRef);
    if (!requestSnap.exists) {
      return { outcome: 'rejected', reason: 'REQUEST_NOT_PENDING', detail: 'orderRequests document vanished before pricing.' };
    }
    const request = requestSnap.data() as OrderRequestDoc;

    // Idempotency against Cloud Functions' at-least-once redelivery, AND
    // against a guest client that retried and produced a second
    // orderRequests document with the same clientRequestId (handled below
    // via the deterministic order id, not here) -- this check specifically
    // catches the SAME orderRequests document being reprocessed.
    if (request.status !== 'pending') {
      const alreadyOrderId = deterministicOrderId(request.sessionId, request.clientRequestId);
      return { outcome: 'duplicate', orderId: alreadyOrderId, orderPath: `${branchPath}/orders/${alreadyOrderId}` };
    }

    const orderId = deterministicOrderId(request.sessionId, request.clientRequestId);
    const orderRef = db.doc(`${branchPath}/orders/${orderId}`);
    const orderExistsSnap = await tx.get(orderRef);
    if (orderExistsSnap.exists) {
      // A retried guest write landed a second orderRequests document with
      // the same clientRequestId; the FIRST one already priced this order.
      // Link this request to the existing ticket rather than duplicating it.
      tx.update(requestRef, { status: 'duplicate', orderId, resolvedAt: FieldValue.serverTimestamp() });
      return { outcome: 'duplicate', orderId, orderPath: orderRef.path };
    }

    const sessionRef = db.doc(`${branchPath}/sessions/${request.sessionId}`);
    const tenantRef = db.doc(tenantPath);
    const branchRef = db.doc(branchPath);

    const [sessionSnap, tenantSnap, branchSnap] = await Promise.all([
      tx.get(sessionRef),
      tx.get(tenantRef),
      tx.get(branchRef),
    ]);

    if (!sessionSnap.exists) {
      tx.update(requestRef, { status: 'rejected', reason: 'SESSION_NOT_FOUND', rejectedAt: FieldValue.serverTimestamp() });
      return { outcome: 'rejected', reason: 'SESSION_NOT_FOUND', detail: `Session ${request.sessionId} does not exist.` };
    }
    const session = sessionSnap.data() as SessionDoc;
    const tenant = tenantSnap.data() as TenantDoc;
    const branch = branchSnap.data() as BranchDoc;

    const menuRef = db.doc(`${branchPath}/menuPublished/v${branch.menuVersion}`);
    const availabilityRef = db.doc(`${branchPath}/live/availability`);
    const bannedUsersRef = db.doc(`${tenantPath}/security/bannedUsers`);
    const bannedDevicesRef = db.doc(`${tenantPath}/security/bannedDevices`);

    const [menuSnap, availabilitySnap, bannedUsersSnap, bannedDevicesSnap] = await Promise.all([
      tx.get(menuRef),
      tx.get(availabilityRef),
      tx.get(bannedUsersRef),
      tx.get(bannedDevicesRef),
    ]);

    // ---- RE-VALIDATION -- everything the client's write already passed
    // through firestore.rules, checked again against CURRENT state, because
    // seconds have elapsed between that write and this trigger firing
    // (Section 2.1, step 1: "Re-read session -- still open? caller still
    // in party?"). Nothing here trusts the earlier rules evaluation to
    // still hold. -----------------------------------------------------

    if (tenant.status === 'suspended' || tenant.status === 'churned') {
      tx.update(requestRef, { status: 'rejected', reason: 'TENANT_SUSPENDED', rejectedAt: FieldValue.serverTimestamp() });
      return { outcome: 'rejected', reason: 'TENANT_SUSPENDED', detail: 'Tenant is not active.' };
    }

    const bannedUids: string[] = bannedUsersSnap.data()?.uids ?? [];
    const bannedDids: string[] = bannedDevicesSnap.data()?.ids ?? [];
    const callerBanned =
      bannedUids.includes(request.createdBy) ||
      session.deviceIds.some((d) => bannedDids.includes(d));
    if (callerBanned) {
      tx.update(requestRef, { status: 'rejected', reason: 'CALLER_BANNED', rejectedAt: FieldValue.serverTimestamp() });
      return { outcome: 'rejected', reason: 'CALLER_BANNED', detail: 'This device or account has been blocked by the venue.' };
    }

    if (!['active', 'idle', 'billing'].includes(session.status)) {
      tx.update(requestRef, { status: 'rejected', reason: 'SESSION_CLOSED', rejectedAt: FieldValue.serverTimestamp() });
      return { outcome: 'rejected', reason: 'SESSION_CLOSED', detail: `Session status is "${session.status}".` };
    }
    // Party-membership check applies to GUEST-placed requests only. A
    // staff-placed request (`placeStaffOrder`, DECISIONS.md ADR-6) has
    // already been cookie-verified and role-checked by that Server Action,
    // and confirmed the session is open — a waiter is legitimately NOT a
    // member of the party they are ordering for.
    const staffPlaced = request.placedBy?.kind === 'staff';
    if (
      !staffPlaced &&
      session.hostUid !== request.createdBy &&
      !session.joinedUids.includes(request.createdBy)
    ) {
      tx.update(requestRef, { status: 'rejected', reason: 'NOT_IN_PARTY', rejectedAt: FieldValue.serverTimestamp() });
      return { outcome: 'rejected', reason: 'NOT_IN_PARTY', detail: 'Caller is no longer a member of this party.' };
    }

    const limits: TenantLimits = { ...LIMIT_DEFAULTS, ...(tenant.limits ?? {}) };
    if (recentCount >= limits.maxOrdersPerSessionPer90s) {
      tx.update(requestRef, { status: 'rejected', reason: 'RATE_LIMITED', rejectedAt: FieldValue.serverTimestamp() });
      return { outcome: 'rejected', reason: 'RATE_LIMITED', detail: `${recentCount} orders already placed in the last 90s.` };
    }

    if (!menuSnap.exists) {
      tx.update(requestRef, { status: 'rejected', reason: 'ITEM_NOT_FOUND', rejectedAt: FieldValue.serverTimestamp() });
      return { outcome: 'rejected', reason: 'ITEM_NOT_FOUND', detail: 'No published menu for this branch.' };
    }
    const menu = menuSnap.data() as MenuPublishedDoc;
    // A branch that has never 86'd anything may not have this document at
    // all yet -- `EMPTY_AVAILABILITY` is a full, safe default matching the
    // canonical shape's non-optional fields, not a partial `{}` that would
    // throw the moment either map is indexed into below.
    const availability = (availabilitySnap.data() as AvailabilityDoc | undefined) ?? EMPTY_AVAILABILITY;
    const menuIndex = flattenMenu(menu);

    // ---- PRICING (pure function, no I/O) ---------------------------------
    const resolution = resolveAndPriceLines(request.lines, menuIndex, availability, limits, now);
    if (!resolution.ok) {
      tx.update(requestRef, {
        status: 'rejected',
        reason: resolution.reason,
        rejectionDetail: resolution.detail,
        rejectedAt: FieldValue.serverTimestamp(),
      });
      return { outcome: 'rejected', reason: resolution.reason, detail: resolution.detail };
    }

    // ADR-11 — the branch's own currency + VAT rate, snapshotted onto the
    // ticket below so a later settings change never re-splits this order.
    const rawVatPpm = branch.settings?.vatPpm;
    const vatPpm =
      typeof rawVatPpm === 'number' &&
      Number.isInteger(rawVatPpm) &&
      rawVatPpm >= 0 &&
      rawVatPpm <= 1_000_000
        ? rawVatPpm
        : FALLBACK_VAT_PPM;
    const rawCurrency = branch.settings?.currency;
    const currency =
      typeof rawCurrency === 'string' && rawCurrency.length > 0 ? rawCurrency : FALLBACK_CURRENCY;

    // splitInclusive() is called exactly once, here, on the freshly summed
    // gross of the surviving (in this case, all -- this is order creation,
    // not a void) line items -- Section 1.9's "one function, no
    // exceptions" invariant, and the same call this codebase makes again
    // after every future void (Section 2.6) rather than ever adjusting a
    // total incrementally. The VAT rate is now the branch's own (ADR-11).
    const { grossFils, netFils, vatFils } = splitInclusive(resolution.grossFils, vatPpm);

    // Staff-approval ceiling -- Section 8.7, corrected.
    //
    // This originally applied only to a session's first priced order, on
    // the theory that a ghost order strikes an empty table on its opening
    // ticket. That reasoning does not survive contact with an adversary:
    // a probing attacker places one small, legitimate-looking order first
    // (a AED 10 water) specifically to clear `orderCount === 0`, then
    // places an arbitrarily large fake order immediately after with the
    // ceiling already disarmed. The flag must therefore apply to EVERY
    // order in a session, unconditionally, with no history-based
    // exemption -- a large order is exactly as suspicious on ticket six
    // as it is on ticket one.
    //
    // The threshold itself is per-tenant, not a codebase-wide constant: a
    // casual cafe's typical check and a steakhouse's typical check are not
    // the same number, so `orderApprovalThresholdFils` is read fresh from
    // THIS tenant's own document on every call (via `limits` above, which
    // merges tenant.limits over LIMIT_DEFAULTS) rather than hardcoded.
    const requiresStaffApproval = grossFils > limits.orderApprovalThresholdFils;

    const guestNote = sanitizeGuestText(request.note ?? '', limits.maxNoteChars);

    // ADR-11 order attribution, denormalised onto the ticket.
    const staffPlacedName =
      request.placedBy?.kind === 'staff' && typeof request.placedByName === 'string'
        ? sanitizeGuestText(request.placedByName, 60) || null
        : null;
    const guestNameClean =
      typeof request.guestName === 'string' ? sanitizeGuestText(request.guestName, 60) || null : null;

    const code = await nextOrderCode(tx, branchPath, now.toDate());

    // ---- WRITE ------------------------------------------------------------
    tx.set(orderRef, {
      code,
      requestId,
      clientRequestId: request.clientRequestId,
      sessionId: request.sessionId,
      partyLabel: session.partyLabel,
      tableId: session.tableId,
      tableCode: session.tableCode,
      zoneId: session.zoneId,
      status: 'new',
      stationIds: resolution.stationIds,
      items: resolution.items,
      grossFils,
      netFils,
      vatFils,
      voidedFils: 0,
      placedAt: FieldValue.serverTimestamp(),
      prepStartedAt: null,
      readyAt: null,
      servedAt: null,
      slaTargetSec: branch.sla.ticketPrepSec,
      slaBreached: false,
      priority: 'normal',
      // Honest audit: a staff-placed ticket carries `{ kind: 'staff', uid }`
      // from the request; a guest one keeps the historical shape.
      placedBy: request.placedBy ?? { kind: 'guest', uid: request.createdBy },
      placedByName: staffPlacedName, // ADR-11 — resolved staff name, or null
      guestName: guestNameClean, // ADR-11 — guest-typed name, or null
      currency, // ADR-11 — localization snapshot
      vatPpm,
      covers: session.guestCount,
      guestNote,
      billId: null,
      riskScore: session.risk?.score ?? 0,
      requiresStaffApproval,
      // Schema note (Section 1.10 of firestore.rules): every order MUST be
      // created with these three fields present so the cashier field-scoped
      // update rule has a well-defined `before` state to diff against.
      adjustments: [],
      paymentStatus: 'UNPAID',
      receiptPrintedAt: null,
    });

    tx.update(requestRef, {
      status: 'priced',
      orderId,
      pricedAt: FieldValue.serverTimestamp(),
    });

    // ADR-11 — stamp the guest name onto the SESSION the first time any
    // order in the party carries one, so the Cashier can label the whole
    // tab (not just this one ticket). Never overwrites an existing name.
    if (guestNameClean && !session.guestName) {
      tx.update(sessionRef, { guestName: guestNameClean });
    }

    return { outcome: 'priced', orderId, orderPath: orderRef.path, grossFils };
  });
}

// =============================================================================
// Cloud Functions v2 wiring -- REAL as of this pass, not a comment. See
// `functions/src/triggers/price-order-request.ts`, which matches this
// snippet almost verbatim (a relative import there in place of the `@/*`
// alias reasoning above, plus real `logger` import). Kept here too,
// unchanged, as the canonical description of what that file does and why,
// co-located with the function it calls -- RULES.md §4.10 (docs and code
// change together applies to a comment like this one just as much as to
// prose documentation).
//
//   import { onDocumentCreated } from 'firebase-functions/v2/firestore';
//   import { priceOrderRequest } from '../../../src/server/services/order.service';
//
//   export const priceOrderRequestTrigger = onDocumentCreated(
//     {
//       document: 'tenants/{tenantId}/branches/{branchId}/orderRequests/{requestId}',
//       region: 'me-central2',
//       minInstances: 1,      // service hours only, per a scheduled scaler
//       maxInstances: 40,     // Section 8.5 -- caps the invoice under load
//     },
//     async (event) => {
//       const { tenantId, branchId, requestId } = event.params;
//       const result = await priceOrderRequest({ tenantId, branchId, requestId });
//       if (result.outcome === 'rejected') {
//         // Business-invalid request: resolved normally, NOT rethrown --
//         // Cloud Functions would otherwise retry a permanently-invalid
//         // request forever. Only genuine infra errors inside
//         // priceOrderRequest() should propagate to trigger a retry.
//         logger.info('order request rejected', { requestId, reason: result.reason });
//       }
//     },
//   );
// =============================================================================
