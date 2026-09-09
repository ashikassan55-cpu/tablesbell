# TableBells — Architecture Decision Records

This file records the load-bearing decisions behind TableBells' backend and the reasoning that produced them, so a future engineer (including a future version of this team) can see *why* the system is shaped the way it is, not just what shape it currently has. Each record follows the standard ADR format: Context, Decision, Consequences, and — where a decision closed a specific attack or replaced an earlier one — Alternatives Considered.

Source of truth for the schema and rules referenced throughout: `ARCHITECTURE.md` v3.0. Source of truth for behavior: `order.service.ts`, `pricing.service.ts`, `firestore.rules`.

| ADR | Title | Status |
|---|---|---|
| [ADR-1](#adr-1-the-two-collection-split) | The Two-Collection Split | Accepted |
| [ADR-2](#adr-2-printer-protection-layered-sanitization) | Printer Protection — Layered Sanitization | Accepted |
| [ADR-3](#adr-3-the-probe-attack-fix) | The "Probe Attack" Fix | Accepted — supersedes the original ceiling design in ARCHITECTURE.md §8.7 |
| [ADR-4](#adr-4-continuous-cart-ux) | Continuous Cart UX | Accepted |
| [ADR-5](#adr-5-staff-void-authority--no-per-action-step-up) | Staff Void Authority — No Per-Action Step-Up | Accepted — supersedes the Waiter Floor step-up PIN design in MEMORY.md §1 |
| [ADR-6](#adr-6-staff-orders-go-through-orderrequests-not-straight-to-orders) | Staff Orders Go Through `orderRequests`, Not Straight to `orders` | Accepted — supersedes the `placeStaffOrder → orders` plan in `waiter-menu-entry.tsx`'s old header / MEMORY.md §2 |
| [ADR-7](#adr-7-table-pin-security-model--bill-request--print-lifecycle) | Table PIN Security Model & Bill Request / Print Lifecycle | Accepted — the planned answer to the "QR-scan divergence"; supersedes "leave QR-scan creation exactly as it is" as a permanent stance |
| [ADR-8](#adr-8-manager-menu-maker--the-menudraft--publishmenu-model) | Manager Menu Maker — the `menuDraft` → `publishMenu` model | Accepted |
| [ADR-9](#adr-9-manager-table-management--qr-codes-encode-the-opaque-slug-not-a-semantic-url) | Manager Table Management — QR codes encode the opaque slug, not a semantic URL | Accepted — overrides the `/{tenantSlug}/{branchSlug}?table={tableId}` URL named in the build task |
| [ADR-10](#adr-10-manager-staff-management--single-role-staffcode--pin-server-side-writes) | Manager Staff Management — single role, staffCode + PIN, server-side writes | Accepted — keeps the single-`role` model over the build task's "one or multiple roles" |
| [ADR-11](#adr-11-localization-shared-device-lock-and-order-attribution) | Localization, Shared-Device Lock, and Order Attribution | Accepted |

---

## ADR-1: The Two-Collection Split

**Status:** Accepted
**Date:** 2026-09-08
**Related:** ARCHITECTURE.md §1.7, §1.8, §2.1, §8.3 · `firestore.rules` (`orderRequests` and `orders` match blocks) · `order.service.ts` (`priceOrderRequest`)

### Context

TableBells' guest-ordering model requires two properties that are in direct tension:

1. **Frictionless writes.** A guest must be able to place an order the instant they scan a table's QR code — no login, no server round-trip they can perceive as latency, ideally a direct Firestore write with real-time local-cache echo.
2. **Server-authoritative pricing.** No amount that ends up on a bill, a kitchen ticket, or a VAT return may ever originate from a device the restaurant does not control. A guest's phone is, by definition, hostile input.

A single `orders` collection cannot satisfy both. If guests write directly to it, either (a) the write must carry a price the server later trusts — unacceptable, since the client is the attacker's only foothold — or (b) Firestore Security Rules must independently recompute and verify the price at write time, which they cannot do: rules cannot iterate the `items` array meaningfully, cannot look up a menu item's current price via more than a bounded number of `get()` calls without becoming a second, undocumented pricing engine, and — critically — cannot safely implement the VAT-inclusive rounding arithmetic that ADR-3's sibling invariant (`splitInclusive()`, ARCHITECTURE.md §1.9) requires to have exactly one call site in the entire codebase. Putting money math in two places (rules and application code) is itself a standing invitation to drift.

### Decision

Split guest intake from kitchen truth into two collections with structurally different write permissions:

- **`orderRequests/{requestId}`** — the *only* thing a guest client may ever create. Its schema (`{ sessionId, tableId, lines: [{ itemId, qty, modifierOptionIds }], note, clientRequestId, createdBy, createdAt, status }`) contains no field capable of expressing money. `firestore.rules` enforces this in two independent ways on every `create`:
  - `noMoneyFields()` — a deny-list rejecting the write outright if the payload contains any of `priceFils`, `unitPriceFils`, `grossFils`, `netFils`, `vatFils`, `lineTotalFils`, `totalFils`, `discountFils`, `creditFils`, or `amountFils`.
  - `keys().hasOnly([...])` — an allow-list closing the document to exactly the seven fields named above. A client cannot invent a synonym (`priceOverrideFils`, `customTotal`, …) to route around the deny-list, because any key not on the allow-list fails the write independently of what that key is named.
- **`orders/{orderId}`** — the priced kitchen ticket. Every match block governing it in `firestore.rules` reads `allow create, delete: if false` for *every* principal, staff included. The only code path that can ever create this document is `priceOrderRequest` (`order.service.ts`), running under the Firebase Admin SDK, which bypasses Security Rules entirely — not because it is trusted by policy, but because it is the only execution context capable of reading `menuPublished` server-side and calling `splitInclusive()`.

`priceOrderRequest` is the sole bridge between the two: it re-validates the request against live state (session still open, caller still in the party, item exists and isn't 86'd, modifiers belong to the item, rate limit not exceeded), resolves every price from the server-side menu snapshot, sums the gross, and writes the priced ticket — all inside one Firestore transaction, keyed by a deterministic order id (`sha256(sessionId:clientRequestId)`) so a redelivered trigger or a retried client write can never produce two tickets from one intent.

### Why this is a mathematical guarantee, not a policy

The distinction matters. A policy ("staff are trained not to trust client prices") can be forgotten, worked around under deadline pressure, or bypassed by a bug. This is not that. The guarantee holds because:

- **There is no function call in the entire client-reachable surface that writes a `priceFils`-family field.** Not "there is a rule against it" — there is no code, on any path a browser can reach, that performs the write. The rejection in `noMoneyFields()` is redundant defense against a case that has no legitimate caller in the first place.
- **Even in the counterfactual where a price *did* land on an `orderRequests` document**, it is inert. Nothing ever reads a price back off that collection. `resolveAndPriceLines()` in `order.service.ts` takes only `itemId` and `qty` from each line and looks up everything else — name, price, station, modifier deltas — from `menuPublished`, which a guest cannot write under any circumstance (`firestore.rules`: `allow write: if false` on that path, full stop).
- **The `orders` collection itself has zero client-reachable create path.** This is the structural claim underneath the whole argument: it is not that writes are *validated* before being accepted, it is that no rule *exists* which evaluates to `true` for a non-Admin-SDK caller attempting to create that document. A security property enforced by the absence of a code path survives refactors that a validation-based property does not.

### Consequences

- **Added latency.** `priceOrderRequest` runs as an asynchronous trigger, adding roughly 200–400ms warm between the guest's write and the kitchen seeing a ticket. Mitigated with `minInstances: 1` during service hours (ARCHITECTURE.md §2.1) and masked client-side by rendering the `orderRequests` document's local-cache echo immediately as a "Sending…" state.
- **A guest-facing status machine is now required.** The guest UI must listen to its own `orderRequests` document and branch on `status: 'pending' | 'priced' | 'rejected' | 'duplicate'` rather than assuming its write *is* the order.
- **Two schemas to keep in sync**, not one. ARCHITECTURE.md §1.7 and §1.8 must be read together, and any change to one that isn't reflected in the pricing function's validation logic is a defect by definition (this is exactly the class of drift ADR's sibling documentation pass, the §1.8 patch, exists to close).

### Alternatives Considered

- **Guest writes directly to `orders`, rules verify price server-side via `get()`.** Rejected: rules would need to read the menu item, every relevant modifier option, and perform integer VAT rounding — effectively reimplementing `resolveAndPriceLines()` and `splitInclusive()` a second time, in a language that cannot express the loop over `lines[]] that validation requires (ARCHITECTURE.md §1.10, "Rules limitations, stated plainly").
- **Guest calls a Next.js Server Action / API route instead of writing to Firestore.** Rejected on two grounds: it does not satisfy the explicit product requirement that guest writes be Firestore-native create-only operations (so that Firestore's own offline queue and local-cache echo provide the "instant" feel with zero custom code), and it would mean the guest's write path and the staff's write path use two entirely different transport mechanisms for no structural benefit.

---

## ADR-2: Printer Protection — Layered Sanitization

**Status:** Accepted
**Date:** 2026-09-08
**Related:** ARCHITECTURE.md §8.4 (Layers 1–5) · `order.service.ts` (`sanitizeGuestText`) · `firestore.rules` (`safeText`) · `/api/print/[billId]/route.ts` (not yet built — this ADR is also its specification)

### Context

A guest's free-text order note has two entirely different downstream consumers, and they fail differently:

1. **The KDS screen** — a web surface. The classic risk is markup/script injection: a note containing `<img onerror=…>` rendered unsafely could execute with the privileges of whatever staff session is looking at the kitchen tablet.
2. **A thermal receipt printer** — reached via `/api/print/[billId]`, which serializes bill and order content into raw **ESC-POS** bytes. This is not a text-rendering surface; it is a control-byte protocol. The ESC byte (`0x1B`) and its neighbors in the C0 control range (`0x00`–`0x1F`) are not "special characters" to a printer, they are literally the beginning of a command sequence — cutting paper repeatedly, switching code pages mid-receipt, or in the worst case wedging the device until it is power-cycled. HTML-oriented defenses (escaping `<`, `>`, quoting attributes) do nothing here, because there is no markup to escape — the danger is in bytes an HTML sanitizer has no reason to know about.

Treating these as one sanitization problem with one shared filter produces a filter tuned for neither: strict enough for print safety, it would strip characters (e.g., legitimate Arabic-script punctuation) that are completely safe on screen; strict enough only for screen safety, it does nothing to stop a raw ESC sequence from reaching the printer's firmware.

### Decision

Two independent sanitization layers, owned by two different files, solving two different problems:

**Layer 2 — deep Unicode normalization (`order.service.ts`, `sanitizeGuestText`).** Runs once, inside `priceOrderRequest`, before a guest's `orderRequests.note` is copied into the priced ticket's `guestNote` field — the value the KDS screen actually renders. Implemented with genuine V8 regex Unicode property escapes:

```ts
const CONTROL_AND_FORMAT_CHARS = /[\p{Cc}\p{Cf}\p{Zl}\p{Zp}]/gu;
```

- `\p{Cc}` — every C0 *and* C1 control byte (`0x00`–`0x1F`, `0x7F`–`0x9F`), which includes the ESC byte. This alone already removes the specific byte a naive ESC-POS attack depends on.
- `\p{Cf}` — Unicode "format" characters, including the bidirectional embedding/override/isolate controls (`U+202A`–`U+202E`, `U+2066`–`U+2069`) that can visually reverse text on the bilingual (en/ar) KDS screen — a distinct, screen-rendering-specific threat with no ESC-POS analogue.
- `\p{Zl}` / `\p{Zp}` — line and paragraph separators, closing a gap plain `\r\n` stripping misses.

Followed by NFKC normalization, HTML/template metacharacter removal (defense in depth, redundant with Firestore Rules' own Layer 1 check), whitespace collapse, and a length/byte-size cap.

**Layer 5 — the ESC-POS printable whitelist (`/api/print/[billId]/route.ts`).** A *separate*, later, narrower filter applied immediately before serialization to the wire, on whatever text reaches the print route — the already-Layer-2-sanitized `guestNote`, plus any staff-entered content the print template includes. It allows printable ASCII and the Arabic Unicode block only, and strips every byte below `0x20` except `LF`.

### Why two layers instead of one

- **Different design questions.** Layer 2 answers "is this text safe and correctly meaningful to display and reason about elsewhere in the system?" — a general-purpose, protocol-agnostic hygiene pass. Layer 5 answers "is this text safe to embed literally inside a stream of bytes a specific piece of hardware's firmware will interpret as commands?" — a protocol-specific question that has nothing to do with Unicode text semantics and everything to do with what that hardware's command grammar reserves.
- **Different blast radius.** A future change to the print template, a new printer model with a different reserved-byte range, or a new staff-facing feature that writes directly to a kitchen note (bypassing `priceOrderRequest` entirely) must not silently reopen the printer attack surface. Because Layer 5 re-validates its own input immediately before it becomes wire bytes — rather than trusting that "whatever called me already sanitized this" — it remains correct even if an upstream caller changes or a new one is added.
- **Layer 2 cannot be widened to do Layer 5's job without breaking legitimate content.** Layer 5's whitelist deliberately excludes most of the Unicode range *by design* — but the KDS screen must correctly render full Arabic script, which Layer 2 must therefore leave untouched. A single merged filter strict enough for the printer would break Arabic rendering on the kitchen screen; a single filter permissive enough for the screen would not protect the printer. They are not the same rule at two strengths — they are two different rules.
- **This distinction was not academic.** An earlier round of this same specification work referred to the control-byte stripping inside `priceOrderRequest` as "Layer 5," conflating it with the print-route whitelist. The correction — stated in `order.service.ts`'s own header comment — is that what runs in the pricing path is Layer 2; Layer 5 is, and must remain, a distinct stage owned by the print route. Getting this labeling right is not pedantry: it is what prevents a future engineer from believing the printer is protected by a file that has never seen a print request.

### Consequences

- Two sanitizer implementations to maintain, not one — an accepted cost, since a shared implementation would necessarily be wrong for one of the two consumers (see above).
- `/api/print/[billId]/route.ts`, when built, must **not** assume its input is already print-safe just because it passed through `priceOrderRequest`. It re-applies its own whitelist unconditionally.
- `tests/services/sanitize.spec.ts` and a future `tests/services/print-serializer.spec.ts` are separate test files by design, exercising separate boundary-value matrices (Unicode control/format characters for Layer 2; the ASCII+Arabic whitelist and raw sub-`0x20` bytes for Layer 5).

---

## ADR-3: The "Probe Attack" Fix

**Status:** Accepted — supersedes the ceiling design originally described in ARCHITECTURE.md §8.7
**Date:** 2026-09-08
**Related:** ARCHITECTURE.md §8.7 (patched) · `order.service.ts` (`requiresStaffApproval`, `TenantLimits.orderApprovalThresholdFils`)

### Context

The original staff-approval ceiling was designed around a specific, narrower threat: a ghost order — a fabricated ticket sent to an empty table — typically strikes on the *opening* order of a session, because that is the moment a waiter is most likely to walk food to a table with nobody at it. The implementation encoded that assumption directly: `requiresStaffApproval` was computed only when `session.orderCount === 0`, i.e., only on a party's first priced order.

This reasoning does not survive an adversarial read. **The probe attack:** an attacker places one small, unremarkable order first — a AED 10 water — which passes through with `orderCount === 0` still true but `grossFils` comfortably under any sane threshold. That single order increments `orderCount` to 1. Every subsequent order from that same session, including an arbitrarily large fabricated one, now evaluates `session.orderCount === 0` as `false` and skips the ceiling check entirely, regardless of its value. The gate was not a value ceiling at all in practice — it was a *first-order-only* ceiling, trivially disarmed with one cheap, legitimate-looking order.

A second, related concern was raised about the threshold's framing: `limits.maxOrderValueFils` was already read per-tenant (merged from `tenants/{tenantId}.limits` over a code-level fallback), but the name and surrounding commentary did not make that unambiguous, and combined with the bypassable gate above, the practical guarantee a reader would take away — "large orders always get a second look" — was false on both counts: not every large order was checked, and it was not obvious from the field's own name that each tenant's number was, and had to remain, independently configurable.

### Decision

Two changes, both in `order.service.ts`:

1. **Remove the `session.orderCount === 0` condition entirely.** The check is now:

   ```ts
   const requiresStaffApproval = grossFils > limits.orderApprovalThresholdFils;
   ```

   evaluated identically on every priced order in a session, with **no exemption based on order history of any kind.** A large order is exactly as worth a staff glance on ticket six as it is on ticket one — arguably more so, since a ticket-six probe attack is now the *only* variant this control needs to defend against, and it now does.

2. **Rename `limits.maxOrderValueFils` to `limits.orderApprovalThresholdFils`**, and tighten the surrounding contract: the value is read fresh from `tenants/{tenantId}.limits` inside the same transaction that already reads that tenant document for other limits (`maxOrderLines`, `maxQtyPerLine`, …), via `{ ...LIMIT_DEFAULTS, ...(tenant.limits ?? {}) }`. `LIMIT_DEFAULTS.orderApprovalThresholdFils` (AED 500, unchanged in value) is documented explicitly as a fallback for a tenant that has not configured its own threshold — never a number any tenant is expected to actually operate on. A casual café and a high-end steakhouse were always going to need different numbers here; the fix makes that fact impossible to miss from the field name and the comment beside it, not just true in the merge logic.

### Consequences

- **No additional read cost.** The tenant document was already being read inside the transaction for other per-tenant limits; this change adds no new Firestore read.
- **A large, entirely legitimate order — a big table's full round, ordered in one go — will now also trigger `requiresStaffApproval`, every time, regardless of how long the party has already been ordering.** This is an accepted trade-off: the flag is a prompt on the staff console, not a block on cooking or serving. A false positive costs a manager one glance; a false negative (a large fraudulent order sailing through unflagged) costs the restaurant the full value of food already made. The asymmetry favors over-flagging.
- **ARCHITECTURE.md §8.7, §2.1, and §1.3 were patched** to remove every reference to the first-order exception and the old field name, so the written specification and the shipped code cannot drift apart on this point (tracked as its own documentation change, prior to this ADR).

### Alternatives Considered

- **A cumulative session-total ceiling** (flag if the *sum* of all orders in a session ever crosses the threshold, rather than any single order) — would additionally catch a "many medium-sized orders" variant of the probe attack that a per-order check cannot. Not adopted for this pass: no evidence yet that this variant is being attempted in practice, the existing per-session rate limiter (≤3 orders/90s, ARCHITECTURE.md §8.7) already bounds how quickly a session can accumulate orders, and a cumulative check adds meaningful complexity (it must correctly account for voided lines reducing the running total, per §2.6's recomputation rule). Left as a documented candidate for a future ADR if abuse patterns warrant it.
- **A risk-score-weighted dynamic threshold** (lower the effective ceiling for a session already carrying `risk.score` flags) — rejected as premature: a flat, per-tenant, always-evaluated threshold is simpler to explain to a restaurant owner, simpler to audit, and closes the actual vulnerability found. Combining it with the existing risk-scoring system (ARCHITECTURE.md §3.4) remains available as a later refinement without requiring a structural change to this decision.

---

## ADR-4: Continuous Cart UX

**Status:** Accepted
**Date:** 2026-09-08
**Related:** ARCHITECTURE.md §3.2, §3.3, §3.4, §8.1 · `middleware.ts` (Node runtime) · guest custom-claim minting (`mint.ts`)

### Context

The product requirement is unambiguous: ordering must be frictionless — no PIN, no forced account, no login prompt of any kind — from the instant a guest scans a table's QR code. At the same time, the system must recognize a *returning* device across an entire meal: a guest who orders, puts their phone away for twenty minutes, and picks it up again must land back on the same open tab, not a fresh empty cart, and a guest who leaves a session idle past the configured timeout (ARCHITECTURE.md §3.4, default 60 minutes) must be seamlessly woken rather than forced to re-identify themselves.

Two identity mechanisms were available, and neither is sufficient alone:

- **Firebase Anonymous Auth UID**, persisted client-side (IndexedDB/localStorage). This is defeated by entirely ordinary, non-malicious guest behavior during a single meal: iOS Safari's Intelligent Tracking Prevention aggressively partitions and evicts this kind of storage; a guest reopening the table's link from a Messages or WhatsApp thread may do so in a fresh in-app browser context with no access to the original storage; a private/incognito tab starts with nothing. Relying on this alone would mean "continuous cart" silently fails for a meaningful fraction of real guests through no fault of their own.
- **Forced login** (email, phone, social) would solve the recognition problem completely — and is disqualified outright by the frictionless requirement. Adding *any* step between "scan" and "see the menu" fails the product's own stated value proposition.

### Decision

A signed, `HttpOnly`, `Secure`, `SameSite=Lax` cookie (`tb_did`) carrying only an opaque device identifier — `{ did, tid, iat }`, HS256-signed — set by Node-runtime middleware on first scan and read on every subsequent scan to resolve whether this device already holds an open party at this table.

**Why `SameSite=Lax` specifically, and not `Strict` or `None`:**

- **`Strict` would break the exact flow it needs to support.** Scanning a physical QR code opens the device's camera or a QR-reader app, which then launches the browser via what the browser treats as a top-level, externally-initiated navigation — the same category of navigation as following a link from another app. A `Strict` cookie is withheld on precisely this kind of re-entrant top-level navigation following a prior visit, meaning a returning guest's device would appear cookie-less on the very scan that is supposed to recognize them. `Strict` would silently disable wake-recovery for the majority of real-world re-scans.
- **`Lax` sends the cookie on top-level `GET` navigations — which is exactly what a QR scan produces — while withholding it from cross-site subresource requests and cross-site `POST`s.** This is not a compromise made *despite* security concerns; it is the correct CSRF posture for this cookie. An attacker's page cannot embed a form or script that silently fires a state-changing request against TableBells using the guest's cookie, because the browser will not attach a `Lax` cookie to that request type. The single legitimate use of this cookie (a top-level GET re-entry from a QR scan) is exactly the case `Lax` allows, and the cases it blocks are exactly the cases that would matter to an attacker.

  *Nuance worth recording:* some browsers historically granted a short-lived (~2 minute) exception allowing a `Lax` cookie onto a cross-site top-level `POST` shortly after being set, to avoid breaking OAuth-style redirect flows. This does not weaken our posture here, since the guest scan path is a `GET` navigation and never depends on that exception window.
- **`None` was rejected as strictly worse for this use case with no offsetting benefit.** It would attach the cookie to every cross-site context — embedded iframes, arbitrary cross-origin fetches — none of which this product needs, since the cookie only ever needs to survive a same-origin top-level re-entry. `None` requires `Secure` in the same way `Lax` does, so there is no operational reason to accept the wider exposure.

**Why `HttpOnly` is doing independent work.** `SameSite` governs *when* the browser attaches the cookie to a request; it does nothing to stop same-origin JavaScript from reading `document.cookie` directly. `HttpOnly` is the control that matters if an XSS payload ever slipped past every layer described in ADR-2 and ARCHITECTURE.md §8.4: it makes the device identity unreadable to any script, injected or otherwise, running on the page.

**Why the cookie is deliberately close to empty.** It carries no session id, no role, no bearer capability over money or orders — only enough to say "this device has been seen before." Recognizing a device is not the same as authorizing it: every actual read or write still requires a short-lived (6-hour) Firebase custom-claim token, minted fresh by middleware *after* the device is resolved, scoped to exactly one session (`ses` claim) and re-checked against live party membership on every access (ARCHITECTURE.md §8.2's IDOR gate — token binding *and* current membership, both required, independently). A leaked or copied cookie value therefore does not hand an attacker a working credential; at most, it causes the attacker's *own* device, on its *own* future scan, to be treated as previously seen — a materially smaller blast radius than a stolen bearer token would represent, and one that party-isolation (ARCHITECTURE.md §5.1) already assumes is possible and defends against independently.

### Consequences

- **Recognition, not authorization, is what the cookie buys.** This must not be conflated in future work: no code path should ever treat cookie possession as sufficient grounds for a write. The custom-claim token, minted separately and scoped separately, remains the only authorization surface.
- **A guest who explicitly clears cookies, uses a fresh private tab, or switches devices mid-meal loses "continuous cart" convenience and starts a new, isolated party on their next scan.** This is an accepted, deliberate trade-off (ARCHITECTURE.md §3.2–§3.3): correctness — never silently merging two different physical people into one shared bill without the explicit host-approval flow (§5) — is prioritized over recovery convenience in this specific edge case. The alternative (weakening party isolation to "recover" a session more aggressively) would reopen exactly the shared-cart ambiguity the party model exists to prevent.
- **The cookie's 400-day lifetime is a UX ceiling, not a security boundary.** Because it carries no bearer capability, a long lifetime costs nothing security-wise; it simply means a guest's *device* remains "recognized" across many separate visits to the same venue, which is the intended behavior for a repeat customer.

---

## ADR-5: Staff Void Authority — No Per-Action Step-Up

**Status:** Accepted
**Date:** 2026-09-09
**Related:** ARCHITECTURE.md §1.6, §2.2, §2.5, §8.7 · `lib/console/staff-permissions.ts` (`canVoidSentLine`, `canExecuteBan`) · `server/actions/bill.actions.ts` (`voidTicketLine`) · `components/waiter/*` · `lib/console/void-reasons.ts`

### Context

An earlier build of the Waiter Floor View (MEMORY.md §1) gated three sensitive actions — void a sent line, report a suspected ghost order, and toggle "Open Floor Mode" — behind a per-action **step-up PIN challenge** (`pin-challenge-modal.tsx`): a small modal, distinct from the shift-long terminal unlock, that re-authenticated whoever was physically at the tablet for that one action. The intent was defensible on paper — prove a specific human authorized a specific irreversible action — but it was designed before real staff auth existed, against a plaintext mock PIN directory.

Two things forced a decision when wiring it to the real `tb_staff` session:

1. **Operationally, it does not survive a dinner rush.** A sent-line void under the step-up model requires a manager (or any kitchen/manager/owner PIN holder) to walk to the waiter's handheld and enter credentials, for every void, while covering a full section. Industry-standard POS operations do not work this way: the waiter's terminal is not a void surface at all; voids of sent items happen at the cashier/manager station, which is staffed and stationary.
2. **Making it "real" meant net-new attack surface.** A working step-up needs an endpoint that verifies a staff code + PIN (argon2id, per-user-salted — the same reason `staff-login.service.ts` requires a staff code) without minting a session. That is a second public credential-verification endpoint, sharing the per-member lockout, existing solely to support a workflow operations does not want.

### Decision

**Remove the per-action step-up entirely.** Delete `pin-challenge-modal.tsx`; do not build `/api/auth/pin/verify`. Authorization for every console action is now purely a function of the terminal's own verified `tb_staff` session role — no per-action re-authentication anywhere.

Redraw the void boundary along the role line, not a challenge:

- **A `server` (waiter) has no authority over a sent line.** Their entire order-editing power is the **draft cart** in `waiter-menu-entry.tsx`: change quantities, remove lines, before "Send to Kitchen". After the order is sent, the waiter asks the cashier verbally. `canVoidSentLine` returns `false` for `server` by construction — there is no predicate that would return true for that role.
- **`cashier` / `manager` / `owner` void sent lines from their own terminal.** The Cashier Dashboard's table detail panel lists each order's active lines with a "Void" control (`canVoidSentLine`-gated), opening a reason prompt.
- **`kitchen` retains line-void via the KDS path** (ARCHITECTURE.md §2.5), which will call the same `voidTicketLine` action once that screen is wired. `canVoidSentLine` therefore admits `kitchen` too — the one excluded role is `server`.
- **"Report a suspected ghost order" stays available to any signed-in staff member** — it was always accountability (*who* is reporting), never authorization (*which role*), and the `tb_staff` identity now supplies the *who* without a challenge. It remains a manager-reviewable report, never a ban.
- **"Open Floor Mode" is deleted.** Its only mechanism was toggling whether "basic" actions re-prompt for a PIN; with no step-up PIN anywhere, it gates nothing.

**Void reason is mandatory and permanently retained.** `voidTicketLine` rejects a request whose `reason` is not one of `lib/console/void-reasons.ts`'s codes (`customer_changed_mind`, `server_error` — new here — `damaged_accident`, `out_of_stock`); the reason plus an optional staff note is written into `items[lineId].void{}` and an append-only `orders/{id}/events` row. The `events` subcollection is `allow write: if false` for every client, so that Admin-SDK write is the only path to it, and it is retained **indefinitely** — UAE VAT law requires five years of records, and a voided line is a financial adjustment that must be reconstructable for that whole window.

`voidTicketLine` follows the `advanceTicket` pattern exactly: no client-supplied `actor` or `tenantId`, ever — it reads and verifies the `tb_staff` cookie itself, derives identity from it, checks `branchId ∈ bids` and `canVoidSentLine(role)` before the transaction, and recomputes `gross`/`net`/`vat` from the surviving active lines via the single `splitInclusive()` (ARCHITECTURE.md §2.6), never adjusting incrementally.

### Consequences

- **The Waiter Floor is simpler and matches how floors actually run.** No modal interrupts, no "find a manager" for routine order changes caught before send. The trade-off — a waiter cannot fix a mis-sent line themselves — is exactly the control restaurants want on that role.
- **One fewer credential-verification endpoint.** The only place a staff PIN is ever checked remains `/api/auth/pin` at login. Every subsequent action is gated by the already-minted signed cookie.
- **The Cashier terminal is now a financial-adjustment surface**, not just a monitoring one. Its role gate (`canVoidSentLine`) and the mandatory-reason transaction are the accountability controls that replace the step-up's "prove a human did this."
- **ARCHITECTURE.md §2.5's stated role list (`kitchen, manager, owner`) is widened to add `cashier`**, and the Waiter Floor step-up described in MEMORY.md §1 is withdrawn. Both documents are updated to point here.
- **Indefinite retention is now a stated requirement, not an incidental default.** Any future "archive old orders" or TTL work must carve out voided-line audit data (or the `events` spine wholesale) from deletion.

### Alternatives Considered

- **Build the real step-up endpoint (`/api/auth/pin/verify`), keep the modal.** Rejected on the operational grounds above: it faithfully implements a workflow the business has decided is wrong. Keeping a "correct" implementation of an unwanted process is worse than removing it.
- **Keep Open Floor Mode as a pure UI concept with no security meaning.** Rejected as misleading — a control labelled like a security posture toggle that gates nothing is a latent trap for whoever reads it next.
- **Let the waiter void a sent line but route it for manager approval asynchronously.** Rejected for this pass as more machinery than the boundary needs: the cashier station is already staffed and stationary, so a synchronous "ask the cashier" is simpler than an approval queue, and nothing in the current build has an approval-queue primitive to build on.

---

## ADR-6: Staff Orders Go Through `orderRequests`, Not Straight to `orders`

**Status:** Accepted
**Date:** 2026-09-09
**Related:** ARCHITECTURE.md §1.7, §1.8, §2.1 · ADR-1 · `server/actions/staff-order.actions.ts` (`placeStaffOrder`) · `server/services/order.service.ts` (`priceOrderRequest`, `placedBy` branch) · `functions/src/triggers/price-order-request.ts` · `components/waiter/waiter-menu-entry.tsx`

### Context

`waiter-menu-entry.tsx` carried a header comment for weeks stating the intended real submit path: a "DEDICATED, role-gated server action (`placeStaffOrder`) ... that writes **directly to `orders`**, skipping `orderRequests` entirely", re-using `resolveAndPriceLines()`/`splitInclusive()` inline. The stated rationale was that `firestore.rules`' `orderRequests` **create** rule is `isGuest`-gated, so "a staff client attempting that same write would simply be rejected."

That reasoning was written before the `orderRequests` → `priceOrderRequestTrigger` → `priceOrderRequest` → `orders` pipeline actually existed. It does now (built two passes ago, `functions/` package + trigger + the relocated `order.service.ts`). And the premise has a hole: the `isGuest` gate blocks a **guest client** write. It does not block a **Server Action** — the Admin SDK bypasses `firestore.rules` entirely, exactly as `priceOrderRequest` itself already relies on.

So the choice is: a second orchestration path (`placeStaffOrder` re-doing menu resolution, 86 checks, VAT math, the approval ceiling, idempotency, the ticket write) that must be kept in lockstep with `priceOrderRequest` forever — or one extra `orderRequests` document from a trusted writer, feeding the single price authority that already does all of that.

### Decision

`placeStaffOrder` (a `tb_staff`-cookie-verified, `canPlaceStaffOrder`-gated Server Action) writes an **`orderRequests`** document — same collection, same shape as a guest's — with one extra field: `placedBy: { kind: 'staff', uid }`. The existing `priceOrderRequestTrigger` picks it up and prices it into `orders` with no trigger change.

`priceOrderRequest` makes exactly two concessions for a `placedBy.kind === 'staff'` request:

1. **It skips the party-membership check.** A guest request must come from a `hostUid`/`joinedUids` member; a waiter is legitimately not a party member. The Server Action has already cookie-verified the staff identity and role and confirmed the session is open — that is the trust boundary for a staff order, in place of party membership.
2. **It stamps the ticket's `placedBy` from the request** (`{ kind: 'staff', uid }`) instead of the hardcoded `{ kind: 'guest', uid: createdBy }`. The audit trail stays honest about who entered the order.

Everything else — menu resolution against `menuPublished/v{n}`, the fast-path 86 checks on items and modifier options, qty caps, per-tenant limits, the §8.7 staff-approval ceiling, the per-session 90-second rate limit, and idempotency via the deterministic `sha256(sessionId:clientRequestId)` order id — applies to a waiter order identically. A double-tapped "Send" produces two `orderRequests` docs that collapse to one ticket, the second resolving `'duplicate'`.

The waiter client generates a `clientRequestId` (`crypto.randomUUID()`) that is stable across a retried send of the same cart and rotates the moment the cart contents change — the same idempotency-key discipline `cart-provider.tsx` gives the guest cart.

### Consequences

- **One pricing path, not two.** No risk of a `placeStaffOrder` copy of the money math drifting from `priceOrderRequest` — the exact drift class ADR-1's own "why a mathematical guarantee" section and the §1.8 schema-patch pass exist to prevent.
- **`OrderRequest` / `OrderRequestDoc` gain an optional `placedBy`.** Absent = guest (every existing guest write is unaffected; the guest `keys().hasOnly` rule still forbids the guest from sending it). Present only on the staff path.
- **`order.service.ts` now has two documented callers' intents**, guest and staff, but still one code path. Its header says so.
- **A waiter order counts toward the party's per-session rate limit.** Accepted for now — a waiter entering >3 orders for one party inside 90 seconds is unusual, and the limit is per-tenant configurable. A staff exemption is a considered future change, not a silent one, because a compromised `tb_staff` terminal spamming orders would otherwise be unbounded.
- **A pricing rejection is now surfaced to the waiter.** The client briefly watches the `orderRequests` doc (staff can read it) and, on `'rejected'`, keeps the waiter on the cart with a staff-readable message ("an item just went 86 — review and resend"). `'priced'`/`'duplicate'`/timeout → back to the floor.
- **A waiter can now open a table with no open party** — `openTableSession` (added right after this ADR, same file) runs the same `createPartySession` write `resolveGuestSession` does, flagged `source: 'staff'` + `openedByStaffUid`, `deviceIds: []`. This is the "guest with no phone ordered verbally" path TableBells' QR-first model otherwise blocked. A late-scanning guest at a staff-opened table still gets their own party (the `deviceIds: []` session won't match the device lookup) — merging them is a separate feature.

### Alternatives Considered

- **`placeStaffOrder` writes straight to `orders`, re-pricing inline.** The original plan. Rejected: a second, permanently-parallel implementation of the single most financially-sensitive function in the codebase, to avoid one extra document from a trusted writer. The `isGuest`-gate objection that motivated it does not apply to an Admin SDK Server Action.
- **Relax the `firestore.rules` `orderRequests` create rule to also allow staff clients.** Rejected: staff order entry is a trusted, role-checked, server-side operation — routing it through a *client* write with a widened rule would put staff-order validation back into Rules' limited dialect (the exact thing ADR-1 moved out) and expand the client-reachable write surface for no benefit.
- **Give the waiter order its own `clientRequestId` per send (no stability).** Rejected: a network hiccup on submit would then double the order on retry. Reusing the guest cart's stable-key discipline makes a retry idempotent.

---

## ADR-7: Table PIN Security Model & Bill Request / Print Lifecycle

**Status:** Accepted
**Date:** 2026-09-09
**Related:** ARCHITECTURE.md §3.1, §3.3, §5, §8.2 · ADR-6 · `types/firestore.ts` (`GuestSession.joinPin` / `billingRequestedAt` / `printCount` / `lastPrintedAt`, `StaffAlertType`) · `server/services/session.service.ts` (`createPartySession`, `generateJoinPin`) · `server/actions/bill.actions.ts` (`requestBill`, `printBill`, `resolveStaffAlert`, `closeSession`) · `lib/console/staff-permissions.ts` (`canHandleBilling`) · `components/console/party-bill-actions.tsx` · `components/cashier/settle-close-control.tsx` · `hooks/use-live-waiter-data.ts`

### Context

Two threads converge here.

**1. The "QR-scan divergence."** `resolveGuestSession`'s device lookup is scoped so a scanner with no matching open session at this branch always gets a *brand-new* party — it never folds into an existing party at the table (`session.service.ts`, PARTY CREATION branch). That is correct for a stranger, and it is also the behaviour a communal table / a group splitting the check *needs*: multiple concurrent parties (A, B, …) at one physical table is a first-class feature, not a bug to design away. Earlier notes floated auto-merging a late scanner into whatever party already sat at the table; that is explicitly rejected — it is exactly the silent shared-cart ambiguity the party model (ARCHITECTURE.md §5) exists to prevent, and it would let anyone at a neighbouring table cart-bomb someone else's tab by scanning the same code.

But there *is* a real case for joining: the same group, second phone, wants onto the *same* bill. That needs an authorization step that a QR scan alone cannot carry.

**2. The bill lifecycle had no backend.** "Request Bill" set no state; "Print Receipt" was a labelled `setTimeout` mock. A table cannot be responsibly closed (a future feature) without a real `billing` state and a real record of what was printed — and in a cash-heavy UAE floor, a reprinted bill is a known fraud vector (print, pocket cash, reprint a "fresh" copy for the next customer), so a duplicate print must be *visibly* a duplicate.

### Decision

**A. Table join PIN — backend prep only.** Every session gets a `joinPin`: a 4-digit numeric string, CSPRNG-drawn (`node:crypto` `randomInt`, uniform over `0000`–`9999`), minted once in `createPartySession` and never mutated — so a QR party and a staff-opened party both have one. The *planned* flow (UI **not** built this pass): a guest scanning a table that already has ≥1 open party is offered "join an existing tab", must enter that party's `joinPin`, and a new guest-token-verified server action validates it (with the same per-member-style lockout the staff PIN uses) before adding their uid to `joinedUids`. Until that ships, a scanner still just gets their own party — the divergence behaviour is unchanged; only the *key* for the eventual join is now being generated and stored.

Why a PIN and not something stronger: it is not defending money on its own. Money is defended by the custom-claim token bound to one session **and** the live `joinedUids` membership re-check on every access (ARCHITECTURE.md §8.2), both unchanged. The PIN is the speed-bump that stops an opportunistic or accidental join by someone who can see the table but isn't part of the group. `joinPin` is readable only by staff and by guests *already* in the party (`firestore.rules` `sessions` read gate) — a not-yet-joined scanner never reads it, they submit a candidate.

**B. `requestBill` — staff-triggered, real state + alert.** A `canHandleBilling` (server/cashier/manager/owner) action that, in one transaction: flips `sessions/{id}.status` to `billing` and stamps `billingRequestedAt` (idempotent — a no-op if already `billing`), and writes a `staffAlerts` doc `{ type: 'bill_request', tableCode, sessionId, status: 'open', … }`. The alert is written on **every** call, so a second "we're still waiting" tap re-notifies without disturbing the first `billingRequestedAt`. `staffAlerts` is now listened to by **both** the Cashier inbox (`alerts-inbox.tsx`, which branches on `alert.type` — `bill_request` gets an informational teal row + "Dismiss", not the amber ghost-order + ban treatment) and the Waiter floor (`use-live-waiter-data` regained its `staffAlerts` listener; `waiter-alerts-strip.tsx` shows only `bill_request` rows).

**C. `printBill` — increment + duplicate flag.** A `canHandleBilling` action, sessions `active`/`billing` only, that increments `session.printCount` and stamps `lastPrintedAt`. It returns `duplicate: true` whenever `printCount` was **already** > 0 before this print — the UI (`<PartyBillActions>`, shared by the Cashier detail panel and the Waiter party picker) then labels the control "Reprint Bill · DUPLICATE (#n)" and the confirmation says which copy number it was. No physical printer: ADR-2's Layer-5 ESC-POS `/api/print/[billId]` route stays deferred; this owns only the database state and its UI reflection. The old per-table "Print Receipt" mock in `table-detail-panel.tsx` is removed in favour of these per-party controls.

**D. `resolveStaffAlert`.** A `canHandleBilling` action flipping a `staffAlerts` doc to `status: 'resolved'` (+ `resolvedByUid` / `resolvedAt`). It backs "Dismiss" on a `bill_request` row on both surfaces. Ghost-order alerts are still closed by the (unbuilt) manager `flagGhostOrder` ban flow, not this.

**E. `closeSession` — settle & close, the final step of the loop.** A `canHandleBilling` action, one transaction, that closes ONE party's session after the cashier has physically taken payment (no gateway — out of scope): (1) `sessions/{id}.status → 'closed'` with `closedAt` / `closedBy` / `closeReason: 'settled_by_staff'`; (2) the session's entry is removed from the denormalised `tables/{tableId}.parties[]`, and `partyCount` / `openTabFils` / `status` are recomputed from what remains — an emptied table drops back to `status: 'available'` (unless `disabled` / `attention`, which are staff-set), the exact mirror of `createPartySession`'s promote-on-open, so the Waiter floor shows the table free the instant the write propagates; (3) every still-open `bill_request` alert for that session is resolved so it stops lingering — a ghost-order alert tied to the same session is deliberately left open (a close is not a manager review). UI: `<SettleCloseControl>` (a Cashier-only two-tap confirm showing the tab total) in `table-detail-panel.tsx`, per party, offered while the session is `active` / `billing`. On success there is nothing local to do — the `tables` listener drops the party row and the component unmounts with it.

### Consequences

- **`GuestSession` gains four non-optional fields** — `joinPin`, `billingRequestedAt`, `printCount`, `lastPrintedAt`. `createPartySession` is the only full-`GuestSession` constructor, so it is the only write site that had to change (`joinPin: generateJoinPin()`, the rest `null`/`0`). Session docs written before this pass read back with these `undefined`; every reader uses `?? 0` / `?? null` / a truthiness check. `firestore.rules` needs no change — all three actions are Admin SDK.
- **`StaffAlertType` gains `'bill_request'`**, and `StaffAlert` gains optional `resolvedByUid` / `resolvedAt`. `alerts-inbox.tsx` now *must* branch on `type` — a future alert type with no branch falls through to the ghost-order rendering, which is wrong for it; add the branch when the type is added.
- **The Waiter hook's read budget grew by one listener.** `use-live-waiter-data` was deliberately `staffAlerts`-free; `bill_request` forced it back. Still `where status == 'open'` (single-field, no index), sorted client-side — the same shape the Cashier hook uses and the same deferred `(status, createdAt)` composite-index note applies (MEMORY.md §4).
- **Guest-initiated "Request Bill" is still not wired.** A guest has no `tb_staff` cookie and `firestore.rules` lets no guest client flip a session to `billing`; the guest path needs a guest-ID-token-verified server action, a pattern this codebase has no precedent for (guests write Firestore directly). A waiter tapping "Request Bill" for the guest is the wired path; the guest button is a documented follow-up, as is the whole PIN-entry join flow (A).
- **`printCount` is now audit-relevant.** A manager wants to see "this bill was printed 3×", and any archival/TTL work should treat it like the void audit trail — retained, not swept.
- **`closeSession` writes `tables/{id}.parties[]` directly** — the same accepted GAP-3 deviation `createPartySession` already carries (no `syncTableParties` trigger exists). It also writes `tables/{id}.openTabFils`, a field nothing else currently maintains incrementally; recomputing it from the remaining parties on close is strictly more correct than leaving it stale, but if a trigger ever owns that field this write must yield to it, same as the `parties[]` write.
- **A closed session still satisfies no live console query.** `use-live-cashier-data` / `use-live-waiter-data` both filter `status in ['active','idle','billing']`, so a `closed` session simply falls out of every listener — there is no "recently closed" view. Fine for now; a shift-close / Z-report surface (backlog) will need its own `closed`-scoped read.
- **No payment state is recorded.** `closeReason: 'settled_by_staff'` is the only trace; `paymentStatus` / `PAID_CASH` / `PAID_CARD` (the `firestore.rules` `isCashierBillUpdate` path already names them) are untouched because no `bills/{billId}` document is created anywhere yet. When the bill/settlement layer lands, `closeSession` should also stamp the bill's `paymentStatus`.

### Alternatives Considered

- **Auto-merge a late scanner into the existing party at the table.** Rejected — silent shared-cart ambiguity, and a trivial cart-bomb vector from the next table. The PIN-gated *opt-in* join is the controlled version of the same convenience.
- **A longer / alphanumeric join code.** Rejected for now: 4 digits is what a guest will actually type off a tablet the host turns around, the per-attempt lockout bounds brute force, and the PIN is not the money-defending control. Revisit if abuse data warrants it.
- **`requestBill` writes only the session status, no alert (let the Cashier grid's `billing` colour be the signal).** Rejected: the waiter who has to walk the bill over is not looking at the Cashier grid, and a colour change is not a notification. The explicit alert row on both surfaces is the point.
- **One `printCount === 1 ? original : duplicate` check instead of "already > 0".** Equivalent for the common path, but "already > 0" is the honest predicate — it stays correct if a `printCount` ever starts above 1 for any reason (a migration, a manual fix).

---

## ADR-8: Manager Menu Maker — the `menuDraft` → `publishMenu` model

**Status:** Accepted
**Date:** 2026-09-09
**Related:** ARCHITECTURE.md §1.5, §2.4, §7.2 · ADR-1 · `types/firestore.ts` (`MenuTreeCategory`, `MenuPublishedDoc`, `MenuDraftDoc`) · `server/actions/menu.actions.ts` (`seedMenuDraft`, `saveMenuDraft`, `publishMenu`) · `server/services/menu-version.ts` · `lib/console/staff-permissions.ts` (`canManageMenu`) · `hooks/use-menu-draft.ts` · `components/manager/menu-maker-view.tsx` · `app/(console)/[tenantSlug]/manager/menu/page.tsx` · `firestore.rules` (`menuDraft` match block)

### Context

Every catalog surface built so far — the guest menu (`use-live-menu.ts`), the Waiter order-entry menu and KDS Stock Board (`use-live-catalog.ts`), and `order.service.ts`'s pricing read — consumes `tenants/{t}/branches/{b}/menuPublished/v{n}`, a single document `{ version, categories: [{ id, items: [...] }] }`, selected by `branches/{b}.menuVersion` (`resolveMenuVersion`). **Nothing writes it.** The catalog was whatever dev seed data sat at that path. A restaurant owner could not add a category, change a price, or 86 an item for a day. Two related gaps: published categories had only an `id` (guest/staff menus rendered raw ids like `"coffee"`), and there was no editable, non-live place to build a menu before exposing it.

### Decision

**A per-branch draft document + an explicit publish step.**

- **`tenants/{t}/branches/{b}/menuDraft/current`** (`MenuDraftDoc`) — the editable tree. `firestore.rules`: readable only by `hasRole(['owner','manager'])` (never a guest, never a cashier/server/kitchen — it may hold a price that is not live yet), `allow write: if false` (Admin SDK only). Shape is `{ updatedAt, updatedByUid, lastPublishedVersion, categories: MenuTreeCategory[] }`.
- **`MenuTreeCategory`** = `{ id, name: LocalizedText, sortIndex, items: MenuItem[] }`. The `name` closes the raw-id gap; it is written onto the *published* categories too (`use-live-menu.ts` / `use-live-catalog.ts` now read `category.name.en`, with the raw id kept only as a fallback for pre-ADR-8 published docs). `order.service.ts` never reads category fields, so its `flattenMenu` is untouched — no dual-compile churn.
- **Three server actions** (`menu.actions.ts`), all `tb_staff`-verified + `canManageMenu` (`manager`/`owner`):
  - `seedMenuDraft` — create the draft from the current live `menuPublished/v{n}` (or empty). No-op if a draft exists.
  - `saveMenuDraft` — replace `categories` with a **server-re-validated, re-sanitised** copy of the editor's tree: id format, dup ids, per-category / total item caps, `LocalizedText` (English required), integer fils with a ceiling, control-character stripping on all text, `item.categoryId` forced to its parent, `option.available` forced `true` (86 stays `live/availability`'s job). Last-write-wins — a single-editor assumption, stated not hidden.
  - `publishMenu` — one transaction: read the draft + branch, re-validate, reject `EMPTY_MENU` (0 categories or 0 items — publishing that would break guest ordering), compute `nextVersion = max(branch.menuVersion, draft.lastPublishedVersion) + 1`, `set` `menuPublished/v{nextVersion}` (`MenuPublishedDoc`), `set(branch, { menuVersion: nextVersion }, { merge: true })`, and stamp `draft.lastPublishedVersion`.

### Why a new version each publish, not an in-place overwrite

`order.service.ts` prices a live order against `menuPublished/v{branch.menuVersion}` inside its transaction. Overwriting `v{n}` under a guest who is mid-checkout would let the price they saw and the price they are charged diverge. A new `v{n+1}` plus a pointer move means an in-flight order finishes against the menu it started on, and the next page load (guest scan, waiter screen open, Stock Board) resolves the new one. This is the exact "new menu on next navigation, not mid-session" behaviour `menu-version.ts` already documents — the version bump is what makes it true, and it is deliberate, not a limitation. The trade-off: an already-open guest/waiter listener (subscribed to the fixed `v{n}` doc) does **not** update until reload. Making the hooks also track the pointer is a possible follow-up; price stability during a session is the reason it is not the default.

### Why the draft is a single denormalised tree, not a normalised `menuItems/{itemId}` collection

ARCHITECTURE.md §1.5 names `tenants/{t}/menuItems/{itemId}` and `/modifierGroups/{groupId}` as tenant-level collections. A normalised source of truth with per-entity CRUD, assembly-on-publish, and cross-branch reuse is the fuller design — and much more than a skeleton needs. One draft document, edited whole and published whole, is atomic, trivially diffable, and matches the already-nested published shape one-to-one. If per-item history, cross-branch sharing, or very large catalogs (> ~800 items) ever force it, `menuItems` becomes the draft's backing store and `publishMenu` becomes an assembler — a change behind the same action boundary.

### Consequences

- **`MenuPublishedDoc` gains `version` (already there), `publishedAt`, `publishedByUid`, and `categories[].name` / `sortIndex`.** All additive; existing readers ignore the new fields, and the two menu hooks fall back to the raw id when `name` is absent.
- **`firestore.rules` gains a `menuDraft/{d}` match block.** Owner/manager read, no client write. No other rule changed — `menuPublished` and `branches/{b}` writes were already Admin-only.
- **The console gets a new route group segment, `manager/`.** `middleware.ts`'s matcher now includes it (`(kds|cashier|floor|lock|manager)`), and the page enforces `canManageMenu` itself on top of the cookie check — a logged-in cashier hitting `/manager/menu` gets an explanatory panel, not the editor.
- **`publishMenu` never touches `live/availability`.** A freshly published item is available unless the Stock Board has 86'd it; a republish does not clear existing 86 state (the availability doc is keyed by item/option id, which the manager preserves).
- **Guest-facing "category display label" gap (MEMORY.md §4) is closed** for any menu published through this flow.
- **Not built:** modifier-group editing in the UI (groups pass through save/publish untouched), item images, drag-reorder (there is a numeric `sortIndex` field), a normalised `menuItems` collection, and multi-editor conflict handling.

### Alternatives Considered

- **Edit `menuPublished/v{n}` in place, no draft, no version bump.** Rejected: no safe "work in progress" state (every keystroke would be live), and the price-stability problem above.
- **Bump the version but also copy forward to the old `v{n}` doc so open listeners update.** Rejected as the default: it reintroduces the mid-session price change for anyone already looking at `v{n}`. Left as an opt-in follow-up (hooks track the pointer) if "instant everywhere" is later wanted.
- **Client writes the draft directly under a widened `menuDraft` rule.** Rejected for the same reason ADR-1 moved money math out of Rules: menu validation (id uniqueness, caps, price ranges, text sanitisation) belongs in one server function, not Rules' limited dialect, and a client write path widens the attack surface for no benefit.
- **Skip category `name`, keep rendering raw ids.** Rejected — it is a visible defect on the guest surface and the fix is one field.

---

## ADR-9: Manager Table Management — QR codes encode the opaque slug, not a semantic URL

**Status:** Accepted — overrides the `https://[domain]/[tenantSlug]/[branchSlug]?table=[tableId]` URL named in the build task
**Date:** 2026-09-09
**Related:** ARCHITECTURE.md §1.6, §8.1 · `types/firestore.ts` (`TableSlugDoc`) · `server/services/slug.service.ts` (`generateTableSlug`, `resolveTableSlug`) · `server/actions/table.actions.ts` (`upsertTable`, `rotateTableSlug`) · `lib/console/staff-permissions.ts` (`canManageTables`) · `hooks/use-live-tables.ts` · `components/manager/{tables-manager-view,qr-print-sheet}.tsx` · `app/(console)/[tenantSlug]/manager/tables/page.tsx` · `.env.local.example` (`NEXT_PUBLIC_APP_URL`)

### Context

A pilot restaurant needs to (a) define its physical tables and (b) get printable QR codes onto table tents. Two design points needed a call.

**1. The QR URL.** The build task specified `https://[domain]/[tenantSlug]/[branchSlug]?table=[tableId]`. That is exactly the shape ARCHITECTURE.md §8.1 rejects: *"Sequential or semantic URLs (`/t/alserkal/T-04`) make this trivial: table 4 implies tables 1–24, and the tenant name is public."* The whole guest-boot chain already built — `middleware.ts` → `resolveTableSlug` → `tableSlugs/{slug}` → `checkGuestBoot` — is keyed on an **opaque, non-enumerable, rotatable** slug at `/t/{slug}`, with uniform failure so a wrong/rotated/suspended slug are indistinguishable. Encoding `tableId` + tenant name in a printed QR would undo §8.1's URL-enumeration defense for the one artifact an attacker can most easily photograph.

**2. Slug minting.** `slug.service.ts` could *resolve* a slug but nothing *minted* one — §8.1's alphabet and length were documented, the generator was a `TARGET`. `tables` were dev-seeded, `tableSlugs` had no writer.

### Decision

**QR codes encode `${NEXT_PUBLIC_APP_URL}/t/{slug}` — the opaque slug, nothing else.** No tenant name, no branch, no `tableId` in any guest-reachable URL. The build task's URL format is not implemented; this ADR records why the deviation was deliberate, not an oversight.

**`generateTableSlug()`** (`slug.service.ts`) — §8.1's 58-char unambiguous alphabet (`123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz`, no `0O1lI`), **12 chars** (the documented default; 8 is "legacy print only"), drawn with `node:crypto` `randomInt` (uniform, no modulo bias).

**`upsertTable`** (`table.actions.ts`, `canManageTables` = manager/owner, Admin SDK) — **create** mints a slug and writes `tables/{tableId}` (a full `Table` doc — `parties: []`, `slugVersion: 1`, all ops fields at their zero values) *and* `tableSlugs/{slug}` (`TableSlugDoc`) in one transaction, with a slug-collision guard (`~1 / 58¹²`, a retry re-mints). **Edit** touches only `code` / `label` / `zoneId` / `seats` / `status` — never `slug`, `parties`, `partyCount`, `activeCall`, which belong to the ops runtime. Field mapping: task's `tableNumber` → `code`, `label` → `label`, `zone`/section → `zoneId` (free text — no zone entity), `capacity` → `seats`, status toggle → `status` (`available` ⇄ `disabled` only; the other `TableStatus` values are runtime-set).

**`rotateTableSlug`** (same file / gate) — §8.1 rotation: mint a new slug, `tx.update` the old `tableSlugs` doc `active: false` (never deleted — a retired-slug audit trail; `resolveTableSlug` already treats `active: false` as `not_found`), bump `Table.slugVersion`, stamp `slugRotatedAt`. Surfaced as "Rotate QR" per row for a photographed/leaked code. Not in the original task scope; included because the QR exporter is exactly where a manager realises a code leaked, and it is ~15 lines against primitives §8.1 already specifies.

**Print sheet** (`qr-print-sheet.tsx`) — a modal that renders one tent per table (restaurant name, "scan to order", vector QR via `qrcode-generator`, table label + zone, and the full URL in small type for physical verification) plus an `@media print` block that isolates `#qr-print-area` so `window.print()` yields clean pages. Per-table and "Print all" both open the same sheet.

**`status: 'disabled'` does NOT deactivate the slug.** `checkGuestBoot` already returns `table_unavailable` for `status === 'disabled'`, so a scan of a disabled table's QR shows the generic unavailable page — correct, and it means re-enabling a table needs no reprint. Only `rotateTableSlug` ever flips a `tableSlugs` doc inactive.

### Consequences

- **`Table` gains no new fields** — the §1.6 schema already had `slug` / `slugVersion` / `slugRotatedAt`. `TableSlugDoc` is promoted from a local interface in `slug.service.ts` to `types/firestore.ts` and shared.
- **`tables` and `tableSlugs` writes stay Admin-only.** No `firestore.rules` change — the manager reads `tables` via the existing `isStaff(t) && inBranch(b)` rule; both write paths were already `if false`.
- **New env var `NEXT_PUBLIC_APP_URL`.** The QR URL origin. Falls back to `https://app.tablebells.ae` (fine for previewing the print layout, wrong for a real print run). Resolved server-side in the page so the fallback lives in one place.
- **`middleware.ts` matcher gains `manager`** (shared with ADR-8's Menu Maker route). The page also enforces `canManageTables` itself.
- **New unverified deps:** `qrcode-generator` + `@types/qrcode-generator` (pure JS, no `fs` — chosen over `qrcode` for browser-bundle safety). Never installed — same caveat as `hash-wasm` / `tsx`.
- **The restaurant display name** is now read from `tenants/{tid}.displayName ?? .name` (best-effort, falls back to the slug) — a first real source for MEMORY.md §4's "display name is hardcoded" gap, though only on this page.
- **`sortIndex` on create** comes from a non-transactional max-scan of existing tables — two simultaneous creates can tie, which is cosmetic (the grid just `orderBy`s it).

### Alternatives Considered

- **Implement the task's `/{tenantSlug}/{branchSlug}?table={tableId}` URL.** Rejected — it is the §8.1 anti-pattern, exposes `tableId` and the tenant name on the most-photographed artifact in the building, and there is no `branchSlug` in the schema. The opaque-slug chain is already built and load-bearing.
- **Deactivate the `tableSlugs` mapping when a table is disabled.** Rejected — re-enabling would then need a reprint, and `checkGuestBoot` already handles `disabled` correctly. Slug lifecycle stays a rotation-only concern.
- **A `zones` collection with real zone entities.** Deferred — `zoneId` as free text ("Terrace") is enough for a pilot; the guest surface never displays it. Revisit if floor-plan / zone reporting is built.
- **Server-rendered QR images / a `/api/print` PDF route.** Deferred — client-side vector SVG + `window.print()` needs no new route, no server rendering, and prints crisp. The ESC-POS `/api/print/[billId]` route (ADR-2 Layer 5, a different concern — thermal *receipts*) remains separately deferred.

---

## ADR-10: Manager Staff Management — single role, staffCode + PIN, server-side writes

**Status:** Accepted — keeps the single-`role` model over the build task's "one or multiple roles"
**Date:** 2026-09-09
**Related:** ARCHITECTURE.md §1.6 · `types/firestore.ts` (`StaffMember`, `StaffMemberSummary`, `StaffMemberStatus`) · `server/actions/staff.actions.ts` (`listStaff`, `upsertStaff`) · `server/services/staff-login.service.ts` · `server/auth/{staff-pin,mint-staff-session}.ts` · `lib/console/staff-permissions.ts` (`canManageStaff`) · `components/manager/staff-manager-view.tsx` · `app/(console)/[tenantSlug]/manager/staff/page.tsx` · `scripts/seed-staff-member.ts` (the hand-run tool this replaces)

### Context

Roles are heavily gated (`canManageMenu`, `canPlaceStaffOrder`, `canHandleBilling`, …) but the only way to create a `members/{uid}` document was `scripts/seed-staff-member.ts`, run by hand under ADC. A pilot manager needs a UI. The build task asked for: name + "identifier (PIN or email, depending on how auth is structured)" + "one or multiple roles" + revoke.

Three points needed a call against the established auth model.

**1. Roles are single, not a set.** `StaffSessionPayload.role`, the Firebase custom claims (`{ role }`), and every `firestore.rules` check (`request.auth.token.role in [...]`) carry exactly ONE role. `staff-login.service.ts` reads one `member.role` and `mint-staff-session.ts` mints one. Multi-role would touch the cookie schema, the claims, Rules, the login service, and every `StaffPermissionSubject` predicate — a large cross-cutting change for a need the hierarchy already covers: `manager` subsumes the front-of-house abilities of `cashier` / `server` in every predicate; `kitchen` is the one genuinely distinct capability. So the UI is a **single-select**, and "the manager also runs a till" is served by the `manager` role, not a role set.

**2. The identifier is a `staffCode` + PIN, not email.** `staff-login.service.ts`'s own header explains why: per-user-salted argon2id means you cannot hash a candidate PIN once and find a member — you need the member identified *first*, and per-member rate limiting requires the same. The staff types a short `staffCode` (`[A-Za-z0-9]{1,10}`, e.g. `"11"`) then a 4–8 digit PIN at `/lock`. The Staff Management form collects exactly those.

**3. Writes are a server action, and the roster is a fetch — not a live client listener.** `members/{uid}` is `allow write: if false` (Admin only); `firestore.rules` *does* let a manager/owner *read* the collection, but a live `onSnapshot` would ship every member's `pinHash` (argon2id PHC string) to the browser. `listStaff` returns a `StaffMemberSummary` projection with **no hash** and only "is the PIN locked right now", not the raw counters.

### Decision

**`StaffMember`** (`types/firestore.ts`) — the canonical §1.6 shape the seed script already writes, formalised. `StaffMemberStatus` widened to `'active' | 'inactive' | 'suspended'` (`staff-login.service.ts` already blocks any non-`'active'`, so no login-path change). **`StaffMemberSummary`** — the browser-safe projection.

**`listStaff({ branchId })`** — `canManageStaff` (manager/owner). `where('branchIds', 'array-contains', branchId)` (single-field, no composite index), mapped to sanitised summaries, sorted by name.

**`upsertStaff`** — `canManageStaff`, Admin SDK, one transaction:
- **Create** — derived uid `mbr_<tenantId>_<staffCode>`, PIN required and argon2id-hashed *before* the transaction (`hashStaffPin`), full §1.6 doc written, `staffCode` uniqueness checked two ways (derived-uid collision + a `where staffCode ==` query).
- **Edit** — patches `displayName` / `staffCode` / `role` / `jobTitle` / `branchIds` / `overrideAuth` / `status`; a supplied `pin` also re-hashes and **clears the lockout counters** (matching the seed script's `--reset-pin`); a blank `pin` keeps the existing hash.
- **Privilege-escalation guards** — only an `owner` may create/edit an `owner` or grant `overrideAuth` (void / discount / refund / ghost-ban authority). A manager cannot touch a member whose branches don't overlap their own, and on edit can only *add* branches they themselves hold (keeping/dropping a branch the member already had is fine — so a branch-A manager can still revoke a member who is also in branch B).

**Revocation.** `status !== 'active'` blocks the next `/lock` login immediately (the source of truth). For an already-live session, `upsertStaff` additionally best-effort `adminAuth.revokeRefreshTokens(uid)` + `setCustomUserClaims(uid, { stf: false })` on a role/branch/status/override change — which breaks that member's console listeners within ~1h (next ID-token refresh). **Residual gap, stated not hidden:** the `tb_staff` cookie is a standalone 8-hour JWT with no server-side denylist, so a revoked member's cookie still passes Server-Action auth until it expires. A cookie revocation list closes it fully and is a separate, larger piece.

**UI** — `/{tenantSlug}/manager/staff`, `canManageStaff`-gated on top of the cookie. Fetch-on-mount + refetch-after-mutation (no listener). Single-select role (`owner` shown only to an owner), branch checkboxes limited to `session.bids`, `overrideAuth` checkbox disabled unless the actor is an owner, status select with a "Revoke" / "Reactivate" quick action per row.

### Consequences

- **`types/firestore.ts` gains `StaffMember` / `StaffMemberSummary` / `StaffMemberStatus`.** `staff-login.service.ts`'s local `MemberDoc.status` now references the shared type; behaviour unchanged (`!== 'active'`).
- **`firestore.rules` unchanged.** `members` write was already `if false`; the read rule for manager/owner exists but is now unused by this feature (the action reads via Admin SDK).
- **The seed script (`scripts/seed-staff-member.ts`) is no longer the only way to onboard staff** — it stays as a break-glass / first-owner bootstrap tool (you need one manager/owner before the UI is reachable).
- **`middleware.ts` matcher** already covers `manager` (ADR-8) — no change.
- **The `tb_0492` placeholder tenant** in `api/auth/pin/route.ts` is *not* fixed here — `upsertStaff` derives its tenant from the verified `tb_staff` cookie's `tid` claim, which is real; only the login *route* still hardcodes the tenant (MEMORY.md §4).
- **No email, no self-service.** A member cannot change their own PIN — only a manager/owner resets it. Self-service PIN change is a considered future addition.

### Alternatives Considered

- **Multi-role as a `roles: StaffRole[]`.** Rejected — cascades through the cookie, custom claims, `firestore.rules`, `staff-login.service.ts`, and every permission predicate. The role hierarchy already covers the real "does two jobs" case (`manager` ⊇ cashier/server).
- **Email + password auth for staff.** Rejected — `staff-login.service.ts`'s per-user-salted argon2id + per-member rate limit require a fast pre-PIN identifier; a `staffCode` on a PIN pad is that. Email would be a parallel auth stack.
- **A live `onSnapshot` roster (like `use-live-tables`).** Rejected — it would ship `pinHash` to every manager's browser. Staff management isn't a real-time ops surface; a fetch is fine.
- **Hard, instant revocation.** Rejected for this pass — the `tb_staff` cookie has no denylist, so true instant kill needs new infrastructure. `status` + token revoke (≈1h to bite on a live session) is what the current architecture allows; the gap is documented.
- **Let a manager grant `overrideAuth` / create owners.** Rejected — that is privilege escalation from a role that is itself only manager-gated. Owner-only.

---

## ADR-11: Localization, Shared-Device Lock, and Order Attribution

**Status:** Accepted
**Date:** 2026-09-09
**Related:** ARCHITECTURE.md §1.5, §1.8, §1.9, §2.1 · ADR-1 · `pricing.service.ts` (`splitInclusive`) · `order.service.ts` (`priceOrderRequest`) · `bill.actions.ts` (`voidTicketLine`) · `lib/format/money.ts` · `lib/branch-settings.ts` · `server/actions/branch-settings.actions.ts` · `hooks/use-branch-settings.ts` · `components/manager/store-settings-view.tsx` · `components/console/lock-switch-button.tsx` · `components/guest/cart-checkout-view.tsx` · `firestore.rules` (`orderRequests` create)

Three V1-readiness items shipped together.

### 1. Store Settings & Localization

**Context.** The stack hardcoded AED and a 5% VAT rate in exactly one place each — `pricing.service.ts`'s `VAT_PPM` constant and a dozen local `formatAed` helpers. Running a pilot in the US or UK needs both configurable per branch.

**Decision.**
- **`branches/{b}.settings`** (`BranchSettings` = `{ currency, vatPpm, receiptFooter }`). `vatPpm` is VAT as **parts-per-million** (`50_000` = 5%, `85_000` = 8.5%) — an integer, so no float ever touches the money path. `lib/branch-settings.ts` owns the defaults (AED / 5% / empty) and the percent⇄ppm conversion; the manager UI shows a percent field.
- **`splitInclusive(grossFils, vatPpm = 50_000)`** — the ONE VAT function (§1.9) takes the rate as a parameter now. The default keeps a caller that hasn't resolved a branch rate behaving as before, but it is a safety net: `priceOrderRequest` passes `branch.settings.vatPpm`, and `voidTicketLine` passes the `vatPpm` it reads back off the order.
- **`priceOrderRequest` SNAPSHOTS `currency` + `vatPpm` onto every `Order`** at price time. A mid-meal settings change never re-splits an existing ticket or bill — the same price-stability principle as ADR-8's menu versioning. `voidTicketLine`'s recompute uses `order.vatPpm`, so a void stays consistent with how the ticket was priced.
- **`updateBranchSettings`** (`canManageSettings` = manager/owner, Admin SDK, merge write) is the only path to `branches/{b}` (client write is `if false`). UI at `/{tenantSlug}/manager/settings`.
- **`formatMoney(minorUnits, currency)`** (`lib/format/money.ts`) is the new single formatter; `formatAed` is a `formatMoney(x, 'AED')` wrapper kept for un-migrated call sites. The guest menu / cart / checkout read `currency` from `GuestSessionContext` (resolved server-side in `guest-boot.service.ts` alongside `menuVersion`); the KDS / Cashier **order** surfaces read the snapshotted `order.currency`. A handful of staff price displays that have neither an order nor the guest context (`table-card` open-tab, `settle-close-control`, the menu-maker/stock/waiter-entry menu prices) still show AED — a cosmetic follow-up, not a math bug; the defaults are AED and every figure that reaches a bill is correct.

**Consequences.** `Order` gains `currency` / `vatPpm` (+ `placedByName` / `guestName`, below). `GuestSessionContext` gains `currency` / `vatPpm`. `pricing.service.ts` and `order.service.ts` are the dual-compiled files — the changes are additive and import-free, so the `functions/` build is unaffected and `functions/src/triggers/price-order-request.ts` did not need to change.

### 2. Shared-Device "Lock / Switch User"

**Context.** `lockTerminal` already deleted the `tb_staff` cookie and redirected to `/lock`, but its own header flagged that it can't sign the Firebase client SDK out (that state is in IndexedDB, client-only) — and now that the consoles hold real listeners, a stale client session would keep the previous waiter's Firestore access alive on the shared iPad.

**Decision.** `<LockSwitchButton>` (`components/console/lock-switch-button.tsx`): `signOut(auth)` (best-effort, wrapped) **then** `lockTerminal(tenantSlug)`. Prominent dark pill labelled "Lock / Switch User", dropped into the Cashier and Waiter headers in place of the small "Lock" buttons. The `signOut` failing must not block the cookie clear + redirect, which is the security-relevant half.

### 3. Order Attribution & Guest Names

**Context.** The KDS and Cashier could see `placedBy: { kind, uid }` but not a name; a café workflow needs "who is this order for / from" on the ticket.

**Decision.**
- **Staff:** `placeStaffOrder` now writes `placedByName: staffSession.displayName` onto the `orderRequests` doc (the name is already on the verified cookie — no `members/{uid}` lookup). `priceOrderRequest` sanitises it and copies it to `order.placedByName`.
- **Guest:** an **optional** `guestName` field on the checkout screen — asked *there*, right before "Place Order", never at QR scan. `firestore.rules`' `orderRequests` create rule adds `'guestName'` to `keys().hasOnly` and a `safeText(…, 60)` guard; `priceOrderRequest` re-sanitises via the existing `sanitizeGuestText` and writes `order.guestName`, and stamps `session.guestName` the first time any order in the party carries one (so the Cashier can label the whole tab).
- **Display:** KDS `ticket-card` / `ticket-detail-view` and Cashier `table-detail-panel` show the guest name as a prominent chip next to the table label, and `· by <name>` for staff-placed tickets.

### Alternatives Considered

- **Store the VAT rate as a percent float on the branch doc.** Rejected — a float in the money path is exactly what §1.9's "integer fils, no exceptions" rule forbids. `vatPpm` (integer ppm) converts to a percent only for the manager's eyes.
- **Re-price existing orders when settings change.** Rejected — same reasoning as ADR-8: a guest mid-checkout must not see the number move. Snapshot-at-price-time.
- **Migrate all ~14 `formatAed` call sites now.** Deferred for the non-order staff displays — they need a currency source this pass doesn't thread (a shared console currency context is the clean fix). Money math and every bill-bound figure are currency-correct; the gap is cosmetic and documented.
- **Ask the guest's name at QR scan.** Explicitly rejected by the task and correct — it adds friction to the frictionless path (ADR-4). Checkout is the only place it's asked.
- **A hard client-SDK kill list for instant lock.** Not needed — `signOut` + cookie delete + redirect is immediate for the shared-iPad case; the 8h-cookie residual only matters for a *revoked* member (ADR-10), not a voluntary switch.
