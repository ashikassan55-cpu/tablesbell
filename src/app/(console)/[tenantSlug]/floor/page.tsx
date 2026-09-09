import { WaiterFloorView } from '@/components/waiter/waiter-floor-view';
import { requireStaffSession } from '@/server/services/resolve-staff-session';
import { toStaffIdentity } from '@/lib/console/staff-permissions';
import { resolveMenuVersion } from '@/server/services/menu-version';

/**
 * src/app/(console)/[tenantSlug]/floor/page.tsx
 *
 * The Waiter Floor route (`/{tenantSlug}/floor` — there is no separate
 * `/waiter` route). `requireStaffSession` verifies the `tb_staff` cookie
 * server-side, same as `kds`/`cashier`.
 *
 * LIVE-WIRED. No more `MOCK_TABLES` / `MOCK_ORDERS` (`use-live-waiter-data.ts`
 * — `tables`, `sessions`, `orders where status == 'ready'`), and no more
 * `MOCK_CATALOG` — `menuVersion` is resolved here (one branch read) so the
 * Waiter order-entry menu can open its `menuPublished/v{n}` +
 * `live/availability` listeners (`use-live-catalog.ts`).
 *
 * `branchId` is `bids[0]` — same first-authorized-branch simplification
 * `kds`/`cashier` carry. `menuVersion` is only resolved when a branch
 * exists (otherwise `WaiterFloorView` shows the no-branch message and the
 * order-entry menu never mounts).
 */
export default async function FloorPage({
  params,
}: {
  params: Promise<{ tenantSlug: string }>;
}) {
  const { tenantSlug } = await params;
  const session = await requireStaffSession(tenantSlug);
  const branchId = session.bids[0] ?? null;
  const menuVersion = branchId ? await resolveMenuVersion(session.tid, branchId) : null;

  return (
    <WaiterFloorView
      tenantSlug={tenantSlug}
      staff={toStaffIdentity(session)}
      tenantId={session.tid}
      branchId={branchId}
      menuVersion={menuVersion}
    />
  );
}
