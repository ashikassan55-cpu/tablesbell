'use client';

/**
 * src/components/guest/menu-item-card.tsx
 *
 * Guest surface (RULES.md §3): 48×48px minimum on the Add control, no
 * directional (pl-/pr-/left-/right-) utilities — this component uses only
 * flex `gap`, which is inherently RTL-safe, so no logical-property
 * overrides are needed here.
 *
 * STYLING NOTE: colors below use Tailwind arbitrary-value hex (`bg-[#…]`)
 * as a stated, temporary exception to RULES.md §1.6/§3.5 ("never a raw hex
 * value outside the theme token definitions"). `tailwind.config.ts` and
 * the `data-surface="guest"` CSS custom properties (ARCHITECTURE.md §7.3)
 * don't exist in this workspace yet, so there is no `bg-primary`-style
 * semantic class to point at. Every hex value here must be replaced with
 * its semantic equivalent the moment those two files are built.
 */

import { useState } from 'react';
import { useCart, type MenuItem } from '@/components/providers/cart-provider';
import { useGuestSession } from '@/components/providers/guest-session-provider';
import { formatMoney } from '@/lib/format/money';

export function MenuItemCard({ item }: { item: MenuItem }) {
  const { addItem } = useCart();
  const { currency } = useGuestSession();
  const [justAdded, setJustAdded] = useState(false);

  function handleAdd() {
    addItem(item);
    setJustAdded(true);
    window.setTimeout(() => setJustAdded(false), 900);
  }

  return (
    <li className="flex items-center gap-3 rounded-xl border border-[#ECE7E1] bg-white p-3">
      <div className="flex min-w-0 flex-1 flex-col gap-1">
        {item.badge ? (
          <span className="w-fit rounded-full bg-[#FFF5F2] px-2 py-0.5 text-[11px] font-semibold text-[#E85D3F]">
            {item.badge}
          </span>
        ) : null}

        <p className="truncate text-[15px] font-semibold text-[#1F2937]">{item.name}</p>

        {item.dietaryTag ? (
          <span className="w-fit rounded-full border border-[#4E937A]/30 bg-[#4E937A]/10 px-2 py-0.5 text-[11px] font-medium text-[#4E937A]">
            {item.dietaryTag}
          </span>
        ) : null}

        <p className="text-sm font-semibold text-[#1F2937]">{formatMoney(item.priceFils, currency)}</p>
      </div>

      <button
        type="button"
        onClick={handleAdd}
        aria-label={`Add ${item.name} to cart`}
        className={[
          'flex h-12 w-12 shrink-0 items-center justify-center rounded-full text-2xl font-semibold text-white transition-transform active:scale-95',
          justAdded ? 'bg-[#4E937A]' : 'bg-[#E85D3F]',
        ].join(' ')}
      >
        <span aria-hidden="true">{justAdded ? '✓' : '+'}</span>
      </button>
    </li>
  );
}
