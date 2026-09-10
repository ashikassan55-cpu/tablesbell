import type { ReactNode } from 'react';
import { requireStaffSession } from '@/server/services/resolve-staff-session';
import { resolveMenuVersion } from '@/server/services/menu-version';
import { getMenuItemVelocityToday } from '@/server/services/manager-reports.service';
import { canManageMenu } from '@/lib/console/staff-permissions';
import { ManagerShell } from '@/components/manager/manager-shell';
import { MenuMakerView } from '@/components/manager/menu-maker-view';

/**
 * src/app/(console)/[tenantSlug]/manager/menu/page.tsx
 *
 * Server Component shell for the Manager Menu Maker (DECISIONS.md ADR-8).
 * `requireStaffSession` verifies `tb_staff` (middleware also gates
 * `/manager/*` now); this page additionally enforces the ROLE — a
 * cashier/server/kitchen member with a valid session still gets only an
 * explanatory panel, never the editor. `resolveMenuVersion` reads the one
 * branch field that says which `menuPublished/v{n}` is currently live, so
 * the view can show "live: v3 · draft last published: v2".
 */
export default async function ManagerMenuPage({
  params,
}: {
  params: Promise<{ tenantSlug: string }>;
}) {
  const { tenantSlug } = await params;
  const session = await requireStaffSession(tenantSlug);
  const branchId = session.bids[0] ?? null;

  const shell = (body: ReactNode) => (
    <ManagerShell
      tenantSlug={tenantSlug}
      displayName={session.displayName}
      role={session.role}
      active="menu"
      title="Menu Management"
    >
      {body}
    </ManagerShell>
  );

  if (!canManageMenu({ role: session.role, overrideAuth: session.overrideAuth })) {
    return shell(
      <div className="mx-auto max-w-md rounded-lg border border-[#E5E7EB] bg-white p-6 text-center">
        <p className="text-sm font-semibold text-[#1F2937]">Manager access required</p>
        <p className="mt-1 text-sm text-[#6B7280]">
          The Menu Maker is limited to managers and owners. Ask a manager to make menu changes.
        </p>
      </div>,
    );
  }

  if (!branchId) {
    return shell(
      <p className="text-sm text-[#6B7280]">Your account has no branch assigned. Contact an owner.</p>,
    );
  }

  const [liveVersion, velocity] = await Promise.all([
    resolveMenuVersion(session.tid, branchId),
    getMenuItemVelocityToday(session.tid, branchId).catch(() => ({})),
  ]);

  return shell(
    <MenuMakerView
      tenantId={session.tid}
      branchId={branchId}
      liveVersion={liveVersion}
      velocity={velocity}
    />,
  );
}
