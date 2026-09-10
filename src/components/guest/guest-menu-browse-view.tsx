'use client';

/**
 * src/components/guest/guest-menu-browse-view.tsx
 *
 * Screen 2 of the Stitch "TableBells Guest Ordering" flow — the full
 * per-category menu. Sticky blurred header (brand + Table pill + EN/عربي)
 * over a scrollable category chip row, one section per category of
 * `<MenuItemCard>`, a floating cart bar, and the Menu / My Bill / Service
 * bottom nav.
 *
 * Bilingual + RTL via `useGuestLocale`; live menu via `useLiveMenu`.
 */

import Link from 'next/link';
import { useEffect, useMemo, useState } from 'react';
import { useGuestSession } from '@/components/providers/guest-session-provider';
import { useGuestLocale } from '@/components/providers/guest-locale-provider';
import { useLiveMenu } from '@/hooks/use-live-menu';
import { useCart } from '@/components/providers/cart-provider';
import { MenuItemCard } from './menu-item-card';
import { formatMoney } from '@/lib/format/money';

function StatusShell({ message }: { message: string }) {
  return (
    <div className="flex min-h-dvh flex-col items-center justify-center bg-[#FAF9F6] px-6 text-center">
      <p className="text-sm font-medium text-[#6B7280]">{message}</p>
    </div>
  );
}

export function GuestMenuBrowseView({ slug }: { slug: string }) {
  const session = useGuestSession();
  const { t, locale, toggle, dir } = useGuestLocale();
  const menu = useLiveMenu(session.tenantId, session.branchId, session.menuVersion, session.authReady);
  const { itemCount, totalFils } = useCart();
  const [activeCat, setActiveCat] = useState<string>('all');

  // Honour a "#cat-<id>" hash handed over by the landing's category strip.
  useEffect(() => {
    const hash = window.location.hash;
    if (hash.startsWith('#cat-')) setActiveCat(hash.slice(5));
  }, []);

  const kitchenOk = session.kitchenStatus === 'live';
  const kitchenLabel =
    session.kitchenStatus === 'closed'
      ? t('kitchen_closed')
      : session.kitchenStatus === 'busy'
        ? t('kitchen_busy')
        : t('kitchen_live');

  const shownCategories = useMemo(() => {
    if (menu.status !== 'ready') return [];
    return activeCat === 'all'
      ? menu.categories
      : menu.categories.filter((c) => c.id === activeCat);
  }, [menu, activeCat]);

  if (session.authError) return <StatusShell message={t('session_error')} />;
  if (!session.authReady || menu.status === 'loading') return <StatusShell message={t('loading_menu')} />;
  if (menu.status === 'error') return <StatusShell message={t('menu_unavailable')} />;

  return (
    <div dir={dir} className="flex min-h-dvh flex-col bg-[#FAF9F6] pb-44 font-body">
      {/* Sticky header + chips */}
      <div className="sticky top-0 z-20 border-b border-[#E5E7EB] bg-white/90 backdrop-blur">
        <header className="flex items-center justify-between gap-2 px-4 py-3">
          <div className="flex min-w-0 items-center gap-2">
            <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-[#FF6B4A] text-xs font-bold text-white">
              TB
            </span>
            <h1 className="truncate font-heading text-[16px] font-bold text-[#1F2937]">
              {session.restaurantName}
            </h1>
          </div>
          <div className="flex shrink-0 items-center gap-2">
            <span className="flex items-center gap-1 rounded-full bg-[#D1FAE5] px-2 py-1 text-[10px] font-semibold text-[#065F46]">
              <span className="h-1.5 w-1.5 rounded-full bg-[#10B981]" />
              {t('table')} #{session.tableCode}
            </span>
            <button
              type="button"
              onClick={toggle}
              className="flex items-center gap-1 rounded-full bg-[#EFF4FF] px-2 py-1 text-[11px] active:scale-95"
            >
              <span className={locale === 'en' ? 'font-bold text-[#FF6B4A]' : 'text-[#6B7280]'}>EN</span>
              <span className="text-[#D1D5DB]">|</span>
              <span className={locale === 'ar' ? 'font-bold text-[#FF6B4A]' : 'text-[#6B7280]'}>عربي</span>
            </button>
          </div>
        </header>

        <nav className="flex gap-2 overflow-x-auto px-4 pb-2" aria-label="Menu categories">
          <button
            type="button"
            onClick={() => setActiveCat('all')}
            className={`shrink-0 rounded-full px-4 py-2 text-[13px] font-semibold transition-colors ${
              activeCat === 'all' ? 'bg-[#FF6B4A] text-white' : 'bg-white text-[#6B7280] shadow-sm'
            }`}
          >
            {t('all')}
          </button>
          {menu.categories.map((c) => (
            <button
              key={c.id}
              type="button"
              onClick={() => setActiveCat(c.id)}
              className={`shrink-0 rounded-full px-4 py-2 text-[13px] font-semibold transition-colors ${
                activeCat === c.id ? 'bg-[#FF6B4A] text-white' : 'bg-white text-[#6B7280] shadow-sm'
              }`}
            >
              {c.label}
            </button>
          ))}
        </nav>
      </div>

      {/* Sections */}
      <main className="flex-1 space-y-6 px-4 py-4">
        {shownCategories.map((category) => {
          const items = menu.items.filter((i) => i.categoryId === category.id);
          if (items.length === 0) return null;
          return (
            <section key={category.id} id={`cat-${category.id}`} aria-labelledby={`h-${category.id}`}>
              <div className="mb-2 flex items-center justify-between gap-2">
                <h2 id={`h-${category.id}`} className="font-heading text-[20px] font-bold text-[#1F2937]">
                  {category.label}{' '}
                  <span className="text-sm font-medium text-[#9CA3AF]">
                    ({items.length} {items.length === 1 ? t('item') : t('items')})
                  </span>
                </h2>
                <span
                  className={`shrink-0 rounded-full px-2 py-1 text-[10px] font-semibold ${
                    kitchenOk ? 'bg-[#D1FAE5] text-[#065F46]' : 'bg-[#FEF3C7] text-[#92400E]'
                  }`}
                >
                  {kitchenLabel}
                </span>
              </div>
              <ul className="flex flex-col gap-3">
                {items.map((item) => (
                  <MenuItemCard key={item.id} item={item} />
                ))}
              </ul>
            </section>
          );
        })}
        {menu.items.length === 0 ? (
          <p className="px-1 text-sm text-[#6B7280]">{t('nothing_available')}</p>
        ) : null}
      </main>

      {/* Floating cart bar + bottom nav */}
      <div className="fixed inset-x-0 bottom-0 z-40 mx-auto max-w-[480px]">
        {itemCount > 0 ? (
          <Link
            href={`/t/${slug}/cart`}
            className="mx-4 mb-2 flex items-center justify-between rounded-full bg-[#FF6B4A] px-4 py-3 text-white shadow-xl active:scale-[0.98]"
          >
            <span className="flex items-center gap-2 text-sm font-semibold">
              <span aria-hidden>🛍️</span>
              <span className="flex flex-col leading-tight">
                <span>
                  {itemCount} {itemCount === 1 ? t('item') : t('items')}
                </span>
                <span className="text-[11px] font-normal text-white/85">
                  {t('table')} #{session.tableCode}
                </span>
              </span>
            </span>
            <span className="flex items-center gap-2 text-sm font-bold">
              {formatMoney(totalFils, session.currency)}
              <span className="font-semibold">
                {t('view_cart')} <span aria-hidden>{dir === 'rtl' ? '←' : '→'}</span>
              </span>
            </span>
          </Link>
        ) : null}

        <nav className="flex items-stretch border-t border-[#E5E7EB] bg-white pb-[env(safe-area-inset-bottom)]">
          <span className="flex flex-1 flex-col items-center gap-0.5 py-2 text-[11px] font-semibold text-[#FF6B4A]">
            <span aria-hidden>🍽️</span>
            {t('menu')}
          </span>
          <Link
            href={`/t/${slug}/cart`}
            className="flex flex-1 flex-col items-center gap-0.5 py-2 text-[11px] font-medium text-[#6B7280]"
          >
            <span aria-hidden>🧾</span>
            {t('my_bill')}
          </Link>
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
