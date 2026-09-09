import { KdsNavTabs } from '@/components/ops/kds-nav-tabs';
import { StockBoardView } from '@/components/ops/stock-board-view';
import { requireStaffSession } from '@/server/services/resolve-staff-session';
import { resolveMenuVersion } from '@/server/services/menu-version';

/**
 * src/app/(console)/[tenantSlug]/kds/stock/page.tsx
 *
 * Server Component shell — mirrors `kds/page.tsx`. `requireStaffSession`
 * verifies `tb_staff`; `resolveMenuVersion` does the one branch read that
 * turns this branch into `menuPublished/v{n}`.
 *
 * LIVE-WIRED (2026-09-09) — `MOCK_CATALOG` is gone. `StockBoardView` opens
 * the same two listeners the guest menu uses (`menuPublished/v{n}` +
 * `live/availability`) and its toggles call the real `toggleStock`
 * action.
 */
export default async function KdsStockPage({
  params,
}: {
  params: Promise<{ tenantSlug: string }>;
}) {
  const { tenantSlug } = await params;
  const session = await requireStaffSession(tenantSlug);
  const branchId = session.bids[0];

  const header = (
    <>
      <header className="flex items-center justify-between border-b border-[#25324A] bg-[#0F1826] px-4 py-3">
        <div>
          <h1 className="text-lg font-semibold text-[#F1F5F9]">Stock Board</h1>
          <p className="text-xs text-[#94A3B8]">{tenantSlug} · Availability</p>
        </div>
      </header>
      <KdsNavTabs tenantSlug={tenantSlug} />
    </>
  );

  if (!branchId) {
    return (
      <div className="flex min-h-dvh flex-col bg-[#0B1220]">
        {header}
        <div className="flex flex-1 items-center justify-center px-6 text-center">
          <p className="text-sm text-[#94A3B8]">Your account has no branch assigned. Contact a manager.</p>
        </div>
      </div>
    );
  }

  const menuVersion = await resolveMenuVersion(session.tid, branchId);

  return (
    <div className="flex min-h-dvh flex-col bg-[#0B1220]">
      {header}
      <StockBoardView tenantId={session.tid} branchId={branchId} menuVersion={menuVersion} />
    </div>
  );
}
