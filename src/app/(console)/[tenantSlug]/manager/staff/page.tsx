import type { ReactNode } from 'react';
import { requireStaffSession } from '@/server/services/resolve-staff-session';
import { canManageStaff } from '@/lib/console/staff-permissions';
import { ManagerShell } from '@/components/manager/manager-shell';
import { StaffManagerView } from '@/components/manager/staff-manager-view';

/**
 * src/app/(console)/[tenantSlug]/manager/staff/page.tsx
 *
 * Server Component shell for Manager Staff Management (ARCHITECTURE.md
 * §1.6, DECISIONS.md ADR-10). `requireStaffSession` verifies `tb_staff`
 * (middleware also gates `/manager/*`); this page enforces
 * `canManageStaff` on top — a cashier/server/kitchen session gets an
 * explanatory panel. `session.bids` (the branches the acting manager is
 * scoped to) is passed down so the "assign branches" picker can only
 * offer branches the manager may actually grant — `upsertStaff` re-checks
 * this server-side.
 */
export default async function ManagerStaffPage({
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
      active="staff-tables"
      title="Staff Management"
      subNav={[
        { label: 'Staff', href: `/${tenantSlug}/manager/staff`, current: true },
        { label: 'Tables & QR codes', href: `/${tenantSlug}/manager/tables`, current: false },
      ]}
    >
      {body}
    </ManagerShell>
  );

  if (!canManageStaff({ role: session.role, overrideAuth: session.overrideAuth })) {
    return shell(
      <div className="mx-auto max-w-md rounded-lg border border-[#E5E7EB] bg-white p-6 text-center">
        <p className="text-sm font-semibold text-[#1F2937]">Manager access required</p>
        <p className="mt-1 text-sm text-[#6B7280]">
          Adding staff and changing roles is limited to managers and owners.
        </p>
      </div>,
    );
  }

  if (!branchId) {
    return shell(<p className="text-sm text-[#6B7280]">Your account has no branch assigned. Contact an owner.</p>);
  }

  return shell(
    <StaffManagerView
      branchId={branchId}
      branchOptions={session.bids}
      actorRole={session.role}
    />,
  );
}
