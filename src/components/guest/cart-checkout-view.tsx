'use client';

/**
 * src/components/guest/cart-checkout-view.tsx
 *
 * Screen 3 of the Stitch "TableBells Guest Ordering" flow — cart / order
 * review: the table card, per-line cards (thumbnail + modifiers +
 * quantity stepper + remove), the Kitchen Notes & Allergies field, a
 * VAT-inclusive Bill Summary, and the Place Order bar.
 *
 * TRANSPORT unchanged from the prior pass: a direct Firestore client-SDK
 * `addDoc` into `orderRequests` (DECISIONS.md ADR-1), gated by
 * `firestore.rules` (`noMoneyFields`, `keys().hasOnly`, `ownsSessionClaim`
 * + `inParty` + `partyOpen`). On success the guest is routed to the live
 * order tracker (`/t/{slug}/status?r=<requestId>`), which owns the
 * `pending → priced → rejected` listener and the prep timeline — the
 * elaborate `onSnapshot`/slow-fallback state machine that used to live
 * here moved there so "place order → confirmation screen" is one real
 * navigation, matching the design.
 *
 * The note field still does NOT sanitize client-side — that logic exists
 * once, server-side (`order.service.ts` `sanitizeGuestText`); here the
 * raw string goes through untouched and the count is only a UX
 * affordance. VAT math mirrors `store-settings-view.tsx`'s inline split;
 * `pricing.service.ts` is the authority and re-prices on the server.
 */

import { useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { addDoc, collection, serverTimestamp } from 'firebase/firestore';
import { db, auth } from '@/lib/firebase/client';
import { useCart } from '@/components/providers/cart-provider';
import { useGuestSession } from '@/components/providers/guest-session-provider';
import { useGuestLocale } from '@/components/providers/guest-locale-provider';
import { formatMoney } from '@/lib/format/money';
import type { OrderRequest } from '@/types/firestore';

const MAX_GUEST_NAME = 40;
const MAX_NOTE_CHARS = 150;
const MAX_LINES = 40;

function vatSplit(grossFils: number, vatPpm: number): { netFils: number; vatFils: number } {
  if (vatPpm <= 0) return { netFils: grossFils, vatFils: 0 };
  const netFils = Math.round((grossFils * 1_000_000) / (1_000_000 + vatPpm));
  return { netFils, vatFils: grossFils - netFils };
}

type SubmitState = { status: 'idle' } | { status: 'submitting' } | { status: 'rejected'; message: string };

export function CartCheckoutView({ slug }: { slug: string }) {
  const cart = useCart();
  const session = useGuestSession();
  const { t, locale, toggle, dir } = useGuestLocale();
  const router = useRouter();
  const [submitState, setSubmitState] = useState<SubmitState>({ status: 'idle' });
  const [guestName, setGuestName] = useState('');

  const locked = submitState.status === 'submitting';
  const grossFils = cart.totalFils;
  const { netFils, vatFils } = vatSplit(grossFils, session.vatPpm);
  const vatPct = Math.round((session.vatPpm / 10_000) * 100) / 100;
  const noteRemaining = MAX_NOTE_CHARS - cart.note.length;

  async function handleSubmit() {
    if (locked || cart.lines.length === 0) return;
    if (cart.lines.length > MAX_LINES) {
      setSubmitState({ status: 'rejected', message: t('request_failed') });
      return;
    }
    const uid = auth.currentUser?.uid;
    if (!session.authReady || session.authError || !uid) {
      setSubmitState({ status: 'rejected', message: t('session_error') });
      return;
    }

    setSubmitState({ status: 'submitting' });
    const trimmedName = guestName.trim().slice(0, MAX_GUEST_NAME);
    const payload: Omit<OrderRequest, 'createdAt' | 'status'> = {
      sessionId: session.sessionId,
      tableId: session.tableId,
      lines: cart.lines.map((line) => ({ itemId: line.item.id, qty: line.qty, modifierOptionIds: [] })),
      note: cart.note,
      clientRequestId: cart.clientRequestId,
      createdBy: uid,
      ...(trimmedName ? { guestName: trimmedName } : {}),
    };

    try {
      const ref = await addDoc(
        collection(db, `tenants/${session.tenantId}/branches/${session.branchId}/orderRequests`),
        { ...payload, createdAt: serverTimestamp(), status: 'pending' },
      );
      router.push(`/t/${slug}/status?r=${ref.id}`);
    } catch {
      setSubmitState({ status: 'rejected', message: t('request_failed') });
    }
  }

  if (cart.lines.length === 0) {
    return (
      <div dir={dir} className="flex min-h-dvh flex-col items-center justify-center gap-3 bg-[#FAF9F6] px-6 text-center font-body">
        <p aria-hidden className="text-4xl">🛍️</p>
        <p className="font-heading text-lg font-bold text-[#1F2937]">{t('cart_empty')}</p>
        <Link
          href={`/t/${slug}/menu`}
          className="mt-2 flex h-12 items-center justify-center rounded-full bg-[#FF6B4A] px-6 text-sm font-semibold text-white"
        >
          {t('browse_menu')}
        </Link>
      </div>
    );
  }

  return (
    <div dir={dir} className="flex min-h-dvh flex-col bg-[#FAF9F6] pb-44 font-body">
      {/* Header */}
      <header className="sticky top-0 z-20 flex items-center gap-3 border-b border-[#E5E7EB] bg-white/90 px-4 py-3 backdrop-blur">
        <Link
          href={`/t/${slug}/menu`}
          aria-label={t('back')}
          className="flex h-9 w-9 items-center justify-center rounded-full text-lg text-[#1F2937]"
        >
          <span aria-hidden>{dir === 'rtl' ? '→' : '←'}</span>
        </Link>
        <span className="flex h-7 w-7 items-center justify-center rounded-lg bg-[#FF6B4A] text-[10px] font-bold text-white">
          TB
        </span>
        <h1 className="flex-1 font-heading text-[16px] font-bold text-[#1F2937]">{t('checkout')}</h1>
        <button
          type="button"
          onClick={toggle}
          className="flex items-center gap-1 rounded-full bg-[#EFF4FF] px-2 py-1 text-[11px] active:scale-95"
        >
          <span className={locale === 'en' ? 'font-bold text-[#FF6B4A]' : 'text-[#6B7280]'}>EN</span>
          <span className="text-[#D1D5DB]">|</span>
          <span className={locale === 'ar' ? 'font-bold text-[#FF6B4A]' : 'text-[#6B7280]'}>عربي</span>
        </button>
      </header>

      <main className="flex-1 space-y-4 px-4 py-4">
        {/* Table card */}
        <div className="flex items-center justify-between rounded-xl bg-white p-4 shadow-sm">
          <div className="flex items-center gap-3">
            <span aria-hidden className="flex h-10 w-10 items-center justify-center rounded-xl bg-[#EFF4FF] text-lg">
              🪑
            </span>
            <div>
              <p className="font-heading text-[18px] font-bold text-[#1F2937]">
                <span className="me-1 inline-block h-2 w-2 rounded-full bg-[#10B981] align-middle" />
                {t('table')} #{session.tableCode}
              </p>
              <p className="text-xs text-[#6B7280]">
                {session.restaurantName}
                {session.restaurantAddress ? ` · ${session.restaurantAddress}` : ''}
              </p>
            </div>
          </div>
          <span className="rounded-full bg-[#D1FAE5] px-2.5 py-1 text-[11px] font-semibold text-[#065F46]">
            {t('dine_in')}
          </span>
        </div>

        {/* Order items */}
        <div className="flex items-center justify-between">
          <h2 className="font-heading text-[18px] font-bold text-[#1F2937]">
            {t('order_items')} ({cart.lines.length})
          </h2>
          <span className="flex items-center gap-1 text-xs font-semibold text-[#FF6B4A]">🍴 {t('freshly_prepared')}</span>
        </div>

        <ul className="flex flex-col gap-3">
          {cart.lines.map((line) => (
            <li key={line.item.id} className="flex gap-3 rounded-xl bg-white p-3 shadow-sm">
              <div className="h-16 w-16 shrink-0 overflow-hidden rounded-xl bg-[#FFF5F2]">
                {line.item.imageUrl ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={line.item.imageUrl} alt={line.item.name} className="h-full w-full object-cover" />
                ) : (
                  <span className="flex h-full w-full items-center justify-center text-xl text-[#FF6B4A]/50">🍽️</span>
                )}
              </div>

              <div className="flex min-w-0 flex-1 flex-col">
                <div className="flex items-start justify-between gap-2">
                  <h3 className="font-heading text-[15px] font-semibold text-[#1F2937]">{line.item.name}</h3>
                  <button
                    type="button"
                    onClick={() => cart.removeItem(line.item.id)}
                    disabled={locked}
                    aria-label={`Remove ${line.item.name}`}
                    className="text-[#BA1A1A] disabled:opacity-40"
                  >
                    <span aria-hidden>🗑</span>
                  </button>
                </div>
                <p className="text-xs text-[#6B7280]">
                  {formatMoney(line.item.priceFils, session.currency)} {t('each')}
                </p>

                <div className="mt-auto flex items-center justify-between pt-2">
                  <span className="font-heading text-[15px] font-bold text-[#FF6B4A]">
                    {formatMoney(line.item.priceFils * line.qty, session.currency)}
                  </span>
                  <div className="flex items-center rounded-full border border-[#E5E7EB] bg-white">
                    <button
                      type="button"
                      onClick={() => cart.updateQty(line.item.id, line.qty - 1)}
                      disabled={locked}
                      aria-label={`Decrease ${line.item.name}`}
                      className="flex h-9 w-9 items-center justify-center text-lg font-semibold text-[#1F2937] disabled:opacity-40"
                    >
                      −
                    </button>
                    <span className="w-6 text-center text-sm font-bold text-[#1F2937]" aria-live="polite">
                      {line.qty}
                    </span>
                    <button
                      type="button"
                      onClick={() => cart.updateQty(line.item.id, line.qty + 1)}
                      disabled={locked}
                      aria-label={`Increase ${line.item.name}`}
                      className="flex h-9 w-9 items-center justify-center rounded-full bg-[#FF6B4A] text-lg font-semibold text-white disabled:opacity-40"
                    >
                      +
                    </button>
                  </div>
                </div>
              </div>
            </li>
          ))}
        </ul>

        {/* Kitchen notes */}
        <div className="rounded-xl bg-white p-4 shadow-sm">
          <h2 className="flex items-center gap-1.5 font-heading text-[15px] font-bold text-[#1F2937]">
            ✏️ {t('kitchen_notes')}
          </h2>
          <textarea
            rows={2}
            value={cart.note}
            onChange={(e) => cart.setNote(e.target.value.slice(0, MAX_NOTE_CHARS))}
            disabled={locked}
            placeholder={t('kitchen_notes_ph')}
            className="mt-2 w-full resize-none rounded-xl bg-[#EFF4FF] p-3 text-sm text-[#1F2937] placeholder:text-[#9CA3AF] disabled:opacity-60"
          />
          <p className="mt-1 flex items-center justify-between text-[11px] text-[#9CA3AF]">
            <span>ⓘ {t('kitchen_notes_hint')}</span>
            <span aria-live="polite">{noteRemaining}</span>
          </p>
          <input
            value={guestName}
            onChange={(e) => setGuestName(e.target.value.slice(0, MAX_GUEST_NAME))}
            disabled={locked}
            placeholder={t('table') + ' name (optional)'}
            autoComplete="name"
            className="mt-2 h-10 w-full rounded-xl border border-[#E5E7EB] bg-white px-3 text-sm text-[#1F2937] placeholder:text-[#9CA3AF] disabled:opacity-60"
          />
        </div>

        {/* Bill summary */}
        <div className="rounded-xl bg-white p-4 shadow-sm">
          <div className="flex items-center justify-between">
            <h2 className="font-heading text-[18px] font-bold text-[#1F2937]">{t('bill_summary')}</h2>
            <span className="rounded-full bg-[#EFF4FF] px-2 py-0.5 text-[10px] font-semibold text-[#0F5257]">
              {t('tax_compliant')}
            </span>
          </div>
          <dl className="mt-3 space-y-2 text-sm">
            <div className="flex justify-between text-[#6B7280]">
              <dt>{t('items_subtotal')}</dt>
              <dd>{formatMoney(grossFils, session.currency)}</dd>
            </div>
            <div className="flex justify-between text-[#6B7280]">
              <dt>
                {t('vat')} ({vatPct}% {t('incl')})
              </dt>
              <dd>{formatMoney(vatFils, session.currency)}</dd>
            </div>
            <div className="flex justify-between text-[#6B7280]">
              <dt>{t('service_charge')}</dt>
              <dd className="font-semibold text-[#10B981]">{formatMoney(0, session.currency)} ({t('free')})</dd>
            </div>
          </dl>
          <div className="mt-3 flex items-end justify-between border-t border-[#E5E7EB] pt-3">
            <div>
              <p className="font-heading text-[18px] font-bold text-[#1F2937]">{t('total_amount')}</p>
              <p className="text-[11px] text-[#9CA3AF]">{t('incl_all_taxes')}</p>
            </div>
            <p className="font-heading text-[22px] font-extrabold text-[#FF6B4A]">
              {formatMoney(grossFils, session.currency)}
            </p>
          </div>
        </div>

        {submitState.status === 'rejected' ? (
          <p role="alert" className="rounded-xl border border-[#BA1A1A]/30 bg-[#FFDAD6]/40 p-3 text-sm text-[#7A1E22]">
            {submitState.message}
          </p>
        ) : null}
      </main>

      {/* Place order bar */}
      <div
        className="fixed inset-x-0 bottom-0 z-30 mx-auto max-w-[480px] px-4"
        style={{ paddingBottom: 'env(safe-area-inset-bottom)' }}
      >
        <button
          type="button"
          onClick={handleSubmit}
          disabled={locked || !session.authReady}
          className="my-3 flex h-14 w-full items-center justify-between rounded-full bg-[#FF6B4A] px-5 text-base font-bold text-white active:scale-[0.98] disabled:opacity-60"
        >
          <span className="flex items-center gap-2">
            {locked ? (
              <span className="h-4 w-4 animate-spin rounded-full border-2 border-white/40 border-t-white" />
            ) : (
              <span aria-hidden>⚡</span>
            )}
            {t('place_order')}
          </span>
          <span className="flex items-center gap-1">
            {formatMoney(grossFils, session.currency)}
            <span aria-hidden>{dir === 'rtl' ? '←' : '→'}</span>
          </span>
        </button>
        <p className="pb-2 text-center text-[11px] text-[#6B7280]">● {t('sent_to_kds')}</p>
      </div>
    </div>
  );
}
