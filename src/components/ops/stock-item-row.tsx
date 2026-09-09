'use client';

/**
 * src/components/ops/stock-item-row.tsx
 *
 * One catalog item plus its modifier options, each independently
 * toggleable. Modifiers render as indented sub-rows directly in place —
 * no expand/collapse step — because the task asked for "fast" access,
 * and a hidden-by-default disclosure is the opposite of fast when a
 * chef is trying to 86 an ingredient mid-rush.
 *
 * Out-of-stock state is never color-only: the toggle switch, the strike-
 * through on the name, AND an explicit "86'd" text badge all change
 * together (RULES.md §3, "both surfaces" rule 1).
 */

import type { CatalogItem } from '@/hooks/use-live-catalog';

function formatAed(fils: number): string {
  return `AED ${(fils / 100).toFixed(2)}`;
}

interface StockItemRowProps {
  item: CatalogItem;
  onToggleItem: (itemId: string) => void;
  // `groupId` isn't needed — the real `toggleStock` keys modifier
  // availability by `${itemId}:${optionId}`, and an option id is unique
  // within its item.
  onToggleOption: (itemId: string, optionId: string) => void;
}

export function StockItemRow({ item, onToggleItem, onToggleOption }: StockItemRowProps) {
  return (
    <li className="rounded-xl border border-[#25324A] bg-[#151E2E] p-3">
      <div className="flex items-center justify-between gap-3">
        <div className="min-w-0 flex-1">
          <p
            className={[
              'text-sm font-semibold',
              item.available ? 'text-[#F1F5F9]' : 'text-[#F87171] line-through decoration-[#F87171]',
            ].join(' ')}
          >
            {item.name.en}
          </p>
          <p className="mt-0.5 flex items-center gap-2 text-xs tabular-nums text-[#94A3B8]">
            {formatAed(item.priceFils)}
            {!item.available ? (
              <span className="rounded-sm bg-[#3B1418] px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-[#F87171]">
                86&apos;d
              </span>
            ) : null}
          </p>
        </div>

        <ToggleSwitch checked={item.available} onChange={() => onToggleItem(item.id)} label={`Toggle stock for ${item.name.en}`} />
      </div>

      {item.modifierGroups.length > 0 ? (
        <ul className="mt-3 flex flex-col gap-1.5 border-t border-[#25324A] pt-3 ps-3">
          {item.modifierGroups.flatMap((group) =>
            group.options.map((option) => (
              <li key={option.id} className="flex items-center justify-between gap-3">
                <p
                  className={[
                    'text-xs',
                    option.available ? 'text-[#CBD5E1]' : 'text-[#F87171] line-through decoration-[#F87171]',
                  ].join(' ')}
                >
                  {option.name.en}
                  {!option.available ? <span className="ms-1.5 text-[10px] font-semibold no-underline">86&apos;d</span> : null}
                </p>
                <ToggleSwitch
                  checked={option.available}
                  onChange={() => onToggleOption(item.id, option.id)}
                  label={`Toggle stock for ${option.name.en}`}
                />
              </li>
            )),
          )}
        </ul>
      ) : null}
    </li>
  );
}

function ToggleSwitch({ checked, onChange, label }: { checked: boolean; onChange: () => void; label: string }) {
  // The visual track is smaller than 48×48px, which is fine — what
  // RULES.md §3 requires is the TAPPABLE area, not the drawn shape. The
  // button itself carries the 48×48px minimum via padding/min-dimensions;
  // the smaller track is centered inside it purely as a visual cue.
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={label}
      onClick={onChange}
      className="flex h-12 w-12 shrink-0 items-center justify-center"
    >
      <span
        className={['relative h-6 w-11 rounded-full transition-colors', checked ? 'bg-[#22C55E]' : 'bg-[#3B1418]'].join(' ')}
        aria-hidden="true"
      >
        <span
          className={[
            'absolute top-1 left-1 h-4 w-4 rounded-full bg-white transition-transform',
            checked ? 'translate-x-5' : 'translate-x-0',
          ].join(' ')}
        />
      </span>
    </button>
  );
}
