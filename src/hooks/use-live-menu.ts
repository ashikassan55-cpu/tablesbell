'use client';

/**
 * src/hooks/use-live-menu.ts
 *
 * ARCHITECTURE.md §7.2 names `hooks/use-cart.ts` as a future path for the
 * real (localStorage-backed) cart -- this is the first file in that
 * directory, built for a different, adjacent concern: the guest menu
 * itself. Two live listeners, matching §2.4's stated budget exactly ("A
 * full guest menu load is 2 reads: `menuPublished/v{n}` + [`live/
 * availability`]"):
 *
 *   1. `tenants/{t}/branches/{b}/menuPublished/v{n}` -- the versioned,
 *      guest-read snapshot `publishMenu` writes (§1.5, §7.6's function
 *      table). `n` is `menuVersion`, resolved server-side once by
 *      `page.tsx` and passed in as a parameter -- see
 *      `guest-session-provider.tsx`'s header for why that number is
 *      deliberately not itself a third live listener.
 *   2. `tenants/{t}/branches/{b}/live/availability` -- the single-document
 *      86 broadcast channel (§2.4), typed as the canonical `AvailabilityDoc`
 *      in `types/firestore.ts`.
 *
 * SHAPE MISMATCH, RESOLVED DELIBERATELY, NOT BY ACCIDENT: the canonical
 * `MenuItem` (`types/firestore.ts`) names its display text
 * `name: LocalizedText` (`{ en, ar }`). The existing guest UI's `MenuItem`
 * (`components/providers/cart-provider.tsx`) -- already consumed by
 * `MenuItemCard` and `CartBar` exactly as built -- expects
 * `name: string`. This hook is the seam where that translation happens:
 * it maps the canonical, richer Firestore shape down to the flatter
 * display shape those already-built leaf components expect, picking
 * `.name.en` unconditionally. There is no locale switcher anywhere in
 * this codebase yet -- ".en, always" is an honest reflection of that, not
 * a hidden decision to never support Arabic. When a real locale switch
 * exists, this is the one place that needs to change, not every card
 * component downstream of it.
 *
 * CATEGORY NAMES (ADR-8): closed. `publishMenu` writes
 * `name: LocalizedText` onto every published category, so `categories[]`
 * carries the real English label. The raw-id fallback below only fires
 * for a menu published before ADR-8 (none, in practice).
 */

import { useEffect, useState } from 'react';
import { doc, onSnapshot, type FirestoreError } from 'firebase/firestore';
import { db } from '@/lib/firebase/client';
import { useGuestLocale } from '@/components/providers/guest-locale-provider';
import type { MenuItem as CanonicalMenuItem, AvailabilityDoc } from '@/types/firestore';
import type { MenuItem as DisplayMenuItem } from '@/components/providers/cart-provider';

interface MenuPublishedCategoryDoc {
  id: string;
  /** Written by `publishMenu` (ADR-8); absent on older published docs. */
  name?: CanonicalMenuItem['name'];
  items: CanonicalMenuItem[];
}

interface MenuPublishedSnapshot {
  version: number;
  categories: MenuPublishedCategoryDoc[];
}

export interface LiveMenuCategory {
  id: string;
  label: string;
}

export type LiveMenuState =
  | { status: 'loading'; categories: []; items: []; error: null }
  | { status: 'ready'; categories: LiveMenuCategory[]; items: DisplayMenuItem[]; error: null }
  | { status: 'error'; categories: []; items: []; error: string };

const EMPTY_AVAILABILITY: AvailabilityDoc = {
  updatedAt: 0,
  unavailableItems: {},
  unavailableModifierOptions: {},
};

/**
 * `enabled` gates both listeners entirely -- pass `session.authReady`
 * from `useGuestSession()`. Firing these before the client is actually
 * signed in hits `firestore.rules`' `isGuest(t, b)` check with no
 * `request.auth` yet, surfacing as a permission-denied `'error'` state
 * a beat before sign-in would have succeeded on its own. Called
 * unconditionally regardless of `enabled` (React's rules of hooks) --
 * the gate lives inside the effect, not around the hook call.
 */
export function useLiveMenu(
  tenantId: string,
  branchId: string,
  menuVersion: number,
  enabled: boolean,
): LiveMenuState {
  const { locale } = useGuestLocale();
  const [menu, setMenu] = useState<MenuPublishedSnapshot | null>(null);
  const [availability, setAvailability] = useState<AvailabilityDoc>(EMPTY_AVAILABILITY);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!enabled) return;

    setMenu(null);
    setAvailability(EMPTY_AVAILABILITY);
    setError(null);

    const menuRef = doc(db, `tenants/${tenantId}/branches/${branchId}/menuPublished/v${menuVersion}`);
    const availabilityRef = doc(db, `tenants/${tenantId}/branches/${branchId}/live/availability`);

    const onMenuError = (err: FirestoreError) => setError(err.message);
    const onAvailabilityError = (err: FirestoreError) => setError(err.message);

    const unsubMenu = onSnapshot(
      menuRef,
      (snap) => {
        if (!snap.exists()) {
          setError('This menu is not currently published.');
          return;
        }
        setMenu(snap.data() as MenuPublishedSnapshot);
      },
      onMenuError,
    );

    const unsubAvailability = onSnapshot(
      availabilityRef,
      (snap) => {
        setAvailability(snap.exists() ? (snap.data() as AvailabilityDoc) : EMPTY_AVAILABILITY);
      },
      onAvailabilityError,
    );

    return () => {
      unsubMenu();
      unsubAvailability();
    };
  }, [tenantId, branchId, menuVersion, enabled]);

  if (error) {
    return { status: 'error', categories: [], items: [], error };
  }

  if (!enabled || !menu) {
    return { status: 'loading', categories: [], items: [], error: null };
  }

  // This hook is the one translation seam (see file header): pick the
  // locale-appropriate string here, fall back to English, so every leaf
  // component downstream still gets a flat `string`.
  const loc = (t: { en: string; ar: string } | undefined | null): string =>
    !t ? '' : (locale === 'ar' ? t.ar : t.en) || t.en || t.ar || '';

  const categories: LiveMenuCategory[] = menu.categories.map((category) => ({
    id: category.id,
    label: loc(category.name)?.trim() || category.id,
  }));

  const items: DisplayMenuItem[] = menu.categories.flatMap((category) =>
    category.items
      .filter((item) => item.status === 'active' && !availability.unavailableItems[item.id])
      .map((item) => ({
        id: item.id,
        categoryId: category.id,
        name: loc(item.name) || item.name.en,
        priceFils: item.priceFils,
        imageUrl: item.imageUrl || undefined,
        description: loc(item.description) || undefined,
        // `badge`/`dietaryTag` (cart-provider's `MenuItem` type) have no
        // canonical schema field to source from -- the mock data had
        // them as hand-authored decoration, not real Firestore fields.
      })),
  );

  return { status: 'ready', categories, items, error: null };
}
