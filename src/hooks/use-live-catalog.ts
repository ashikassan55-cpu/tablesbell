'use client';

/**
 * src/hooks/use-live-catalog.ts
 *
 * The STAFF-side live menu catalog, replacing `lib/kds/stock-catalog.ts`'s
 * `MOCK_CATALOG` on both the KDS Stock Board and the Waiter order-entry
 * menu. Same two-listener pattern as the guest `use-live-menu.ts` — and
 * the same read budget (ARCHITECTURE.md §2.4: "2 reads:
 * `menuPublished/v{n}` + `live/availability`"), with `menuVersion`
 * resolved server-side once (`server/services/menu-version.ts`):
 *
 *   1. `tenants/{t}/branches/{b}/menuPublished/v{n}` — the versioned menu
 *      snapshot `publishMenu` writes.
 *   2. `tenants/{t}/branches/{b}/live/availability` — the single-doc 86
 *      broadcast (`AvailabilityDoc`).
 *
 * WHY A SEPARATE HOOK FROM `use-live-menu.ts`, NOT A SHARED ONE: the
 * guest hook flattens to a display shape and FILTERS OUT anything 86'd —
 * a guest never sees an unavailable item. The Stock Board is the exact
 * opposite: it must show every active item AND its current 86 state so a
 * chef can toggle it. So this hook keeps the richer `CatalogItem` shape
 * (canonical `MenuItem` + a computed `available` flag on the item and on
 * each modifier option) and returns every active item, 86'd or not. The
 * Waiter menu then filters `.available` itself, exactly as it did against
 * the mock.
 *
 * EFFECTIVE AVAILABILITY is computed the same way `order.service.ts`'s
 * `resolveAndPriceLines` does it — two independent inputs, both must pass:
 *   - item:   not present in `availability.unavailableItems`
 *   - option: `option.available` (the debounced published flag) AND not
 *             present in `availability.unavailableModifierOptions`
 *             (compound-keyed `${itemId}:${optionId}` — an option id is
 *             only unique within its parent item).
 *
 * CATEGORY NAMES (ADR-8): `publishMenu` now writes `name: LocalizedText`
 * (and `sortIndex`) onto each published category, so `categories[].label`
 * is the real English name. A menu published before ADR-8 has no `name` —
 * the fallback to the raw id is kept for exactly that case.
 */

import { useEffect, useMemo, useState } from 'react';
import { doc, onSnapshot, type FirestoreError } from 'firebase/firestore';
import { db } from '@/lib/firebase/client';
import type { AvailabilityDoc, MenuItem, ModifierGroup } from '@/types/firestore';

/** Canonical `MenuItem` plus the computed effective-availability flag.
 *  Moved here from `lib/kds/stock-catalog.ts` (deleted). */
export interface CatalogItem extends MenuItem {
  available: boolean;
}

export interface CatalogCategory {
  id: string;
  label: string;
}

interface MenuPublishedItemDoc {
  id: string;
  sku: string;
  name: MenuItem['name'];
  priceFils: number;
  stationId: string;
  status?: MenuItem['status'];
  modifierGroups: ModifierGroup[];
}

interface MenuPublishedCategoryDoc {
  id: string;
  /** Added by `publishMenu` (ADR-8). Absent on pre-ADR-8 published docs —
   *  fall back to the raw id then. */
  name?: MenuItem['name'];
  sortIndex?: number;
  items: MenuPublishedItemDoc[];
}

interface MenuPublishedDoc {
  version: number;
  categories: MenuPublishedCategoryDoc[];
}

export type LiveCatalogState =
  | { status: 'loading'; items: CatalogItem[]; categories: CatalogCategory[]; error: null }
  | { status: 'ready'; items: CatalogItem[]; categories: CatalogCategory[]; error: null }
  | { status: 'error'; items: CatalogItem[]; categories: CatalogCategory[]; error: string };

const EMPTY_AVAILABILITY: AvailabilityDoc = {
  updatedAt: 0,
  unavailableItems: {},
  unavailableModifierOptions: {},
};

function buildCatalog(menu: MenuPublishedDoc, availability: AvailabilityDoc): {
  items: CatalogItem[];
  categories: CatalogCategory[];
} {
  const categories: CatalogCategory[] = menu.categories.map((category) => ({
    id: category.id,
    label: category.name?.en?.trim() || category.id,
  }));

  const items: CatalogItem[] = menu.categories.flatMap((category) =>
    category.items
      // Lenient on `status`: a *published* item with no status is active
      // by definition; only explicit draft/archived is excluded. (The
      // guest `use-live-menu.ts` is stricter — `=== 'active'` — which is
      // fine there because it also drops anything 86'd anyway.)
      .filter((item) => item.status !== 'draft' && item.status !== 'archived')
      .map((item) => ({
        id: item.id,
        categoryId: category.id, // published nesting is structural — no own field
        sku: item.sku,
        name: item.name,
        priceFils: item.priceFils,
        stationId: item.stationId,
        status: 'active' as const,
        available: !availability.unavailableItems[item.id],
        modifierGroups: item.modifierGroups.map((group) => ({
          ...group,
          options: group.options.map((option) => ({
            ...option,
            available:
              option.available &&
              !availability.unavailableModifierOptions[`${item.id}:${option.id}`],
          })),
        })),
      })),
  );

  return { items, categories };
}

export function useLiveCatalog(tenantId: string, branchId: string, menuVersion: number): LiveCatalogState {
  const [menu, setMenu] = useState<MenuPublishedDoc | null>(null);
  const [availability, setAvailability] = useState<AvailabilityDoc>(EMPTY_AVAILABILITY);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setMenu(null);
    setAvailability(EMPTY_AVAILABILITY);
    setError(null);

    const base = `tenants/${tenantId}/branches/${branchId}`;
    const onErr = (err: FirestoreError) => setError(err.message);

    const unsubMenu = onSnapshot(
      doc(db, `${base}/menuPublished/v${menuVersion}`),
      (snap) => {
        if (!snap.exists()) {
          setError('This menu is not currently published.');
          return;
        }
        setMenu(snap.data() as MenuPublishedDoc);
      },
      onErr,
    );

    const unsubAvailability = onSnapshot(
      doc(db, `${base}/live/availability`),
      (snap) => setAvailability(snap.exists() ? (snap.data() as AvailabilityDoc) : EMPTY_AVAILABILITY),
      onErr,
    );

    return () => {
      unsubMenu();
      unsubAvailability();
    };
  }, [tenantId, branchId, menuVersion]);

  // Memoised so `live.items` / `live.categories` stay referentially stable
  // across a consumer's unrelated re-renders (the Stock Board's search
  // box, the Waiter cart) — otherwise every keystroke rebuilds the whole
  // catalog and busts every downstream `useMemo`.
  const built = useMemo<{ items: CatalogItem[]; categories: CatalogCategory[] }>(
    () => (menu ? buildCatalog(menu, availability) : { items: [], categories: [] }),
    [menu, availability],
  );

  if (error) {
    return { status: 'error', items: [], categories: [], error };
  }
  if (!menu) {
    return { status: 'loading', items: [], categories: [], error: null };
  }
  return { status: 'ready', items: built.items, categories: built.categories, error: null };
}
