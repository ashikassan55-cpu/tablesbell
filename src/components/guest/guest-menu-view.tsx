'use client';

/**
 * src/components/guest/guest-menu-view.tsx
 *
 * The live-data replacement for what used to be rendered directly inside
 * `app/(guest)/t/[slug]/page.tsx`. Moved into its own client component
 * for a structural reason, not a style preference: a live Firestore
 * listener has a loading/ready/error lifecycle that only exists in the
 * browser, and `page.tsx` is a Server Component -- it cannot itself hold
 * that state. `page.tsx` now does exactly the parts that genuinely have
 * to run server-side (slug resolution, the session-boot chain, minting
 * a custom token) and renders this component once it has something to
 * hand it; everything below reacts to `useGuestSession()` /
 * `useLiveMenu()` instead of receiving a static array as a prop.
 *
 * MARKUP HERE IS A DIRECT PORT of the old `page.tsx`'s JSX -- same
 * classes, same structure, same raw Tailwind hex (still un-tokenized;
 * MEMORY.md §2 step 2 is what closes that, across all three surfaces at
 * once, not here). Nothing about the visual design changed in this pass;
 * only where the data displayed comes from did.
 *
 * `RESTAURANT.name`/`.address` are STILL HARDCODED, named here rather
 * than silently carried forward: neither `checkGuestBoot` nor
 * `resolveGuestSession` resolves a tenant/branch display name today, so
 * there is no live value to put here yet. A real fix reads
 * `tenants/{t}.displayName` / `branches/{b}.displayName` -- not
 * attempted in this pass since it wasn't part of the session-boot chain
 * this task scoped.
 */

import { useGuestSession } from '@/components/providers/guest-session-provider';
import { useLiveMenu } from '@/hooks/use-live-menu';
import { MenuItemCard } from './menu-item-card';
import { CartBar } from './cart-bar';

const RESTAURANT = {
  name: 'Alserkal Specialty Roastery',
  address: 'Warehouse 48, Al Quoz 1',
  statusLabel: 'Kitchen Live & Ready',
};

function GuestStatusShell({ message }: { message: string }) {
  return (
    <div className="flex min-h-dvh flex-col items-center justify-center bg-[#FAF9F6] px-6 text-center">
      <p className="text-sm font-medium text-[#6B7280]">{message}</p>
    </div>
  );
}

export function GuestMenuView(_props: { slug?: string } = {}) {
  const session = useGuestSession();
  const menu = useLiveMenu(session.tenantId, session.branchId, session.menuVersion, session.authReady);

  if (session.authError) {
    return <GuestStatusShell message="We couldn't verify your session. Please rescan the table QR code." />;
  }

  if (!session.authReady || menu.status === 'loading') {
    return <GuestStatusShell message="Loading the menu…" />;
  }

  if (menu.status === 'error') {
    return <GuestStatusShell message="The menu isn't available right now. Please try again shortly." />;
  }

  return (
    <div className="flex min-h-dvh flex-col bg-[#FAF9F6] pb-32">
      <div className="sticky top-0 z-20 bg-white/90 backdrop-blur">
        <header className="border-b border-[#E5E7EB] px-4 py-3">
          <div className="flex items-center justify-between gap-3">
            <div className="min-w-0">
              <h1 className="truncate text-lg font-semibold text-[#1F2937]">{RESTAURANT.name}</h1>
              <p className="truncate text-xs text-[#6B7280]">{RESTAURANT.address}</p>
            </div>

            <div className="ms-3 shrink-0 rounded-full bg-[#FFF5F2] px-3 py-1.5 text-end">
              <p className="text-[11px] font-semibold uppercase tracking-wide text-[#E85D3F]">{session.tableCode}</p>
              <p className="text-[10px] text-[#6B7280]">{session.zoneId}</p>
            </div>
          </div>

          <p className="mt-1.5 flex items-center gap-1.5 text-[11px] font-medium text-[#10B981]">
            <span className="h-1.5 w-1.5 rounded-full bg-[#10B981]" aria-hidden="true" />
            {RESTAURANT.statusLabel}
          </p>
        </header>

        {/*
          Sticky category row -- still non-interactive visual scaffolding
          only, exactly as the original page.tsx left it. `label` is a
          raw category id today (see this file header's link to
          use-live-menu.ts's own note on why) -- not styled differently
          to hide that; it should look plain until it has a real label to
          show.
        */}
        <nav aria-label="Menu categories" className="flex gap-2 overflow-x-auto border-b border-[#E5E7EB] px-4 py-2">
          {menu.categories.map((category) => (
            <span
              key={category.id}
              className="shrink-0 rounded-full border border-[#E5E7EB] bg-white px-3 py-1.5 text-xs font-medium text-[#1F2937]"
            >
              {category.label}
            </span>
          ))}
        </nav>
      </div>

      <main className="flex-1 space-y-6 px-4 py-4">
        {menu.categories.map((category) => {
          const items = menu.items.filter((item) => item.categoryId === category.id);
          if (items.length === 0) return null;

          return (
            <section key={category.id} aria-labelledby={`category-${category.id}`}>
              <h2 id={`category-${category.id}`} className="mb-2 text-sm font-semibold text-[#1F2937]">
                {category.label}
              </h2>
              <ul className="flex flex-col gap-2">
                {items.map((item) => (
                  <MenuItemCard key={item.id} item={item} />
                ))}
              </ul>
            </section>
          );
        })}

        {menu.items.length === 0 ? (
          <p className="px-1 text-sm text-[#6B7280]">Nothing is available on the menu right now.</p>
        ) : null}
      </main>

      <CartBar tableCode={session.tableCode} />
    </div>
  );
}
