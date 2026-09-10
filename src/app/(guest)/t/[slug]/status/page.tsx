import { bootGuestPage } from '@/server/services/guest-boot.service';
import { GenericUnavailable, TableFull, MoveConfirm } from '@/components/guest/guest-boot-states';
import { GuestSessionProvider } from '@/components/providers/guest-session-provider';
import { OrderTrackerView } from '@/components/guest/order-tracker-view';

/**
 * src/app/(guest)/t/[slug]/status/page.tsx
 *
 * Screen 4 of the guest flow — order confirmation + live prep tracker.
 * `?r=<orderRequestId>` is handed over by the cart on Place Order;
 * `?o=<orderId>` addresses a priced order directly. Same shared
 * `bootGuestPage` chain as every other guest route.
 */

interface RouteParams {
  params: Promise<{ slug: string }>;
  searchParams: Promise<{ r?: string; o?: string }>;
}

export default async function GuestOrderStatusPage({ params, searchParams }: RouteParams) {
  const { slug } = await params;
  const { r, o } = await searchParams;
  const boot = await bootGuestPage(slug);

  if (boot.kind === 'unavailable') return <GenericUnavailable />;
  if (boot.kind === 'table_full') return <TableFull />;
  if (boot.kind === 'move_pending') {
    return <MoveConfirm fromTableCode={boot.fromTableCode} toTableCode={boot.toTableCode} />;
  }

  return (
    <GuestSessionProvider customToken={boot.customToken} context={boot.context}>
      <OrderTrackerView slug={slug} requestId={r ?? null} orderId={o ?? null} />
    </GuestSessionProvider>
  );
}
