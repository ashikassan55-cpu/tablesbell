import { bootGuestPage } from '@/server/services/guest-boot.service';
import { GenericUnavailable, TableFull, MoveConfirm } from '@/components/guest/guest-boot-states';
import { GuestSessionProvider } from '@/components/providers/guest-session-provider';
import { GuestMenuView } from '@/components/guest/guest-menu-view';

/**
 * src/app/(guest)/t/[slug]/menu/page.tsx
 *
 * Screen 2 of the guest flow — the full per-category menu. Runs the same
 * `bootGuestPage` chain as the landing (`../page.tsx`) and the cart
 * (`../cart/page.tsx`); see `guest-boot.service.ts` for why that logic
 * is shared rather than re-derived per route.
 */

interface RouteParams {
  params: Promise<{ slug: string }>;
}

export default async function GuestMenuPage({ params }: RouteParams) {
  const { slug } = await params;
  const boot = await bootGuestPage(slug);

  if (boot.kind === 'unavailable') return <GenericUnavailable />;
  if (boot.kind === 'table_full') return <TableFull />;
  if (boot.kind === 'move_pending') {
    return <MoveConfirm fromTableCode={boot.fromTableCode} toTableCode={boot.toTableCode} />;
  }

  return (
    <GuestSessionProvider customToken={boot.customToken} context={boot.context}>
      <GuestMenuView slug={slug} />
    </GuestSessionProvider>
  );
}
