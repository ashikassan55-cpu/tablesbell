'use client';

/**
 * src/components/guest/order-tracker-view.tsx
 *
 * Screen 4 of the Stitch "TableBells Guest Ordering" flow — order
 * confirmation + live prep tracker.
 *
 * Two live listeners, run in sequence:
 *   1. `orderRequests/{r}` (the id the cart hands over) — while `pending`
 *      the screen shows "Order Received — awaiting kitchen"; on `priced`
 *      it reads `orderId` and hands off to (2); on `rejected` it shows a
 *      guest-safe message.
 *   2. `orders/{orderId}` — drives the Order Received → Preparing Now →
 *      Serving timeline from `order.status` (`new`/`prep`/`ready`/`served`).
 *
 * Both reads are permitted by `firestore.rules` for the party's own
 * session. If the URL already carries `?o=<orderId>` (e.g. returning here
 * after "Add More") listener (1) is skipped.
 *
 * NOTE: `priceOrderRequest` (the Cloud Function that turns an
 * `orderRequests` doc into a priced `Order`) is not deployed in this
 * repo yet — until it is, a placed order stays at step 1 here. That is
 * the honest state, not a broken spinner.
 */

import Link from 'next/link';
import { useEffect, useMemo, useState } from 'react';
import { doc, onSnapshot, type FirestoreError } from 'firebase/firestore';
import { db } from '@/lib/firebase/client';
import { useGuestSession } from '@/components/providers/guest-session-provider';
import { useGuestLocale } from '@/components/providers/guest-locale-provider';
import { useLiveMenu } from '@/hooks/use-live-menu';
import { useCart } from '@/components/providers/cart-provider';
import { useServiceCall } from './use-service-call';
import { formatMoney } from '@/lib/format/money';
import type { Order, OrderRequest, OrderStatus, ServiceCallType } from '@/types/firestore';

type Phase =
  | { kind: 'loading' }
  | { kind: 'pending' }
  | { kind: 'rejected' }
  | { kind: 'tracking'; order: Order & { id: string } };

function vatSplit(grossFils: number, vatPpm: number) {
  if (vatPpm <= 0) return { netFils: grossFils, vatFils: 0 };
  const netFils = Math.round((grossFils * 1_000_000) / (1_000_000 + vatPpm));
  return { netFils, vatFils: grossFils - netFils };
}

const STEP_INDEX: Record<OrderStatus, number> = { new: 0, prep: 1, ready: 2, served: 3, voided: 0 };

export function OrderTrackerView({
  slug,
  requestId,
  orderId,
}: {
  slug: string;
  requestId: string | null;
  orderId: string | null;
}) {
  const session = useGuestSession();
  const { t, locale, toggle, dir } = useGuestLocale();
  const menu = useLiveMenu(session.tenantId, session.branchId, session.menuVersion, session.authReady);
  const cart = useCart();
  const svc = useServiceCall();

  const [phase, setPhase] = useState<Phase>({ kind: 'loading' });
  const [resolvedOrderId, setResolvedOrderId] = useState<string | null>(orderId);

  const base = `tenants/${session.tenantId}/branches/${session.branchId}`;

  // Listener 1 — the orderRequest, unless we already have an order id.
  useEffect(() => {
    if (!session.authReady) return;
    if (orderId) {
      setResolvedOrderId(orderId);
      return;
    }
    if (!requestId) {
      setPhase({ kind: 'rejected' });
      return;
    }
    const unsub = onSnapshot(
      doc(db, `${base}/orderRequests/${requestId}`),
      (snap) => {
        const data = snap.data() as OrderRequest | undefined;
        if (!data) return;
        if (data.status === 'pending') {
          setPhase((p) => (p.kind === 'tracking' ? p : { kind: 'pending' }));
        } else if (data.status === 'priced' || data.status === 'duplicate') {
          if (data.orderId) setResolvedOrderId(data.orderId);
        } else if (data.status === 'rejected') {
          setPhase({ kind: 'rejected' });
        }
      },
      (_e: FirestoreError) => setPhase({ kind: 'rejected' }),
    );
    return unsub;
  }, [session.authReady, base, requestId, orderId]);

  // Listener 2 — the priced order.
  useEffect(() => {
    if (!session.authReady || !resolvedOrderId) return;
    const unsub = onSnapshot(
      doc(db, `${base}/orders/${resolvedOrderId}`),
      (snap) => {
        const data = snap.data() as Order | undefined;
        if (!data) return;
        setPhase({ kind: 'tracking', order: { ...data, id: snap.id } });
        cart.clearCart();
      },
      (_e: FirestoreError) => {
        setPhase((p) => (p.kind === 'tracking' ? p : { kind: 'pending' }));
      },
    );
    return unsub;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [session.authReady, base, resolvedOrderId]);

  const nameById = useMemo(() => {
    const m = new Map<string, string>();
    if (menu.status === 'ready') for (const it of menu.items) m.set(it.id, it.name);
    return m;
  }, [menu]);

  // Summary lines: prefer the priced order, fall back to the cart while pending.
  const summaryLines =
    phase.kind === 'tracking'
      ? phase.order.items
          .filter((l) => l.status === 'active')
          .map((l) => ({ name: l.nameSnapshot.en, qty: l.qty, fils: l.lineTotalFils }))
      : cart.lines.map((l) => ({
          name: nameById.get(l.item.id) ?? l.item.name,
          qty: l.qty,
          fils: l.item.priceFils * l.qty,
        }));
  const grossFils =
    phase.kind === 'tracking' ? phase.order.grossFils : summaryLines.reduce((s, l) => s + l.fils, 0);
  const { vatFils } = vatSplit(grossFils, session.vatPpm);
  const vatPct = Math.round((session.vatPpm / 10_000) * 100) / 100;

  const step = phase.kind === 'tracking' ? STEP_INDEX[phase.order.status] : 0;
  const confirmed = phase.kind === 'tracking' && phase.order.status !== 'new';

  if (!session.authReady || phase.kind === 'loading') {
    return (
      <div className="flex min-h-dvh items-center justify-center bg-[#FAF9F6] px-6 text-center">
        <p className="text-sm text-[#6B7280]">{t('loading_menu')}</p>
      </div>
    );
  }

  if (phase.kind === 'rejected') {
    return (
      <div dir={dir} className="flex min-h-dvh flex-col items-center justify-center gap-3 bg-[#FAF9F6] px-6 text-center font-body">
        <p aria-hidden className="text-4xl">😕</p>
        <p className="font-heading text-lg font-bold text-[#1F2937]">{t('request_failed')}</p>
        <Link
          href={`/t/${slug}/menu`}
          className="mt-2 flex h-12 items-center justify-center rounded-full bg-[#FF6B4A] px-6 text-sm font-semibold text-white"
        >
          {t('browse_menu')}
        </Link>
      </div>
    );
  }

  const TIMELINE = [
    { key: 'received', title: t('order_received'), sub: t('sent_to_line'), done: step >= 0, active: step === 0 && phase.kind === 'pending' },
    { key: 'preparing', title: t('preparing_now'), sub: t('preparing_sub'), done: step >= 2, active: step === 1 },
    { key: 'serving', title: t('serving'), sub: t('serving_sub'), done: step >= 3, active: step === 2 },
  ];

  const QUICK: { type: ServiceCallType; label: string }[] = [
    { type: 'water', label: t('need_water') },
    { type: 'napkins', label: t('extra_napkins') },
    { type: 'assistance', label: t('ask_question') },
  ];

  return (
    <div dir={dir} className="flex min-h-dvh flex-col bg-[#FAF9F6] pb-64 font-body">
      {/* Header */}
      <header className="sticky top-0 z-20 flex items-center justify-between gap-2 border-b border-[#E5E7EB] bg-white/90 px-4 py-3 backdrop-blur">
        <div className="flex min-w-0 items-center gap-2">
          <span className="flex h-7 w-7 items-center justify-center rounded-lg bg-[#FF6B4A] text-[10px] font-bold text-white">
            TB
          </span>
          <h1 className="truncate font-heading text-[15px] font-bold text-[#1F2937]">{session.restaurantName}</h1>
        </div>
        <div className="flex shrink-0 items-center gap-2">
          <span className="flex items-center gap-1 rounded-full bg-[#D1FAE5] px-2 py-1 text-[10px] font-semibold text-[#065F46]">
            <span className="h-1.5 w-1.5 rounded-full bg-[#10B981]" />
            {t('table')} #{session.tableCode}
          </span>
          <button type="button" onClick={toggle} className="rounded-full bg-[#EFF4FF] px-2 py-1 text-[11px] active:scale-95">
            <span className={locale === 'en' ? 'font-bold text-[#FF6B4A]' : 'text-[#6B7280]'}>EN</span>
            <span className="mx-1 text-[#D1D5DB]">|</span>
            <span className={locale === 'ar' ? 'font-bold text-[#FF6B4A]' : 'text-[#6B7280]'}>عربي</span>
          </button>
        </div>
      </header>

      <main className="flex-1 space-y-4 px-4 py-4">
        {/* Success card */}
        <div className="rounded-xl bg-white p-5 text-center shadow-sm">
          <div className="mx-auto flex h-16 w-16 items-center justify-center rounded-full bg-[#006C49] text-3xl text-white">
            ✓
          </div>
          <p className="mt-2 inline-flex items-center gap-1 rounded-full bg-[#D1FAE5] px-2.5 py-0.5 text-[11px] font-semibold text-[#065F46]">
            <span className="h-1.5 w-1.5 rounded-full bg-[#10B981]" />
            {confirmed ? t('confirmed_by_kitchen') : t('received_by_kitchen')}
          </p>
          <h2 className="mt-1 font-heading text-[24px] font-extrabold text-[#1F2937]">{t('order_placed')}</h2>
          {phase.kind === 'tracking' ? (
            <p className="text-xs text-[#6B7280]">
              #{phase.order.code} • {t('table')} #{session.tableCode}
            </p>
          ) : null}
          {phase.kind === 'tracking' ? (
            <div className="mt-3 flex items-center justify-between rounded-xl bg-[#EFF4FF] px-3 py-2 text-start">
              <span className="flex items-center gap-2">
                <span aria-hidden>⏳</span>
                <span className="flex flex-col">
                  <span className="text-[10px] font-bold uppercase tracking-wide text-[#6B7280]">
                    {t('est_serve_time')}
                  </span>
                  <span className="font-heading text-[16px] font-bold text-[#1F2937]">
                    {Math.max(1, Math.round((phase.order.slaTargetSec || 600) / 60) - 4)}–
                    {Math.round((phase.order.slaTargetSec || 600) / 60)} mins
                  </span>
                </span>
              </span>
              <span className="rounded-full bg-[#FFDAD2] px-2 py-0.5 text-[10px] font-semibold text-[#AE3115]">
                {t('on_track')}
              </span>
            </div>
          ) : null}
        </div>

        {/* Live preparation timeline */}
        <div className="rounded-xl bg-white p-4 shadow-sm">
          <div className="flex items-center justify-between">
            <h3 className="font-heading text-[16px] font-bold text-[#1F2937]">{t('live_preparation')}</h3>
            <span className="flex items-center gap-1 text-[11px] font-semibold text-[#10B981]">
              <span className="h-1.5 w-1.5 rounded-full bg-[#10B981]" />
              {t('live_updates')}
            </span>
          </div>
          <ol className="mt-3 space-y-4">
            {TIMELINE.map((s) => (
              <li key={s.key} className="flex gap-3">
                <span
                  className={`mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-full text-xs ${
                    s.done
                      ? 'bg-[#006C49] text-white'
                      : s.active
                        ? 'bg-[#FF6B4A] text-white'
                        : 'bg-[#E5E7EB] text-[#9CA3AF]'
                  }`}
                >
                  {s.done ? '✓' : s.active ? '•' : ''}
                </span>
                <div className="flex-1">
                  <p
                    className={`text-sm font-semibold ${
                      s.active ? 'text-[#FF6B4A]' : s.done ? 'text-[#1F2937]' : 'text-[#9CA3AF]'
                    }`}
                  >
                    {s.title}
                  </p>
                  <p className="text-xs text-[#6B7280]">{s.sub}</p>
                  {s.active && s.key === 'preparing' ? (
                    <div className="mt-1.5 h-1.5 w-full overflow-hidden rounded-full bg-[#EFF4FF]">
                      <div className="h-full w-2/3 rounded-full bg-[#FF6B4A]" />
                    </div>
                  ) : null}
                </div>
              </li>
            ))}
          </ol>
        </div>

        {/* Order summary */}
        {summaryLines.length > 0 ? (
          <div className="rounded-xl bg-white p-4 shadow-sm">
            <div className="flex items-center justify-between">
              <h3 className="font-heading text-[16px] font-bold text-[#1F2937]">{t('order_summary')}</h3>
              <span className="font-heading text-[15px] font-bold text-[#1F2937]">
                {formatMoney(grossFils, session.currency)}
              </span>
            </div>
            <ul className="mt-3 space-y-2">
              {summaryLines.map((l, i) => (
                <li key={i} className="flex items-center justify-between text-sm">
                  <span className="text-[#1F2937]">
                    <span className="me-1 font-bold text-[#6B7280]">{l.qty}x</span>
                    {l.name}
                  </span>
                  <span className="text-[#6B7280]">{formatMoney(l.fils, session.currency)}</span>
                </li>
              ))}
            </ul>
            <dl className="mt-3 space-y-1 border-t border-[#E5E7EB] pt-3 text-xs text-[#6B7280]">
              <div className="flex justify-between">
                <dt>
                  {t('vat')} ({vatPct}%)
                </dt>
                <dd>{formatMoney(vatFils, session.currency)}</dd>
              </div>
              <div className="flex justify-between font-heading text-[15px] font-bold text-[#1F2937]">
                <dt>{t('total_paid')}</dt>
                <dd className="text-[#FF6B4A]">{formatMoney(grossFils, session.currency)}</dd>
              </div>
            </dl>
          </div>
        ) : null}

        {/* Need anything else? */}
        <div className="rounded-xl bg-white p-4 shadow-sm">
          <h3 className="flex items-center gap-1.5 font-heading text-[16px] font-bold text-[#1F2937]">
            🛎️ {t('need_anything')}
          </h3>
          <p className="text-xs text-[#6B7280]">{t('tap_for_dispatch')}</p>
          <div className="mt-3 flex flex-wrap gap-2">
            {QUICK.map((q) => (
              <button
                key={q.type}
                type="button"
                disabled={svc.status === 'sending'}
                onClick={() => svc.send(q.type)}
                className="rounded-full border border-[#E5E7EB] bg-white px-3 py-2 text-xs font-semibold text-[#1F2937] active:scale-95 disabled:opacity-60"
              >
                {q.label}
              </button>
            ))}
          </div>
          <button
            type="button"
            disabled={svc.status === 'sending'}
            onClick={() => svc.send('waiter')}
            className="mt-2 flex h-11 w-full items-center justify-center gap-2 rounded-xl bg-[#EFF4FF] text-sm font-semibold text-[#1F2937] active:scale-[0.98] disabled:opacity-60"
          >
            🔔 {t('call_server_to_table')}
          </button>
          {svc.status === 'sent' ? (
            <p className="mt-2 text-center text-xs font-semibold text-[#10B981]">{t('request_sent')}</p>
          ) : svc.status === 'error' ? (
            <p className="mt-2 text-center text-xs font-semibold text-[#BA1A1A]">{t('request_failed')}</p>
          ) : null}
        </div>
      </main>

      {/* Add more + bottom nav */}
      <div className="fixed inset-x-0 bottom-0 z-40 mx-auto max-w-[480px]">
        <Link
          href={`/t/${slug}/menu`}
          className="mx-4 mb-2 flex h-12 items-center justify-center gap-2 rounded-full bg-[#AE3115] text-sm font-bold text-white shadow-xl active:scale-[0.98]"
        >
          ⊕ {t('add_more_to')} {t('table')} #{session.tableCode}
        </Link>
        <p className="pb-1 text-center text-[11px] text-[#9CA3AF]">{t('add_more_hint')}</p>
        <nav className="flex items-stretch border-t border-[#E5E7EB] bg-white pb-[env(safe-area-inset-bottom)]">
          <Link
            href={`/t/${slug}/menu`}
            className="flex flex-1 flex-col items-center gap-0.5 py-2 text-[11px] font-medium text-[#6B7280]"
          >
            <span aria-hidden>🍽️</span>
            {t('menu')}
          </Link>
          <span className="flex flex-1 flex-col items-center gap-0.5 py-2 text-[11px] font-semibold text-[#FF6B4A]">
            <span aria-hidden>🧾</span>
            {t('my_bill')}
          </span>
          <Link
            href={`/t/${slug}`}
            className="flex flex-1 flex-col items-center gap-0.5 py-2 text-[11px] font-medium text-[#6B7280]"
          >
            <span aria-hidden>🔔</span>
            {t('service')}
          </Link>
        </nav>
      </div>
    </div>
  );
}
