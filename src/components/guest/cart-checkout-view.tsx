'use client';

/**
 * src/components/guest/cart-checkout-view.tsx
 *
 * LIVE-WIRED. This file's own previous header specified the exact
 * real implementation to become; that specification had one field-name
 * bug, caught and corrected while actually wiring it up against the
 * real `order.service.ts` (not assumed from memory): the placeholder
 * comment expected a rejection's detail on `data.rejectionDetail`
 * universally. The real `priceOrderRequest` writes the machine-readable
 * code to `data.reason` (`'CALLER_BANNED'`, `'RATE_LIMITED'`,
 * `'SESSION_CLOSED'`, `'ITEM_NOT_FOUND'`, …) on every rejection;
 * `rejectionDetail` is present only alongside ONE of those reasons
 * (`'ITEM_NOT_FOUND'`) and is not guest-safe to show verbatim even then.
 * `rejectionMessage()` below reads `reason`, not `rejectionDetail`, and
 * maps it to a small, deliberately coarse set of guest-facing messages —
 * see that function's own comment for which reasons get their own
 * message and why the rest collapse into one.
 *
 * TRANSPORT: still exactly what the previous header said it would be —
 * a direct Firestore client-SDK `addDoc` into `orderRequests`
 * (DECISIONS.md ADR-1, never a REST call), gated by `firestore.rules`
 * (`noMoneyFields`, `keys().hasOnly`, `ownsSessionClaim` +
 * `inParty` + `partyOpen`), followed by an `onSnapshot` listener on the
 * resulting document waiting for `priceOrderRequest` (a Cloud Functions
 * v2 trigger) to flip its `status` away from `'pending'`.
 *
 * A GAP THIS FILE CANNOT CLOSE BY ITSELF, stated plainly rather than
 * implied by a working-looking spinner: `functions/src/triggers/
 * price-order-request.ts` does not exist yet in this codebase (MEMORY.md
 * §2, item 6). The `addDoc` below is fully real and will genuinely
 * create a valid, rules-compliant `orderRequests` document today — but
 * nothing will ever flip its `status` away from `'pending'` until that
 * trigger is deployed. The `slow` fallback in `SubmitState` exists
 * specifically for that gap: after a bounded wait, the UI stops implying
 * an active kitchen conversation and says the order was received and is
 * being reviewed instead — true today, and still true (just usually not
 * reached) once the trigger exists and typically resolves in well under
 * that window.
 *
 * CART LOCKING WHILE SUBMITTING: quantity/remove controls and the note
 * field are disabled for the duration of `submitState.status ===
 * 'submitting'`. Not just UX polish — `clientRequestId`
 * (`cart-provider.tsx`) rotates the instant `lines` changes, so an edit
 * that landed mid-flight would silently orphan the in-flight request's
 * id from the cart state now describing something else. Locking the
 * cart makes that race structurally impossible rather than something to
 * reason about after the fact.
 *
 * SANITIZATION NOTE, unchanged from the previous pass: the note field
 * still does NOT perform Layer 2 sanitization here. That logic exists
 * exactly once, server-side (`order.service.ts`'s `sanitizeGuestText`) —
 * a client-side copy would be both a duplicate implementation
 * (RULES.md §4.9) and a false sense of security. This component's only
 * job for the note is the character-count UX affordance; the raw string
 * goes through untouched.
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import {
  addDoc,
  collection,
  onSnapshot,
  serverTimestamp,
  type DocumentData,
  type DocumentReference,
  type FirestoreError,
} from 'firebase/firestore';
import { db, auth } from '@/lib/firebase/client';
import { useCart } from '@/components/providers/cart-provider';
import { useGuestSession } from '@/components/providers/guest-session-provider';
import { formatMoney } from '@/lib/format/money';
import type { OrderRequest } from '@/types/firestore';

const MAX_GUEST_NAME = 40;

// Mirrors order.service.ts's LIMIT_DEFAULTS.maxNoteChars / maxOrderLines.
// In production these are read per-tenant, not hardcoded — these
// client-side copies exist only for an honest live UX affordance and
// are never authoritative; firestore.rules and order.service.ts enforce
// the real limits regardless of what this shows or blocks early.
const MAX_NOTE_CHARS = 150;
const MAX_LINES = 40;

// How long to wait for `priceOrderRequest` to resolve before the UI
// stops implying an active, seconds-away answer. See file header —
// this exists specifically because that Cloud Functions trigger isn't
// deployed yet; the listener itself is NOT torn down when this fires,
// only the displayed copy changes.
const SLOW_RESOLUTION_MS = 12_000;

/**
 * Maps `OrderRequest.reason` (a machine code `order.service.ts` writes,
 * never guest-facing text) to something safe to show a diner. Two
 * reasons get their own honest, actionable message because they are NOT
 * security-sensitive facts — a throttle and a stale/86'd item are just
 * operational reality. Every other reason (`CALLER_BANNED`,
 * `TENANT_SUSPENDED`, `SESSION_CLOSED`, `SESSION_NOT_FOUND`,
 * `NOT_IN_PARTY`, `REQUEST_NOT_PENDING`, and anything not yet named
 * here) collapses into ONE generic message — ARCHITECTURE.md §8.1's
 * uniform-failure principle applied to order rejection the same way it
 * already applies to session boot: a banned guest must not be able to
 * distinguish their own rejection from a rate limit or a stale session
 * by reading the message. The `default` branch is deliberate, not lazy —
 * it means a FUTURE reason code added to `order.service.ts` fails safe
 * (generic message) instead of leaking a new, unreviewed string to
 * guests by omission.
 */
function rejectionMessage(reason: string | undefined): string {
  switch (reason) {
    case 'RATE_LIMITED':
      return "You're sending orders a little too quickly. Please wait a moment and try again.";
    case 'ITEM_NOT_FOUND':
      return 'One or more items in your order are no longer available. Please review your cart and try again.';
    default:
      return "We couldn't send your order. Please check with a member of staff.";
  }
}

type SubmitState =
  | { status: 'idle' }
  | { status: 'submitting'; slow: boolean }
  | { status: 'succeeded'; orderId: string }
  | { status: 'rejected'; message: string };

export function CartCheckoutView({ slug }: { slug: string }) {
  const cart = useCart();
  const session = useGuestSession();
  const [submitState, setSubmitState] = useState<SubmitState>({ status: 'idle' });
  // ADR-11 — asked HERE, at checkout, never at QR scan. Optional.
  const [guestName, setGuestName] = useState('');

  const unsubscribeRef = useRef<(() => void) | null>(null);
  const slowTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const cleanupListener = useCallback(() => {
    unsubscribeRef.current?.();
    unsubscribeRef.current = null;
    if (slowTimerRef.current !== null) {
      clearTimeout(slowTimerRef.current);
      slowTimerRef.current = null;
    }
  }, []);

  // Tears down any in-flight listener/timer if the guest navigates away
  // mid-submission — an unmounted component calling setState would
  // otherwise be a silent no-op at best and a real leak at worst.
  useEffect(() => () => cleanupListener(), [cleanupListener]);

  const noteRemaining = MAX_NOTE_CHARS - cart.note.length;
  const locked = submitState.status === 'submitting';

  const handleSubmit = async () => {
    if (locked) return; // guards against a double-tap racing itself
    if (cart.lines.length === 0) return; // unreachable via the UI below, kept as a real guard, not decoration
    if (cart.lines.length > MAX_LINES) {
      setSubmitState({ status: 'rejected', message: 'Your order has too many items — please split it into two orders.' });
      return;
    }
    if (!session.authReady || session.authError) {
      setSubmitState({ status: 'rejected', message: "We couldn't verify your session. Please rescan the table QR code." });
      return;
    }
    const uid = auth.currentUser?.uid;
    if (!uid) {
      // Should not be reachable once authReady is true -- zero-trust
      // guard, not an expected path. See RULES.md §4.4: this is exactly
      // the "genuinely unanticipated" case a typed result still covers
      // rather than throwing, since it's still a guest-facing outcome,
      // not an infra failure.
      setSubmitState({ status: 'rejected', message: "We couldn't verify your session. Please rescan the table QR code." });
      return;
    }

    setSubmitState({ status: 'submitting', slow: false });

    const trimmedName = guestName.trim().slice(0, MAX_GUEST_NAME);
    const payload: Omit<OrderRequest, 'createdAt' | 'status'> = {
      sessionId: session.sessionId,
      tableId: session.tableId,
      lines: cart.lines.map((line) => ({
        itemId: line.item.id,
        qty: line.qty,
        modifierOptionIds: [], // no modifier-selection UI built yet — see menu-item-card.tsx / MEMORY.md §4
      })),
      note: cart.note, // ALWAYS a string, never omitted — firestore.rules' safeText() requires the field to exist
      clientRequestId: cart.clientRequestId,
      createdBy: uid,
      // ADR-11 — only include the key when the guest actually typed a name;
      // `firestore.rules` `keys().hasOnly` accepts its presence OR absence.
      ...(trimmedName ? { guestName: trimmedName } : {}),
    };

    let requestRef: DocumentReference<DocumentData>;
    try {
      requestRef = await addDoc(
        collection(db, `tenants/${session.tenantId}/branches/${session.branchId}/orderRequests`),
        {
          ...payload,
          // serverTimestamp(), not Date.now() -- firestore.rules'
          // authoredNow() requires this to equal request.time exactly;
          // a client clock value never satisfies that check.
          createdAt: serverTimestamp(),
          status: 'pending',
        },
      );
    } catch {
      // Never surface the raw Firestore error (could name a collection
      // path, a rule, or other internals) -- same uniform-failure
      // discipline as every other guest-facing failure in this app.
      setSubmitState({ status: 'rejected', message: "We couldn't send your order. Please check with a member of staff." });
      return;
    }

    slowTimerRef.current = setTimeout(() => {
      setSubmitState((prev) => (prev.status === 'submitting' ? { status: 'submitting', slow: true } : prev));
    }, SLOW_RESOLUTION_MS);

    const onError = (error: FirestoreError) => {
      void error; // never surfaced verbatim -- see uniform-failure note above
      cleanupListener();
      setSubmitState({ status: 'rejected', message: "We couldn't send your order. Please check with a member of staff." });
    };

    unsubscribeRef.current = onSnapshot(
      requestRef,
      (snap) => {
        const data = snap.data() as OrderRequest | undefined;
        if (!data || data.status === 'pending') return; // still waiting -- no terminal state yet

        cleanupListener();

        if (data.status === 'priced' || data.status === 'duplicate') {
          // 'duplicate' means THIS exact logical order already succeeded
          // under an earlier attempt (see cart-provider.tsx's header on
          // why the id is stable across retries) -- from the guest's
          // point of view that IS success, not a different outcome.
          const orderId = data.orderId ?? '';
          setSubmitState({ status: 'succeeded', orderId });
          cart.clearCart();
          return;
        }

        // data.status === 'rejected'
        setSubmitState({ status: 'rejected', message: rejectionMessage(data.reason) });
      },
      onError,
    );
  };

  // ---- Guard-clause-style state machine (RULES.md §4.3) --------------

  if (submitState.status === 'succeeded') {
    return <OrderSubmittedScreen slug={slug} tableCode={session.tableCode} orderId={submitState.orderId} />;
  }

  if (cart.lines.length === 0) {
    return <EmptyCartScreen slug={slug} />;
  }

  return (
    <div className="flex min-h-dvh flex-col bg-[#FAF9F6] pb-40">
      <header className="sticky top-0 z-20 flex items-center gap-3 border-b border-[#E5E7EB] bg-white/90 px-4 py-3 backdrop-blur">
        <Link
          href="../"
          aria-label="Back to menu"
          className="flex h-10 w-10 items-center justify-center rounded-full text-[#1F2937]"
        >
          <span aria-hidden="true">←</span>
        </Link>
        <div className="min-w-0">
          <h1 className="text-base font-semibold text-[#1F2937]">Your Order</h1>
          <p className="text-xs text-[#6B7280]">{session.tableCode}</p>
        </div>
      </header>

      <main className="flex-1 space-y-6 px-4 py-4">
        <ul className="flex flex-col gap-2">
          {cart.lines.map((line) => (
            <li
              key={line.item.id}
              className="flex items-center gap-3 rounded-xl border border-[#ECE7E1] bg-white p-3"
            >
              <div className="min-w-0 flex-1">
                <p className="truncate text-[15px] font-semibold text-[#1F2937]">{line.item.name}</p>
                <p className="text-sm text-[#6B7280]">{formatMoney(line.item.priceFils, session.currency)} each</p>
              </div>

              <div className="flex shrink-0 items-center gap-2">
                <div className="flex items-center rounded-full border border-[#E5E7EB]">
                  <button
                    type="button"
                    onClick={() => cart.updateQty(line.item.id, line.qty - 1)}
                    disabled={locked}
                    aria-label={`Decrease quantity of ${line.item.name}`}
                    className="flex h-10 w-10 items-center justify-center text-lg font-semibold text-[#1F2937] disabled:opacity-40"
                  >
                    −
                  </button>
                  <span className="w-6 text-center text-sm font-semibold text-[#1F2937]" aria-live="polite">
                    {line.qty}
                  </span>
                  <button
                    type="button"
                    onClick={() => cart.updateQty(line.item.id, line.qty + 1)}
                    disabled={locked}
                    aria-label={`Increase quantity of ${line.item.name}`}
                    className="flex h-10 w-10 items-center justify-center text-lg font-semibold text-[#1F2937] disabled:opacity-40"
                  >
                    +
                  </button>
                </div>

                <button
                  type="button"
                  onClick={() => cart.removeItem(line.item.id)}
                  disabled={locked}
                  aria-label={`Remove ${line.item.name} from cart`}
                  className="flex h-10 w-10 items-center justify-center rounded-full text-[#E5484D] disabled:opacity-40"
                >
                  <span aria-hidden="true">🗑</span>
                </button>
              </div>
            </li>
          ))}
        </ul>

        <div>
          <label htmlFor="guest-name" className="mb-1.5 block text-sm font-semibold text-[#1F2937]">
            Name for the order? (optional)
          </label>
          <input
            id="guest-name"
            value={guestName}
            onChange={(event) => setGuestName(event.target.value.slice(0, MAX_GUEST_NAME))}
            disabled={locked}
            placeholder="e.g. Sam"
            autoComplete="name"
            className="w-full rounded-xl border border-[#E5E7EB] bg-white p-3 text-sm text-[#1F2937] placeholder:text-[#9CA3AF] disabled:opacity-60"
          />
          <p className="mt-1 text-xs text-[#9CA3AF]">Helps the kitchen and staff match the order to you.</p>
        </div>

        <div>
          <label htmlFor="order-note" className="mb-1.5 block text-sm font-semibold text-[#1F2937]">
            Anything else? (optional)
          </label>
          <textarea
            id="order-note"
            rows={3}
            value={cart.note}
            onChange={(event) => cart.setNote(event.target.value.slice(0, MAX_NOTE_CHARS))}
            disabled={locked}
            placeholder="e.g. less sugar please, no cutlery needed…"
            className="w-full resize-none rounded-xl border border-[#E5E7EB] bg-white p-3 text-sm text-[#1F2937] placeholder:text-[#9CA3AF] disabled:opacity-60"
          />
          <p className="mt-1 text-end text-xs text-[#9CA3AF]" aria-live="polite">
            {noteRemaining} characters left
          </p>
        </div>

        <div className="rounded-xl border border-[#ECE7E1] bg-white p-3">
          <div className="flex items-center justify-between text-sm text-[#6B7280]">
            <span>Subtotal (estimated)</span>
            <span>{formatMoney(cart.totalFils, session.currency)}</span>
          </div>
          <p className="mt-1 text-xs text-[#9CA3AF]">
            Final total, including VAT, is confirmed by the kitchen once your order is placed.
          </p>
        </div>

        {submitState.status === 'rejected' ? (
          <div role="alert" className="rounded-xl border border-[#E5484D]/30 bg-[#E5484D]/5 p-3">
            <p className="text-sm font-semibold text-[#E5484D]">We couldn&apos;t send that order</p>
            <p className="mt-0.5 text-sm text-[#6B7280]">{submitState.message}</p>
          </div>
        ) : null}

        {submitState.status === 'submitting' && submitState.slow ? (
          <div role="status" className="rounded-xl border border-[#E5E7EB] bg-white p-3">
            <p className="text-sm font-medium text-[#1F2937]">Your order was received and is being reviewed.</p>
            <p className="mt-0.5 text-xs text-[#6B7280]">This is taking longer than usual — you can keep waiting here.</p>
          </div>
        ) : null}
      </main>

      <div
        className="fixed inset-x-0 bottom-0 z-30 border-t border-[#ECE7E1] bg-white/95 backdrop-blur"
        style={{ paddingBottom: 'env(safe-area-inset-bottom)' }}
      >
        <button
          type="button"
          onClick={handleSubmit}
          disabled={locked || !session.authReady}
          className="mx-4 my-3 flex h-14 w-[calc(100%-2rem)] items-center justify-center gap-2 rounded-xl bg-[#E85D3F] text-base font-semibold text-white transition-opacity active:scale-[0.98] disabled:opacity-60"
        >
          {locked ? (
            <>
              <span
                className="h-4 w-4 animate-spin rounded-full border-2 border-white/40 border-t-white"
                aria-hidden="true"
              />
              Sending to kitchen…
            </>
          ) : (
            <>Place Order · {formatMoney(cart.totalFils, session.currency)}</>
          )}
        </button>
      </div>
    </div>
  );
}

function EmptyCartScreen({ slug }: { slug: string }) {
  return (
    <div className="flex min-h-dvh flex-col items-center justify-center gap-3 bg-[#FAF9F6] px-6 text-center">
      <p className="text-lg font-semibold text-[#1F2937]">Your cart is empty</p>
      <p className="text-sm text-[#6B7280]">Add something from the menu to get started.</p>
      <Link
        href={`/t/${slug}`}
        className="mt-2 flex h-12 items-center justify-center rounded-xl bg-[#E85D3F] px-6 text-sm font-semibold text-white"
      >
        Back to Menu
      </Link>
    </div>
  );
}

function OrderSubmittedScreen({ slug, tableCode, orderId }: { slug: string; tableCode: string; orderId: string }) {
  return (
    <div className="flex min-h-dvh flex-col items-center justify-center gap-3 bg-[#FAF9F6] px-6 text-center">
      <div className="flex h-16 w-16 items-center justify-center rounded-full bg-[#4E937A]/10 text-3xl text-[#4E937A]">
        <span aria-hidden="true">✓</span>
      </div>
      <h1 className="text-xl font-semibold text-[#1F2937]">Order Submitted</h1>
      <p className="text-sm text-[#6B7280]">
        Kitchen is reviewing order {orderId} for {tableCode}.
      </p>
      <p className="text-xs text-[#9CA3AF]">
        {/* TODO: once app/(guest)/t/[slug]/order/[orderId]/page.tsx exists,
            this should be a router.push there instead of a static message. */}
        You&apos;ll see live updates here once the order tracker is built.
      </p>
      <Link
        href={`/t/${slug}`}
        className="mt-2 flex h-12 items-center justify-center rounded-xl border border-[#E5E7EB] bg-white px-6 text-sm font-semibold text-[#1F2937]"
      >
        Order Something Else
      </Link>
    </div>
  );
}
