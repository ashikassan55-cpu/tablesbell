'use client';

/**
 * src/components/ops/kds-nav-tabs.tsx
 *
 * Shared between `kds/page.tsx` and `kds/stock/page.tsx` — rendered
 * independently by each, not hosted in a shared layout. Unlike
 * `CartProvider`'s move to `layout.tsx` earlier in this build, there is
 * no state here to lose on navigation: this is stateless chrome, so
 * duplicating its render (importing the same component twice) carries
 * none of the correctness risk that motivated that earlier fix.
 * Building a full `(console)/[tenantSlug]/layout.tsx` — which would also
 * need to make decisions about presence, audio unlock, and shift context
 * (ARCHITECTURE.md §7.2) — stays out of scope for this task; this small,
 * focused component is what "seamless toggling" actually requires.
 *
 * Not shown on `kds/[orderId]/page.tsx`: that screen is a drill-down from
 * the queue, not a peer of it, and keeps its own back-arrow pattern
 * instead.
 */

import Link from 'next/link';
import { usePathname } from 'next/navigation';

interface KdsNavTabsProps {
  tenantSlug: string;
}

export function KdsNavTabs({ tenantSlug }: KdsNavTabsProps) {
  const pathname = usePathname();
  const isStock = pathname?.endsWith('/kds/stock');

  return (
    <nav aria-label="KDS screens" className="flex gap-2 border-b border-[#25324A] bg-[#0F1826] px-4 py-2">
      <Link
        href={`/${tenantSlug}/kds`}
        aria-current={!isStock ? 'page' : undefined}
        className={[
          'flex h-10 items-center rounded-lg px-4 text-sm font-semibold transition-colors',
          !isStock ? 'bg-[#14B8A6] text-[#04201C]' : 'text-[#94A3B8]',
        ].join(' ')}
      >
        Ticket Queue
      </Link>
      <Link
        href={`/${tenantSlug}/kds/stock`}
        aria-current={isStock ? 'page' : undefined}
        className={[
          'flex h-10 items-center rounded-lg px-4 text-sm font-semibold transition-colors',
          isStock ? 'bg-[#14B8A6] text-[#04201C]' : 'text-[#94A3B8]',
        ].join(' ')}
      >
        Stock Board
      </Link>
    </nav>
  );
}
