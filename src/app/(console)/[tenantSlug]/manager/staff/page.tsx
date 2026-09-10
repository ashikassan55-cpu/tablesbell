import type { ReactNode } from 'react';
import Link from 'next/link';
import { requireStaffSession } from '@/server/services/resolve-staff-session';
import { canManageStaff, roleLabel } from '@/lib/console/staff-permissions';
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
    <div className="flex min-h-dvh flex-col bg-[#F3F4F6]">
      <header className="flex items-center justify-between border-b border-[#E5E7EB] bg-white px-4 py-3">
        <div>
          <h1 className="text-lg font-bold text-[#1F2937]">Staff Management</h1>
          <p className="text-xs text-[#6B7280]">
            {tenantSlug} · {session.displayName} ({roleLabel(session.role)})
          </p>
        </div>
        <Link
          href={`/${tenantSlug}/manager`}
          className="flex h-10 items-center rounded-lg border border-[#E5E7EB] px-3 text-sm font-semibold text-[#1F2937]"
        >
          Back to Manager Console
        </Link>
      </header>
      <div className="flex-1 px-4 py-4">{body}</div>
    </div>
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
