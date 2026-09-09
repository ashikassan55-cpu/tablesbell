# TableBells — Product Requirements Document

**This document defines what ships in Phase 1 and, with equal force, what does not.** Its purpose is to prevent scope drift, not to describe every capability the underlying architecture is *capable* of supporting. A feature is in scope only if it appears under §2. Anything not listed there — including a feature the schema in `ARCHITECTURE.md` already accommodates for structural or security reasons — is out of scope until this document is revised, in writing, before the work begins. "The data model already supports it" is not the same claim as "it is in Phase 1," and the two must never be conflated mid-sprint.

---

## 1. Core Value Proposition

**TableBells is a frictionless, real-time digital ordering and waiter-calling platform for independent restaurants in the UAE, built on a "Bring Your Own Device" (BYOD) hardware model.**

### What "frictionless" means, precisely

A guest scans the QR code printed on their table and is browsing the menu on their own phone within seconds — no app download, no account creation, no login, no PIN, no GPS permission prompt. This is not a marketing claim layered on top of the product; it is an architectural constraint enforced at every layer, from the middleware that mints a guest session on first scan to the Firestore rules that never grant a guest write path requiring authentication beyond an anonymous token. Every Phase 1 feature below is scoped to preserve this, not to trade it away for convenience elsewhere.

### What "BYOD" means, precisely — and why it is the business model, not a footnote

TableBells ships no proprietary hardware. The guest orders on the smartphone already in their hand. The restaurant's staff use tablets or phones they already own, or inexpensive commodity Android tablets, running a browser — not a licensed POS terminal, not a dedicated SDK, not a vendor-locked device. This is the specific cost and adoption advantage TableBells offers an independent café or casual-dining operator in the UAE against traditional POS vendors, whose business model depends on selling or leasing hardware: **TableBells' entire value proposition collapses if Phase 1 quietly grows a hardware or native-app dependency.** Every UI surface in this document is a responsive web application, reachable by URL, on whatever device the restaurant or guest already has.

### What the product actually is, beyond "another QR menu"

A QR code that opens a static PDF menu is not a competitive product in this market anymore; it is table stakes. What TableBells sells is the mechanism underneath the QR code:

- A cart that survives a guest putting their phone down for twenty minutes and picking it back up — the same open tab, not a fresh one (`DECISIONS.md` ADR-4).
- A kitchen that sees a correctly priced ticket within about a second of the order being placed, with no manual re-entry and no possibility of a guest-supplied price ever reaching a receipt (`DECISIONS.md` ADR-1).
- A waiter-calling and table-management layer that keeps two strangers at one communal table on two separate, isolated bills by default — and lets a genuine group share one bill only when the host of that group explicitly chooses to, via a code they generate themselves (`ARCHITECTURE.md` §5).
- Structured, modifier-based customization instead of per-item free text, because a kitchen reading "extra shot, oat milk, no foam" from a dropdown is faster and less error-prone under service pressure than a kitchen parsing a guest's handwritten-equivalent sentence — a deliberate operational choice, not a limitation.

---

## 2. Phase 1 — The MVP

Three user-facing pillars. Each is described as what a specific person can do, followed by the concrete capabilities that make it true, followed by the minimum supporting capability required for it to function at all — named explicitly and bounded tightly, so that bounding line is never blurred later.

### 2.1 Continuous Cart Guest UI

> *As a diner, I scan the code on my table and I am immediately looking at the menu. I never see a login screen, a PIN pad, or a permission prompt. If I put my phone down and come back later, my order and my table are still exactly where I left them.*

**Ships in Phase 1:**

- Instant QR-scan entry: a cryptographic table slug resolves to a live, bilingual (en/ar) menu with no intermediate screen. A guest's entire menu load is two Firestore reads.
- Structured ordering only: item selection, quantity, and modifier groups (with their own min/max/required constraints). No per-line free-text field — a guest's only free-form input is a single order-level note, which is deep-sanitized before it ever reaches a kitchen screen.
- Continuous cart: a session goes idle after 60 minutes of no activity and wakes automatically, on the same bill, the moment the guest re-scans the same table's code — no re-authentication, no cart loss.
- Two-way table transfer: staff can move a party to a new table from the console, updating the guest's screen live; a guest can only move by scanning the new table's code and confirming a prompt — there is no table picker anywhere in the guest UI.
- Shared tables with host approval: two strangers scanning the same table always get two separate, isolated carts. A genuine group shares one bill only if the party's host generates a short-lived invite code from their own phone for the others to scan.
- Waiter-calling: a persistent, low-friction action to call staff, request water, or request the bill, with a visible acknowledgment once staff have seen it.
- **No payment collection in Phase 1.** The guest orders and eats; settlement happens at the table through staff, via the Cashier Dashboard (§2.3). Online/prepayment checkout is a deliberately stubbed, future capability (`ARCHITECTURE.md` §6) — not a Phase 1 gap, a Phase 1 decision.

### 2.2 Real-Time Kitchen Display System (KDS)

> *As a kitchen staff member, an order appears on my station's screen within about a second of a guest placing it. It is already correctly priced. I never need to trust, verify, or re-enter anything the guest's device told the system — by the time I see it, it has already been priced from the restaurant's own menu, not from the guest's phone.*

**Ships in Phase 1:**

- Live ticket queue with station filtering, sorted by placement time and priority, showing only open tickets — the queue never grows unbounded across a shift.
- Ticket lifecycle: `New → Preparing → Ready → Served`, advanced with a single tap, with elapsed-time and SLA-breach indicators derived from a server timestamp, never a stored countdown.
- Global "out of stock" toggle: one tap on the KDS greys the item out on every guest's phone in the branch within about a second, and blocks any in-flight order from being priced against it.
- Single-item rejection: a chef can void one line of an otherwise-good ticket (an ingredient just ran out) without cancelling the rest of the order. The guest is notified automatically, and the bill is credited with VAT recomputed from scratch on the surviving lines — never adjusted incrementally (§4.2 below).

**Minimum supporting capability, explicitly bounded:** *Menu & Modifier Management* — the ability for a manager to create a menu item, set its price, group it under modifiers, and toggle its availability. This is the bare minimum tooling required for a menu, and therefore a kitchen, to exist at all. **It is not, and must never be conflated with, Advanced Inventory Management** (§3) — there is no stock count, no supplier integration, no automatic depletion logic behind the 86 toggle. A human taps a switch; nothing counts anything.

### 2.3 Cashier Dashboard

> *As a cashier, I can see every table's live, running tab; apply an authorized discount or void when a manager approves one; mark a bill settled by cash or card; and print a VAT-compliant receipt — all without leaving one screen, and without ever being able to alter what the kitchen already charged for the food itself.*

**Ships in Phase 1:**

- Live floor view showing every table, every party occupying it (a table can hold more than one isolated bill at once, per §2.1), and each party's running total.
- Bill assembly from priced kitchen tickets — the cashier never re-enters or recalculates a line item; the bill is built from what the kitchen already confirmed.
- A narrow, audited settlement action: mark a bill `UNPAID → PAID_CASH` or `PAID_CARD`, append a discount/void/comp entry to an append-only adjustment ledger (any non-zero amount requires manager or owner authority), and stamp a receipt as printed. This is the *only* direct write path a staff client has onto an order document — everything else about that document remains server-controlled.
- **Ghost Order protection**, one tap: when a ticket turns out to be a prank or a fake order sent to an empty table, a single console action voids the ticket, credits the bill correctly, and permanently blocks the offending device and account from placing another order at this restaurant.
- VAT-compliant receipt printing: every printed receipt shows the restaurant's Tax Registration Number, net amount, VAT amount, and gross total, and those three numbers always reconcile exactly (§4.2).

**Minimum supporting capability, explicitly bounded:** *Staff Identity & Access* — a device-bound PIN and a role (owner/manager/cashier/server/kitchen) for each staff member, so the console knows who is acting and what they are allowed to do. This is access control, not workforce management. **It is not, and must never be conflated with, Staff Scheduling** (§3) — there is no shift roster, no clock-in/clock-out, no labor-cost forecasting. A staff member either has a PIN and a role, or they don't.

---

## 3. Out of Scope for Phase 1 (Phase 2 Backlog)

These three are explicitly, deliberately deferred. Each would add real engineering surface without validating the hypothesis Phase 1 exists to test — that frictionless ordering plus real-time kitchen and floor synchronization is what independent UAE restaurants will actually adopt and pay for.

### 3.1 Staff Scheduling

Shift rostering, availability and time-off requests, labor-cost forecasting against sales, and shift-swap workflows. Phase 1 ships the identity layer this would eventually sit on top of (§2.3's Staff Identity & Access) — a role and a PIN — deliberately stopping short of anything that manages *when* that person is supposed to be working.

### 3.2 Advanced Inventory Management

Ingredient-level stock counts, supplier and purchase-order integration, automatic 86-on-depletion, and waste/shrinkage reporting. Phase 1 ships the manual 86 toggle this would eventually automate (§2.2) — a human decides an item is unavailable and says so, with no inventory math running underneath that decision.

### 3.3 Customer Loyalty Programs

Points, tiers, rewards, and repeat-visit incentives. Deferred for a reason beyond effort: a loyalty program requires a durable, cross-visit guest identity, and Phase 1's guest identity is deliberately anonymous and session-scoped by design (`DECISIONS.md` ADR-4). Building loyalty on top of Phase 1's identity model without first deciding how — or whether — to introduce a persistent, opt-in guest identity would be building on ground that isn't there yet.

### 3.4 Validating demand before building: Fake Door testing

Before committing engineering time to any of the three items above, ship a **Fake Door** for it first: a visible affordance in the manager console — a "Staff Scheduling — coming soon, let us know if you need this" card, or a "Join the loyalty program waitlist" prompt — that measures genuine interest (clicks, sign-ups, direct requests) before a single line of the underlying feature exists. The threshold for "enough signal to start building" is a call for the founder to make against real usage data once tenants are live, not a number this document should invent in advance.

### 3.5 Also explicitly deferred

Restated here for completeness, not as new scope decisions — each is a direct consequence of a decision already made in `ARCHITECTURE.md`:

- **Payment gateway activation.** The interface is stubbed (`ARCHITECTURE.md` §6) so that wiring a real provider later is a swap, not a rebuild — but Phase 1 ships pay-at-table settlement only, exactly as §2.1 and §2.3 describe.
- **The Superadmin Fleet Console.** Multi-tenant data isolation exists from day one for security reasons (`ARCHITECTURE.md` §1, §8.2) — every restaurant's data is isolated whether or not there are ten tenants or one. The fleet-management *UI* — cross-tenant billing, a tenant-provisioning wizard, system health dashboards — is an internal operations tool for when there are enough tenants to need one, not a guest, kitchen, or cashier concern, and not a Phase 1 deliverable.
- **Manager analytics and reporting beyond same-day reconciliation.** `analyticsDaily` is populated from day one because the Cashier Dashboard needs it for same-day settlement — but trend charts, AOV and SLA-compliance dashboards, and CSV/PDF export are a reporting *UI* that reads from data Phase 1 already has, and building that UI is Phase 2 work.

---

## 4. Non-Functional Requirements

### 4.1 Abuse resilience

**The Probe Attack.** An attacker places one small, legitimate-looking order specifically to clear any history-based exemption, then places an arbitrarily large fraudulent order immediately after, expecting the second order to go unscrutinized. **Requirement: any single order whose value exceeds a restaurant-configured threshold must be flagged for staff approval, with no exemption based on how many orders that table's session has already placed.** This is not a future requirement — it is already closed. An earlier design exempted a session's first order from this check on the theory that a fake order strikes an empty table on its opening ticket; that exemption was the exact hole the probe attack exploited, and it has been removed entirely (`DECISIONS.md` ADR-3). The threshold itself is per-restaurant, not one number shared across the platform.

**The Double-Tap.** A guest's flaky café Wi-Fi, or simple impatience, causes their device to submit the same order twice. **Requirement: a duplicate submission of the same order must never produce two kitchen tickets, and must never bill the guest twice — even under an automatic client retry.** This is closed by construction: every priced ticket's identity is derived deterministically from the guest's session and their own client-generated request id, so a retried submission and the original converge on the exact same kitchen ticket rather than creating a second one (`DECISIONS.md` ADR-1).

### 4.2 Financial integrity

**Zero-drift VAT.** Every VAT figure on every receipt must reconcile exactly — net plus VAT equals gross — at all times, including immediately after a partial item is voided mid-service. This is not a cosmetic nicety; a receipt that doesn't reconcile is a compliance defect against a UAE VAT return, not a rounding curiosity. The specific failure mode this requirement forbids: subtracting a voided item's "own" VAT from the ticket's running VAT total drifts by a fil or more per adjustment, compounding across a service. The requirement instead is that VAT is always *recomputed from scratch*, on the gross of whatever lines survive, through the single sanctioned VAT function in the codebase — never adjusted incrementally, never computed a second way anywhere else (`ARCHITECTURE.md` §1.9, §2.6; `DECISIONS.md` ADR-1).

### 4.3 Guest privacy and frictionless access

No guest account, email address, phone number, or location permission is ever required to place an order, in Phase 1 or in any future phase — this is a permanent product constraint, not a Phase 1 limitation to be lifted later (`DECISIONS.md` ADR-4).

### 4.4 Availability and offline behavior

The staff console degrades to a clearly labeled read-only state when offline rather than silently failing a write or queuing an action that might land against stale state. A guest sees a cached menu when offline; placing an order requires connectivity.

### 4.5 Data residency

All tenant data resides in the `me-central2` region, consistent with the data-residency expectations of the UAE market this product is built for.
