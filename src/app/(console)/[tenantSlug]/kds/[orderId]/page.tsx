import { TicketDetailView } from '@/components/ops/ticket-detail-view';
import { requireStaffSession } from '@/server/services/resolve-staff-session';

/**
 * src/app/(console)/[tenantSlug]/kds/[orderId]/page.tsx
 *
 * Server Component shell. `requireStaffSession` verifies the `tb_staff`
 * cookie server-side, same as every other console route.
 *
 * LIVE-WIRED (2026-09-09) — the last mock read in the app is gone.
 * `MOCK_ORDERS` is no longer imported (the file is deleted); this page
 * hands the client view the verified `tenantId` / `branchId` and the URL
 * `orderId`, and `TicketDetailView` opens a live `onSnapshot` on the one
 * `orders/{orderId}` document. "Ticket not found" (stale deep link, purged
 * ticket) is now a client-side listener state, not a server `notFound()`.
 *
 * `branchId` is `bids[0]` — same first-authorized-branch simplification the
 * other console routes carry.
 */
export default async function KdsTicketDetailPage({
  params,
}: {
  params: Promise<{ tenantSlug: string; orderId: string }>;
}) {
  const { tenantSlug, orderId } = await params;
  const session = await requireStaffSession(tenantSlug);
  const branchId = session.bids[0];

  if (!branchId) {
    return (
      <div className="flex min-h-dvh items-center justify-center bg-[#0B1220] px-6 text-center">
        <p className="text-sm text-[#94A3B8]">Your account has no branch assigned. Contact a manager.</p>
      </div>
    );
  }

  return (
    <TicketDetailView tenantId={session.tid} branchId={branchId} orderId={orderId} tenantSlug={tenantSlug} />
  );
}
