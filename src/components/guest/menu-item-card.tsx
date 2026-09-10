'use client';

/**
 * src/components/guest/menu-item-card.tsx
 *
 * Guest menu row, rebuilt to the Stitch "menu browsing / quick cart"
 * card: title + optional badge + 2-line description + coral price on the
 * start edge, a 96×96 photo (or a coral illustration tile when the item
 * has no `imageUrl`) with an overlaid quick-add `+` on the end edge.
 *
 * RTL-safe: only flex `gap` + logical `text-start`, no `pl-/pr-/left-/
 * right-` — the whole guest surface must mirror unmodified under عربي.
 * The 48×48 minimum touch target is preserved on the add control even
 * though the visible circle is smaller (RULES.md §3).
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
    <li className="flex items-stretch gap-3 rounded-xl bg-white p-3.5 text-start shadow-sm">
      <div className="flex min-w-0 flex-1 flex-col">
        <h3 className="truncate font-heading text-[16px] font-semibold text-[#1F2937]">{item.name}</h3>

        {item.badge ? (
          <span className="mt-1 w-fit rounded bg-[#FFF5F2] px-1.5 py-0.5 text-[10px] font-bold uppercase tracking-wide text-[#FF6B4A]">
            {item.badge}
          </span>
        ) : null}

        {item.description ? (
          <p className="mt-1 line-clamp-2 text-xs text-[#6B7280]">{item.description}</p>
        ) : null}

        <div className="mt-auto flex items-center gap-2 pt-2">
          <span className="font-heading text-[16px] font-bold text-[#FF6B4A]">
            {formatMoney(item.priceFils, currency)}
          </span>
          {item.dietaryTag ? (
            <span className="text-[11px] font-medium text-[#10B981]">{item.dietaryTag}</span>
          ) : null}
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
          onClick={handleAdd}
          aria-label={`Add ${item.name}`}
          className={[
            'absolute bottom-1 right-1 flex h-10 w-10 items-center justify-center rounded-full text-xl font-semibold text-white shadow-md transition-transform active:scale-90',
            justAdded ? 'bg-[#10B981]' : 'bg-[#FF6B4A]',
          ].join(' ')}
        >
          <span aria-hidden="true">{justAdded ? '✓' : '+'}</span>
        </button>
      </div>
    </li>
  );
}
