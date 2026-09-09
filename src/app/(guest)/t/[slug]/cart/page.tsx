import { bootGuestPage } from '@/server/services/guest-boot.service';
import { GenericUnavailable, TableFull, MoveConfirm } from '@/components/guest/guest-boot-states';
import { GuestSessionProvider } from '@/components/providers/guest-session-provider';
import { CartCheckoutView } from '@/components/guest/cart-checkout-view';

/**
 * src/app/(guest)/t/[slug]/cart/page.tsx
 *
 * LIVE-WIRED. Runs the exact same `bootGuestPage` chain as the menu page
 * (`../page.tsx`) -- not a coincidence, the two genuinely share the same
 * server-side boot logic now (`server/services/guest-boot.service.ts`).
 * `lib/guest/resolve-table-placeholder.ts`, this file's previous table
 * resolver, was this file's last consumer and has been deleted.
 *
 * A GENUINE QUESTION THIS RAISES, worth naming rather than silently
 * resolving one way: `resolveGuestSession` runs its full wake/move/create
 * transaction on every call, and this page now calls it independently of
 * whatever the menu page already did in the same visit. In the common
 * case (guest scans once, opens the menu, adds items, taps into the
 * cart) this is harmless -- the SAME device hitting the SAME table twice
 * in quick succession resolves to a 'resumed' wake both times, not a
 * second party. It stops being harmless only in the already-known
 * `'move_pending'` edge case: if a guest's device somehow has an open
 * session at a DIFFERENT table (see that outcome's own handling) between
 * the menu load and the cart load, this page would independently detect
 * and render that state too, redundantly but not incorrectly. Not
 * something this pass optimizes away (e.g. by caching the boot result
 * across navigations) -- that would be a real, separate change to how
 * session state is threaded through the guest surface, not part of what
 * "wire the cart to live data" asked for.
 *
 * `<CartCheckoutView>` no longer takes `tableId`/`tableCode` as props --
 * it now reads them from `useGuestSession()`, the same context the menu
 * page's `<GuestMenuView>` already consumes. `slug` is still passed
 * explicitly: it's route data, not session data, and the checkout view
 * still needs it to build a couple of relative links back to the menu.
 */

interface RouteParams {
  params: Promise<{ slug: string }>;
}

export default async function GuestCartPage({ params }: RouteParams) {
  const { slug } = await params;
  const boot = await bootGuestPage(slug);

  if (boot.kind === 'unavailable') {
    return <GenericUnavailable />;
  }
  if (boot.kind === 'table_full') {
    return <TableFull />;
  }
  if (boot.kind === 'move_pending') {
    return <MoveConfirm fromTableCode={boot.fromTableCode} toTableCode={boot.toTableCode} />;
  }

  return (
    <GuestSessionProvider customToken={boot.customToken} context={boot.context}>
      <CartCheckoutView slug={slug} />
    </GuestSessionProvider>
  );
}
