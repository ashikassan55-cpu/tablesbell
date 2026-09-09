# TableBells — Coding Constraints

**This file is the absolute law for all code written in this project.** Every server action, component, rule, and function generated from this point forward must conform to every section below. Where a specific instruction in a given task appears to conflict with a rule here, the rule here wins unless the user explicitly overrides it in that conversation — and that override should be treated as scoped to the task at hand, not as a silent amendment to this file.

**Precedence between the project's core documents:**

| Document | Governs |
|---|---|
| `RULES.md` (this file) | *How* code is written — conventions, boundaries, quality bar |
| `ARCHITECTURE.md` | *What* the system is — schema, collections, real-time flows, directory layout |
| `DECISIONS.md` | *Why* it is that way — historical rationale, superseded designs |

If `RULES.md` and `ARCHITECTURE.md` ever appear to disagree, that is a bug in one of the two documents, not a judgment call for the code to resolve silently. Stop and reconcile the documents in the same change that surfaced the conflict — do not pick a side and move on.

---

## 1. Tech Stack & Framework

1. **Next.js App Router only.** No Pages Router, no `getServerSideProps`/`getStaticProps`, anywhere in this codebase.
2. **Server Components are the default.** A file gets `'use client'` only when it genuinely needs one of: a Firestore `onSnapshot` listener, a browser timer (`setInterval`/`requestAnimationFrame`), an input/event handler, or browser-only APIs (audio, vibration, clipboard). Page shells, layouts, and anything that only reads and displays server-fetched data stay server components. This is not a style preference — the guest and staff surfaces both depend on server components for correct SEO-irrelevant-but-latency-relevant behavior (first paint from the server, no client-side waterfall for static shell content).
3. **Data fetching happens in Server Components and Server Actions**, never via client-side `fetch`/`axios` for anything the server could have fetched and passed down. A client component receives data as props or via a scoped Firestore listener — it does not independently re-fetch what a server component already has.
4. **Middleware runtime is deliberate, not default.** `middleware.ts` runs on the **Node.js runtime** with a narrow `matcher` (per ARCHITECTURE.md §3.3), because it needs `firebase-admin` for slug resolution and session wake — the Edge runtime cannot host it. Do not widen the matcher to run on every request "for convenience"; middleware that touches the Admin SDK on every navigation is both a cost and a correctness risk.
5. **Tailwind CSS is the only styling system.** No CSS-in-JS library, no CSS Modules, no inline `style={{...}}` objects except for a value that is genuinely computed at runtime (e.g., a progress-bar width derived from elapsed time) — and even then, the inline style must carry a one-line comment explaining why Tailwind's utility classes couldn't express it.
6. **No UI component library that ships its own theming** (Material UI, Chakra, Ant Design, etc.). Every component is built from Tailwind utilities against the two theme scopes already established — `data-surface="guest"` and `data-surface="ops"` — per ARCHITECTURE.md §7.3. A third-party *headless* primitives library (e.g., Radix primitives with no built-in visual styling) is acceptable; a themed component library is not.
7. **Firebase Admin SDK is the only Firestore/Auth client permitted in server code.** Every Server Component, Server Action, Route Handler, and Cloud Function that touches Firestore or Auth does so through the Admin SDK singleton (`server/firebase/admin.ts`). The Firebase **client** SDK is used exclusively inside `'use client'` components running in the browser. Mixing the two — e.g., calling the client SDK from a Server Action — is a defect regardless of whether it happens to work in a given environment.
8. **One Admin SDK singleton.** Never call `initializeApp()` a second time in a new file. Every module that needs Admin Firestore imports the existing singleton; if it doesn't exist yet in a given package (e.g., the separate `functions/` package), it gets its own single singleton for that package, not a second one alongside an existing one in the same package.
9. **No parallel backend.** Next.js Route Handlers and Cloud Functions v2 are the only server execution surfaces in this project. Do not introduce Express, Fastify, a separate API gateway, or any other server runtime.
10. **The Firestore region is `me-central2`, fixed and immutable.** No code, config, or new Cloud Function may target a different region. This is not configurable per-environment — staging and production both live in `me-central2`.

---

## 2. Security Boundaries

These rules exist because the entire product is built on the premise that a guest's device is hostile input. They are not defensive style points — each one closes a specific, previously-identified failure mode (see `DECISIONS.md`).

1. **A client never calculates a price it intends to persist or submit.** A cart UI may compute a running subtotal for *display only*, and it may do so **only** by summing `priceFils` values already present on the fetched `menuPublished` snapshot — never a value the client derived, adjusted, or cached independently. Any such client-side total is cosmetic; the guest's actual order carries no price field at all (see rule 3).
2. **A guest client may create documents in exactly three collections, and no others: `orderRequests`, `serviceCalls`, `partyJoinRequests`.** Adding a fourth guest-writable collection is not a decision a single code change gets to make — it requires updating `firestore.rules`, `ARCHITECTURE.md` (§1.7), and this file together, in the same change, with the same scrutiny every existing guest-write path received.
3. **`orderRequests` documents may never contain a money field**, under any field name, nested or otherwise — enforced today by `noMoneyFields()` in `firestore.rules`. Do not attempt to route a price through a differently-named field, a nested object, a string-encoded number, or a nested array. If a future feature seems to need the client to communicate something price-adjacent, the answer is a new *server-validated* code path, not a new field on this collection.
4. **The `orders` collection has zero client-reachable write path — for any principal, including staff, with one narrow exception.** Ticket lifecycle, `items[]`, and every money field (`grossFils`, `netFils`, `vatFils`, `lineTotalFils`, `unitPriceFils`) are writable only by `priceOrderRequest` and the Admin-SDK staff server actions (`advanceTicket`, `voidTicketLine`, `voidTicket`, `flagGhostOrder`). The **only** exception is the field-scoped cashier update (`adjustments`, `paymentStatus`, `receiptPrintedAt`, `updatedAt`, `updatedBy`) gated by `isCashierBillUpdate()` — and that gate's `diff().affectedKeys().hasOnly([...])` check is itself part of this law: it must never be loosened to permit a client to touch anything outside those five fields.
5. **All money is an integer of fils.** A field ending in `Fils` never holds a float, a string, or a value produced by `/` division without an immediate `Math.round`. There is exactly one function permitted to derive VAT from a gross amount: `splitInclusive()` in `pricing.service.ts`. No file reimplements it — not inline, not "just for an estimate," not temporarily. A client-facing estimate (if ever needed) must be visibly labeled as an estimate in the UI and must never be written to Firestore.
6. **Guests are append-only, without exception.** No guest-writable collection ever grants `update` or `delete`, including for cases that feel harmless — "let a guest edit their own note before it's priced" is exactly the kind of change that looks safe and isn't. The correct pattern is always: the guest creates a new document; a human or a trusted server function decides what happens to anything that came before it.
7. **Every guest-writable document's security rule pairs a deny-list (for money fields) with an allow-list (`keys().hasOnly([...])` for the complete field set).** A rule shipping with only one of the two is an incomplete rule and must be treated as a review-blocking defect, not a smaller version of a complete one.
8. **All server-side text fields containing guest input are sanitized before they reach a trusted document — and sanitized for the surface they will actually reach.** Text destined for a screen goes through `sanitizeGuestText` (Layer 2). Text destined for a thermal printer goes through the ESC-POS whitelist (Layer 5) **in addition to**, not instead of, Layer 2 — see `DECISIONS.md` ADR-2. Never copy raw guest input directly into a trusted collection under the assumption that Firestore Rules' Layer 1 check already made it safe; Layer 1 is a shape gate, not a normalization pass.
9. **Every server action and Cloud Function follows the same shape:** `getAuthContext()` (or the guest-session equivalent) → role/session guard → input validation (zod or an equivalent explicit check) → idempotency check → transaction → audit write → typed result. Skipping a step is not an optimization; it is a gap.
10. **No hardcoded per-tenant business value.** Thresholds, limits, fee percentages, SLA targets — anything that could plausibly differ between a casual café and a high-end restaurant is read from that tenant's own configuration document at call time, never from a module-level constant used as anything but a documented fallback. This is not a style preference; it is the specific lesson of `DECISIONS.md` ADR-3.
11. **Firebase App Check must be verified as actively enforced**, not merely configured, on any new client entry point before that entry point is permitted to write to Firestore, Functions, or Storage in production. "The SDK is initialized" is not the same claim as "enforcement is on" — confirm which one is true before treating a surface as protected.

---

## 3. UI/UX Standards

The guest and staff surfaces are not two skins on one layout — they are built for physically different contexts (a phone in a hand under café lighting; a tablet on a fixed mount under service pressure) and must never borrow each other's layout patterns.

### Guest surface (`data-surface="guest"`) — mobile-first, thumb-driven

1. Base viewport is **390px width**, single-column, vertical scroll. Content never assumes a wider screen is available; a tablet or desktop viewer gets a centered, width-capped version of the same single column — never a multi-column reflow.
2. **Primary actions live in the thumb zone: bottom-anchored, not top-anchored.** The cart bar, "Call Waiter," and checkout actions are fixed or sticky at the bottom of the viewport, respecting `env(safe-area-inset-bottom)`. A guest should never need to reach toward the top of the screen for a primary action.
3. **Every interactive element meets a 48×48px minimum touch target**, even when its visible artwork is smaller (a quantity stepper's `+`/`-`, a category pill, a modifier checkbox).
4. Category browsing uses a **sticky-top tab bar**; it does not compete with the bottom action bar for the guest's attention.
5. Theme tokens come from the guest design system: coral/terracotta primary, Plus Jakarta Sans for headings and prices, Inter for body/modifier text, 12px base corner radius, warm off-white background — never the ops palette, never a raw hex value outside the theme token definitions.
6. **RTL is structural from the first line of code, not retrofitted.** Every guest component uses logical properties (`ps-4`, `pe-2`, `ms-*`, `me-*`, `start-0`, `end-0`) — never `pl-*`/`pr-*`/`left-*`/`right-*`. Arabic headings carry the documented +4px line-height adjustment.
7. No login, no PIN entry, no permission prompt (location, notifications) anywhere on this surface unless a specific future feature explicitly requires it and has been approved as an exception — the frictionless mandate is a hard constraint, not a default that individual screens can opt out of.

### Staff surface (`data-surface="ops"`) — tablet-first, glance-driven

1. Base viewport is **1024–1280px landscape**. This surface is a fixed multi-pane shell — navigation rail, content canvas, ticket/docket sidebar — never a scrolling single column and never a bottom tab bar. A staff console redesigned to "look more like the guest app" is a regression, not an improvement.
2. **Dense grids over generous whitespace.** The floor grid, the KDS queue, and the menu-management table are built to show as much simultaneous state as a 2-second glance can absorb — this surface optimizes for scanning under service pressure, not for aesthetic breathing room.
3. Every price, table number, timer, and elapsed-time value uses **tabular figures** (`font-variant-numeric: tabular-nums`, or the Tailwind `tabular-nums` utility) so digits don't jitter as they change.
4. Status badges and operational tags are **uppercase with widened letter-spacing**, per the ops design system — this is a legibility rule for peripheral vision under time pressure, not decoration.
5. Theme tokens come from the ops design system: deep teal primary, crimson reserved **exclusively** for active alerts/urgent calls (never used decoratively, never used for anything that isn't an unresolved customer-facing issue), Inter throughout.
6. 48×48px minimum touch targets apply here too — a rushed tap during service is less precise than a calm one, not more.

### Both surfaces

1. **State is never color-only.** Every status (urgent, ready, out-of-stock, error) pairs its color with an icon and a text label. A colorblind staff member or a guest in bright sunlight must be able to read every state without relying on hue discrimination.
2. Contrast ratio ≥ 4.5:1, checked against both the light and dark rendering paths documented in `ARCHITECTURE.md`.
3. **No `dangerouslySetInnerHTML`, anywhere, on any guest-originated text, ever.** This is enforced by an ESLint rule (`react/no-danger: error`) with no permitted exceptions and is restated here as absolute law, not merely a linter default someone could disable.
4. No hardcoded English-only user-facing string. Every string a guest or staff member reads goes through the i18n layer (`lib/i18n`). A string with no Arabic translation yet still routes through the same key with a tracked placeholder — it never bypasses the i18n system "temporarily."
5. **Every listener-backed component has an explicit loading state and an explicit offline state.** A bare flash of empty content while a Firestore listener attaches is not acceptable. The staff console shows a hard "Offline — actions disabled" banner rather than silently queuing or dropping a write.

---

## 4. Code Quality

1. **TypeScript strict mode, no exceptions.** `strict: true` in every `tsconfig.json` in this repo. No `any` — use `unknown` with explicit narrowing, or a precise generic. No implicit `any`. No non-null assertion (`!`) unless a guard clause immediately above it has already proven the value non-null in the same block, and a comment says so. `as` casts are permitted only at a genuine I/O boundary (e.g., typing a Firestore `DocumentData` immediately after an existence check), never as a way to silence a type error whose root cause hasn't been addressed.
2. **Types flow one direction: `types/firestore.ts` → converters → services → actions → components.** A component never redefines a document shape locally with an inline type or a loose object literal — it imports the canonical type. If the canonical type doesn't yet cover a field a component needs, the fix is to add the field to the canonical type, not to work around it locally.
3. **Early returns over nested conditionals.** A function reads top-to-bottom as a sequence of guard clauses followed by the success path — not a pyramid of nested `if` blocks. `order.service.ts`'s validation logic (`resolveAndPriceLines`, the re-validation block in `priceOrderRequest`) is the reference pattern: every failure condition returns immediately with a typed rejection, and the function's "happy path" is never more than one indentation level deep. If a function starts accumulating nested conditionals, extract a helper or restructure around guard clauses before adding more logic to it.
4. **Every server action and Cloud Function returns a typed result union — it does not throw across a client-facing boundary for an expected, business-logic failure.** `PriceOrderOutcome`'s three-way union (`priced` / `duplicate` / `rejected`) is the pattern: a rejected order is a normal, typed return value, not an exception. A function may still throw for a genuine, unexpected infrastructure failure (a Firestore outage, a malformed environment) — and when it does, the throw site carries a comment explaining why this particular failure is infrastructure-level rather than business-logic-level, exactly as documented in `order.service.ts`'s Cloud Functions wiring note.
5. **No silent `catch` blocks.** A `catch` that neither rethrows, returns a typed error result, nor logs with enough context to diagnose the failure later is not permitted. "Catch and ignore" is never an acceptable error-handling strategy in this codebase.
6. **No `console.log` in committed code.** Use the structured logger, which tags `tenantId`/`branchId`/`sessionId` on every entry (per `ARCHITECTURE.md` §9's observability requirement). A log line with no tenant/branch context is not useful in a multi-tenant system and is not an acceptable substitute for one that has it.
7. **Every Firestore transaction completes all reads before any write.** This is a hard runtime constraint of the Firestore transaction API, not a style guideline — violating it throws at runtime, not at compile time, which makes it easy to reintroduce by accident while editing. Before adding a new `tx.get()` call to an existing transaction, confirm it appears before every `tx.set()`/`tx.update()`/`tx.delete()` call already in that function.
8. **Every new mutating server action ships with an idempotency key**, a role/session guard as its first executed check, and — whenever the target document could plausibly be mutated concurrently by another actor — a transaction, never a bare `get()` followed by a separate `set()`.
9. **No duplicated business logic.** If a function like `splitInclusive` or `sanitizeGuestText` already exists, importing it is mandatory. A second implementation anywhere in the repo — even one described as temporary, or "just for this one screen" — is a review-blocking defect. This applies beyond VAT math: it is the general law `ARCHITECTURE.md` §1.9 states specifically for `splitInclusive` and is restated here as a project-wide standard.
10. **Documentation and code change together, in the same commit.** A new collection, a new field on an existing collection, or a new server action that changes a trust boundary must be reflected in `ARCHITECTURE.md` (schema) and, where applicable, `firestore.rules` and this file — in the same change that introduces it, not as a follow-up. Code that outruns its own documentation is exactly the failure mode this project has already had to correct once (`ARCHITECTURE.md` §1.8's patch); it does not get a second pass.
11. **A change to `firestore.rules` ships with a corresponding entry in the mandatory security regression suite** (`ARCHITECTURE.md` §8.9). A change to money-arithmetic logic ships with a boundary-value unit test asserting `netFils + vatFils === grossFils` across a range of gross values chosen to sit on rounding boundaries.

---

## 5. Pre-Merge Checklist

A fast, non-exhaustive sanity pass before any change lands — not a replacement for the sections above, a summary of the parts that are easiest to forget under deadline pressure:

- [ ] Does this touch a guest-writable collection? If so: does it still pass the deny-list *and* allow-list check (§2.7)?
- [ ] Does this add or change a price-bearing field? If so: is `splitInclusive()` the only place VAT is derived, and is the gross recomputed from scratch rather than adjusted incrementally?
- [ ] Does this add a new Firestore transaction, or a new read inside an existing one? If so: does every read still happen before every write?
- [ ] Does this add a new server action? If so: does it follow the guard → validate → idempotency-check → transact → audit shape (§2.9)?
- [ ] Does this add a new collection, field, or trust-boundary change? If so: are `ARCHITECTURE.md`, `firestore.rules`, and this file all updated in the same change?
- [ ] Does this touch guest-facing UI? If so: is it single-column, bottom-anchored, 48px-minimum, and free of any login/permission prompt?
- [ ] Does this touch staff-facing UI? If so: is it built for the fixed tablet shell, with tabular numerals on every number that changes?
- [ ] Is there a hardcoded business value (a threshold, a fee, an SLA target) that should instead be read from the tenant's own document?
