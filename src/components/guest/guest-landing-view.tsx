'use client';

/**
 * src/components/guest/guest-landing-view.tsx
 *
 * Screen 1 of the Stitch "TableBells Guest Ordering" flow — what a guest
 * sees the moment they scan the table QR: café identity + hero, guest
 * Wi-Fi tap-to-copy, the three Instant Service Triggers (Call Waiter /
 * Free Water / Wipes & Set), a category strip that jumps into the full
 * menu, Chef's Highlights, and the floating Ring Service Bell bar.
 *
 * Service triggers + the bell write a real `serviceCalls` doc
 * (`useServiceCall`) that surfaces live in the Cashier "Alerts & Pagers"
 * tab. Bilingual + RTL via `useGuestLocale`.
 */

import Link from 'next/link';
import { useState } from 'react';
import { useGuestSession } from '@/components/providers/guest-session-provider';
import { useGuestLocale } from '@/components/providers/guest-locale-provider';
import { useLiveMenu } from '@/hooks/use-live-menu';
import { useCart } from '@/components/providers/cart-provider';
import { useServiceCall } from './use-service-call';
import { CartBar } from './cart-bar';
import { formatMoney } from '@/lib/format/money';
import type { ServiceCallType } from '@/types/firestore';

function GuestStatusShell({ message }: { message: string }) {
  return (
    <div className="flex min-h-dvh flex-col items-center justify-center bg-[#FAF9F6] px-6 text-center">
      <p className="text-sm font-medium text-[#6B7280]">{message}</p>
    </div>
  );
}

export function GuestLandingView({ slug }: { slug: string }) {
  const session = useGuestSession();
  const { t, locale, toggle, dir } = useGuestLocale();
  const menu = useLiveMenu(session.tenantId, session.branchId, session.menuVersion, session.authReady);
  const { addItem, itemCount } = useCart();
  const svc = useServiceCall();
  const [wifiCopied, setWifiCopied] = useState(false);

  if (session.authError) return <GuestStatusShell message={t('session_error')} />;
  if (!session.authReady) return <GuestStatusShell message={t('loading_menu')} />;

  const kitchenLabel =
    session.kitchenStatus === 'closed'
      ? t('kitchen_closed')
      : session.kitchenStatus === 'busy'
        ? t('kitchen_busy')
        : t('kitchen_live');
  const kitchenOk = session.kitchenStatus === 'live';

  const highlights = menu.status === 'ready' ? menu.items.slice(0, 3) : [];

  async function copyWifi() {
    const text = session.wifiPassword || session.wifiSsid;
    try {
      await navigator.clipboard.writeText(text);
      setWifiCopied(true);
      window.setTimeout(() => setWifiCopied(false), 2500);
    } catch {
      /* clipboard blocked — no-op */
    }
  }

  const TRIGGERS: { type: ServiceCallType; label: string; sub: string; tone: string; icon: string }[] = [
    { type: 'waiter', label: t('call_waiter'), sub: t('call_waiter_sub'), tone: 'bg-[#FFDAD2] text-[#AE3115]', icon: '🙋' },
    { type: 'water', label: t('free_water'), sub: t('free_water_sub'), tone: 'bg-[#E6EEFF] text-[#1F2937]', icon: '💧' },
    { type: 'cleanup', label: t('wipes_set'), sub: t('wipes_set_sub'), tone: 'bg-[#6CF8BB] text-[#00714D]', icon: '🍽️' },
  ];

  return (
    <div dir={dir} className="flex min-h-dvh flex-col bg-[#FAF9F6] pb-40 font-body">
      {/* Hero identity card */}
      <section className="relative mb-4 overflow-hidden rounded-b-2xl bg-white shadow-sm">
        <div
          className="relative h-44 w-full bg-cover bg-center"
          style={
            session.heroImageUrl
              ? { backgroundImage: `url("${session.heroImageUrl}")` }
              : { backgroundImage: 'linear-gradient(135deg,#FF6B4A 0%,#FFB4A3 55%,#FFDAD2 100%)' }
          }
        >
          <div className="absolute inset-0 bg-gradient-to-t from-white via-white/30 to-transparent" />
          <div className="absolute inset-x-4 top-3 flex items-center justify-between">
            <span className="flex items-center gap-1.5 rounded-full bg-white/90 px-3 py-1 text-[11px] font-semibold text-[#1F2937] shadow-sm backdrop-blur">
              <span className={`h-2 w-2 rounded-full ${kitchenOk ? 'animate-ping bg-[#10B981]' : 'bg-[#9CA3AF]'}`} />
              {t('table')} #{session.tableCode}
              {session.zoneId ? ` • ${session.zoneId}` : ''}
            </span>
            <button
              type="button"
              onClick={toggle}
              className="flex items-center gap-1 rounded-full bg-white/90 px-2.5 py-1 text-[11px] shadow-sm backdrop-blur active:scale-95"
            >
              <span className={locale === 'en' ? 'font-bold text-[#FF6B4A]' : 'text-[#6B7280]'}>EN</span>
              <span className="text-[#D1D5DB]">|</span>
              <span className={locale === 'ar' ? 'font-bold text-[#FF6B4A]' : 'text-[#6B7280]'}>عربي</span>
            </button>
          </div>
        </div>

        <div className="relative z-10 -mt-6 px-4 pb-4">
          <div className="flex items-center gap-1.5">
            <h1 className="font-heading text-[22px] font-bold text-[#1F2937]">{session.restaurantName}</h1>
            <span aria-hidden className="text-[#FF6B4A]">✔</span>
          </div>
          <p className="mt-0.5 flex flex-wrap items-center gap-1 text-xs text-[#6B7280]">
            {session.restaurantAddress ? <span>{session.restaurantAddress}</span> : null}
            {session.restaurantAddress ? <span>•</span> : null}
            <span className={kitchenOk ? 'font-medium text-[#10B981]' : 'font-medium text-[#B45309]'}>
              {kitchenLabel}
            </span>
          </p>

          {session.wifiSsid ? (
            <button
              type="button"
              onClick={copyWifi}
              className="mt-3 flex w-full items-center justify-between rounded-xl bg-[#EFF4FF] px-3 py-2 text-start active:bg-[#DEE9FC]"
            >
              <span className="flex items-center gap-2">
                <span aria-hidden className="text-[#FF6B4A]">📶</span>
                <span className="flex flex-col">
                  <span className="text-[11px] font-semibold text-[#1F2937]">
                    {t('guest_wifi')}: {session.wifiSsid}
                  </span>
                  <span className="text-[11px] text-[#8D716A]">
                    {wifiCopied
                      ? t('wifi_copied')
                      : session.wifiPassword
                        ? t('tap_to_copy_pw')
                        : t('no_password')}
                  </span>
                </span>
              </span>
              <span aria-hidden className="text-sm text-[#8D716A]">{wifiCopied ? '✓' : '⧉'}</span>
            </button>
          ) : null}
        </div>
      </section>

      {/* Instant Service Triggers */}
      <section className="mb-5 px-4">
        <div className="mb-2 flex items-center justify-between">
          <h2 className="text-[13px] font-semibold uppercase tracking-wide text-[#6B7280]">{t('instant_service')}</h2>
          <span className="text-xs text-[#8D716A]">{t('instant_notification')}</span>
        </div>
        <div className="grid grid-cols-3 gap-2">
          {TRIGGERS.map((trg) => (
            <button
              key={trg.type}
              type="button"
              disabled={svc.status === 'sending'}
              onClick={() => svc.send(trg.type)}
              className="flex flex-col items-center rounded-xl bg-white p-3 text-center shadow-sm transition-transform active:scale-95 disabled:opacity-60"
            >
              <span className={`mb-1.5 flex h-10 w-10 items-center justify-center rounded-full text-lg ${trg.tone}`}>
                {trg.icon}
              </span>
              <span className="text-[11px] font-semibold text-[#1F2937]">{trg.label}</span>
              <span className="text-[11px] text-[#B0A29E]">{trg.sub}</span>
            </button>
          ))}
        </div>
      </section>

      {/* Category strip → jumps into the full menu */}
      <nav className="mb-4 flex gap-2 overflow-x-auto px-4 pb-1" aria-label="Menu categories">
        <Link
          href={`/t/${slug}/menu`}
          className="shrink-0 rounded-full bg-[#FF6B4A] px-4 py-2 text-[13px] font-semibold text-white shadow-sm"
        >
          {t('all')}
        </Link>
        {(menu.status === 'ready' ? menu.categories : []).map((c) => (
          <Link
            key={c.id}
            href={`/t/${slug}/menu#cat-${c.id}`}
            className="shrink-0 rounded-full bg-white px-4 py-2 text-[13px] font-medium text-[#6B7280] shadow-sm"
          >
            {c.label}
          </Link>
        ))}
      </nav>

      {/* Chef's Highlights */}
      <section className="flex flex-col gap-3 px-4">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <span aria-hidden className="text-[#FF6B4A]">🔥</span>
            <h2 className="font-heading text-[18px] font-semibold text-[#1F2937]">{t('chefs_highlights')}</h2>
          </div>
          <span className="text-xs text-[#8D716A]">{t('dine_in_favorites')}</span>
        </div>

        {menu.status === 'loading' ? (
          <p className="rounded-xl bg-white p-4 text-center text-sm text-[#6B7280] shadow-sm">{t('loading_menu')}</p>
        ) : menu.status === 'error' || highlights.length === 0 ? (
          <p className="rounded-xl bg-white p-4 text-center text-sm text-[#6B7280] shadow-sm">
            {t('nothing_available')}
          </p>
        ) : (
          highlights.map((item) => (
            <div key={item.id} className="flex items-stretch gap-3 rounded-xl bg-white p-3.5 shadow-sm">
              <div className="flex min-w-0 flex-1 flex-col">
                <h3 className="truncate font-heading text-[16px] font-semibold text-[#1F2937]">{item.name}</h3>
                {item.description ? (
                  <p className="mt-0.5 line-clamp-2 text-xs text-[#6B7280]">{item.description}</p>
                ) : null}
                <div className="mt-2 flex items-baseline gap-1">
                  <span className="font-heading text-[20px] font-bold text-[#1F2937]">
                    {formatMoney(item.priceFils, session.currency)}
                  </span>
                  <span className="text-[11px] text-[#8D716A]">{t('incl_vat')}</span>
                </div>
              </div>
              <div className="relative h-24 w-24 shrink-0 overflow-hidden rounded-xl bg-[#FFF5F2]">
                {item.imageUrl ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={item.imageUrl} alt={item.name} className="h-full w-full object-cover" />
                ) : (
                  <span className="flex h-full w-full items-center justify-center text-2xl text-[#FF6B4A]/50">🍽️</span>
                )}
                <button
                  type="button"
                  aria-label={`${t('add')} ${item.name}`}
                  onClick={() => addItem(item)}
                  className="absolute bottom-1 right-1 flex h-8 w-8 items-center justify-center rounded-full bg-[#FF6B4A] text-lg font-semibold text-white shadow-md active:scale-90"
                >
                  +
                </button>
              </div>
            </div>
          ))
        )}
      </section>

      {/* Service guarantee footnote */}
      <div className="mx-4 mt-6 flex flex-col items-center rounded-xl bg-[#EFF4FF] p-4 text-center">
        <span className="mb-1 flex items-center gap-1 text-[11px] text-[#8D716A]">🔔 {t('direct_table_link')}</span>
        <p className="text-xs text-[#6B7280]">{t('service_guarantee')}</p>
        <span className="mt-2 text-[11px] text-[#B0A29E]">{t('powered_by')}</span>
      </div>

      {/* Bottom bars */}
      <div className="fixed inset-x-0 bottom-0 z-40 mx-auto max-w-[480px] px-4 pb-[env(safe-area-inset-bottom)]">
        {svc.status === 'sent' || svc.status === 'error' ? (
          <div className="mb-2 flex items-center gap-2 rounded-xl bg-[#27313F] px-4 py-3 text-xs text-white shadow-xl">
            <span className={`h-2 w-2 rounded-full ${svc.status === 'sent' ? 'bg-[#4EDEA3]' : 'bg-[#FFB4A3]'}`} />
            {svc.status === 'sent' ? t('request_sent') : t('request_failed')}
          </div>
        ) : null}

        {itemCount > 0 ? <div className="mb-2"><CartBar tableCode={session.tableCode} /></div> : null}

        <div className="mb-3 flex items-stretch overflow-hidden rounded-full bg-[#FF6B4A] text-white shadow-xl">
          <button
            type="button"
            disabled={svc.status === 'sending'}
            onClick={() => svc.send('waiter')}
            className="flex flex-1 items-center gap-3 px-5 py-3.5 text-start active:scale-[0.98] disabled:opacity-70"
          >
            <span aria-hidden className="flex h-10 w-10 items-center justify-center rounded-full bg-white/20 text-2xl">
              🔔
            </span>
            <span className="flex flex-col">
              <span className="font-heading text-[16px] font-bold">{t('ring_service_bell')}</span>
              <span className="text-xs text-white/90">{t('ring_bell_sub')}</span>
            </span>
          </button>
          <Link
            href={`/t/${slug}/menu`}
            className="my-2 me-2 flex items-center gap-1 self-center rounded-full bg-white/20 px-3 py-1.5 text-[11px]"
          >
            {t('table')} {session.tableCode}
            <span aria-hidden>{dir === 'rtl' ? '←' : '→'}</span>
          </Link>
        </div>
      </div>
    </div>
  );
}
