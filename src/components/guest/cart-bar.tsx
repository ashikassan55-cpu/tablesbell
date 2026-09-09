'use client';

/**
 * src/components/guest/cart-bar.tsx
 *
 * Sticky bottom action bar — guest surface, thumb-zone, safe-area aware
 * (RULES.md §3). Renders nothing until the cart holds at least one item,
 * per the requirement that it "appears when items are added."
 *
 * Uses `ps-4`/`pe-3` (logical properties), never `pl-*`/`pr-*` — this
 * component must render correctly, unmodified, under the Arabic (RTL)
 * locale (RULES.md §3, guest surface rule 6).
 */

import Link from 'next/link';
import { useCart } from '@/components/providers/cart-provider';
import { useGuestSession } from '@/components/providers/guest-session-provider';
import { formatMoney } from '@/lib/format/money';

export function CartBar({ tableCode }: { tableCode: string }) {
  const { itemCount, totalFils } = useCart();
  const { currency } = useGuestSession();

  if (itemCount === 0) return null;

  return (
    <div
      className="fixed inset-x-0 bottom-0 z-30 border-t border-[#ECE7E1] bg-white/95 backdrop-blur"
      // env(safe-area-inset-bottom) has no Tailwind utility equivalent
      // without a plugin — this is the one genuinely computed/platform
      // value this component needs, per RULES.md §1.5's stated exception.
      style={{ paddingBottom: 'env(safe-area-inset-bottom)' }}
    >
      {/*
        NOTE: this links to ./cart, the route ARCHITECTURE.md §7.2 names
        as app/(guest)/t/[slug]/cart/page.tsx — not yet built (it's the
        next item in MEMORY.md's "Active Next" scope). This link will 404
        until that page exists; the target path itself is correct.
      */}
      <Link
        href="./cart"
        className="mx-4 my-3 flex h-14 items-center justify-between rounded-xl bg-[#E85D3F] ps-4 pe-3 text-white shadow-[0_8px_24px_-4px_rgba(43,40,38,0.25)] active:scale-[0.98]"
      >
        <span className="flex items-center gap-2 text-sm font-semibold">
          <span className="flex h-6 min-w-6 items-center justify-center rounded-full bg-white/25 px-1.5 text-xs">
            {itemCount}
          </span>
          {tableCode} · View Cart
        </span>
        <span className="flex items-center gap-1 text-sm font-semibold">
          {formatMoney(totalFils, currency)}
          <span aria-hidden="true">→</span>
        </span>
      </Link>
    </div>
  );
}
