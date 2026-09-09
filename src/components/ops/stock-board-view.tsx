'use client';

/**
 * src/components/ops/stock-board-view.tsx
 *
 * LIVE-WIRED (2026-09-09). Reads via `useLiveCatalog` (`menuPublished/v{n}`
 * + `live/availability`, the same two-read pattern as the guest menu),
 * and its toggles call the REAL `toggleStock` action
 * (`server/actions/kds.actions.ts`) — `unavailableItems` for the item
 * switch, `unavailableModifierOptions` for an option switch. No local
 * `setCatalog`: `live/availability` is the single source of truth, so
 * both the toggle and the guest phones reflect the change from the same
 * `onSnapshot` delta.
 *
 * Search still matches an item's own name OR any modifier option's name —
 * "which item has this ingredient" is the fast-lookup a chef needs
 * mid-rush.
 */

import { useMemo, useState } from 'react';
import { StockItemRow } from './stock-item-row';
import { useLiveCatalog, type CatalogItem } from '@/hooks/use-live-catalog';
import { toggleStock } from '@/server/actions/kds.actions';

function matchesQuery(item: CatalogItem, query: string): boolean {
  const q = query.trim().toLowerCase();
  if (q === '') return true;
  if (item.name.en.toLowerCase().includes(q)) return true;
  return item.modifierGroups.some((group) => group.options.some((option) => option.name.en.toLowerCase().includes(q)));
}

function BoardShell({ message }: { message: string }) {
  return (
    <div className="flex flex-1 items-center justify-center px-4 py-4">
      <p className="text-sm text-[#94A3B8]">{message}</p>
    </div>
  );
}

export function StockBoardView({
  tenantId,
  branchId,
  menuVersion,
}: {
  tenantId: string;
  branchId: string;
  menuVersion: number;
}) {
  const live = useLiveCatalog(tenantId, branchId, menuVersion);
  const [query, setQuery] = useState('');
  const [actionError, setActionError] = useState<string | null>(null);

  const catalog = live.items;

  async function handleToggleItem(itemId: string) {
    const item = catalog.find((candidate) => candidate.id === itemId);
    if (!item) return;
    setActionError(null);
    const result = await toggleStock({ branchId, target: { kind: 'item', itemId }, available: !item.available });
    if (result.outcome === 'rejected') {
      setActionError(`Couldn't update that item (${result.reason}).`);
    }
    // On success the `live/availability` listener reflects it.
  }

  async function handleToggleOption(itemId: string, optionId: string) {
    const item = catalog.find((candidate) => candidate.id === itemId);
    const option = item?.modifierGroups.flatMap((group) => group.options).find((o) => o.id === optionId);
    if (!option) return;
    setActionError(null);
    const result = await toggleStock({
      branchId,
      target: { kind: 'modifierOption', itemId, optionId },
      available: !option.available,
    });
    if (result.outcome === 'rejected') {
      setActionError(`Couldn't update that modifier (${result.reason}).`);
    }
  }

  const filtered = useMemo(() => catalog.filter((item) => matchesQuery(item, query)), [catalog, query]);
  const outOfStockCount = useMemo(() => catalog.filter((item) => !item.available).length, [catalog]);

  if (live.status === 'loading') {
    return <BoardShell message="Loading the stock board…" />;
  }
  if (live.status === 'error') {
    return <BoardShell message={live.error} />;
  }

  return (
    <div className="flex flex-1 flex-col gap-4 overflow-hidden px-4 py-4">
      <div className="flex items-center gap-3">
        <div className="relative flex-1">
          <span className="pointer-events-none absolute inset-y-0 start-3 flex items-center text-[#64748B]" aria-hidden="true">
            🔍
          </span>
          <input
            type="search"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Search items or modifiers…"
            aria-label="Search menu items and modifiers"
            className="h-12 w-full rounded-lg border border-[#25324A] bg-[#151E2E] ps-10 pe-3 text-sm text-[#F1F5F9] placeholder:text-[#64748B]"
          />
        </div>
        <span className="flex h-12 shrink-0 items-center gap-1.5 rounded-lg border border-[#25324A] bg-[#151E2E] px-3 text-xs font-semibold text-[#94A3B8]">
          {catalog.length} items
          {outOfStockCount > 0 ? <span className="text-[#F87171]">· {outOfStockCount} out of stock</span> : null}
        </span>
      </div>

      {actionError ? (
        <p role="alert" className="rounded-lg border border-[#F87171]/30 bg-[#3B1418] px-3 py-2 text-sm text-[#F87171]">
          {actionError}
        </p>
      ) : null}

      {filtered.length === 0 ? (
        <p className="flex flex-1 items-center justify-center text-sm text-[#64748B]">No items match &quot;{query}&quot;.</p>
      ) : (
        <div className="flex-1 space-y-6 overflow-y-auto">
          {live.categories.map((category) => {
            const items = filtered.filter((item) => item.categoryId === category.id);
            if (items.length === 0) return null;

            return (
              <section key={category.id}>
                <h2 className="mb-2 text-xs font-semibold uppercase tracking-wide text-[#94A3B8]">{category.label}</h2>
                <ul className="grid grid-cols-1 gap-2 sm:grid-cols-2 lg:grid-cols-3">
                  {items.map((item) => (
                    <StockItemRow
                      key={item.id}
                      item={item}
                      onToggleItem={handleToggleItem}
                      onToggleOption={handleToggleOption}
                    />
                  ))}
                </ul>
              </section>
            );
          })}
        </div>
      )}
    </div>
  );
}
