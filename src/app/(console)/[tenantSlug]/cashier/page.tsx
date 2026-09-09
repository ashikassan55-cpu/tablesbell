import { CashierDashboardView } from '@/components/cashier/cashier-dashboard-view';
import { requireStaffSession } from '@/server/services/resolve-staff-session';
import { toStaffIdentity } from '@/lib/console/staff-permissions';

/**
 * src/app/(console)/[tenantSlug]/cashier/page.tsx
 *
 * Server Component shell. `requireStaffSession` verifies the `tb_staff`
 * cookie server-side (redirect to `/{tenantSlug}/lock` when missing or
 * invalid), same as `kds`/`floor`.
 *
 * LIVE-WIRED (2026-09-09). No more `MOCK_TABLES` / `MOCK_ALERTS` /
 * `MOCK_ORDERS` — this page now hands the client view only the verified
 * `tenantId` and `branchId`, and `CashierDashboardView` opens real
 * `onSnapshot` listeners on `tables`, `sessions`, `orders`, and
 * `staffAlerts` for that branch (`hooks/use-live-cashier-data.ts`). The
 * line-void flow therefore acts on real order documents, not mock ids.
 *
 * `branchId` is `bids[0]` — the same first-authorized-branch simplification
 * `kds/page.tsx` carries; no branch-switcher UI exists yet.
 */
export default async function CashierPage({
  params,
}: {
  params: Promise<{ tenantSlug: string }>;
}) {
  const { tenantSlug } = await params;
  const session = await requireStaffSession(tenantSlug);

  return (
    <CashierDashboardView
      tenantSlug={tenantSlug}
      staff={toStaffIdentity(session)}
      tenantId={session.tid}
      branchId={session.bids[0] ?? null}
    />
  );
}
