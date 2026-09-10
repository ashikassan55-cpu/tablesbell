import Link from 'next/link';
import { requireStaffSession } from '@/server/services/resolve-staff-session';
import { adminDb } from '@/lib/firebase/admin';
import { getManagerOverview } from '@/server/services/manager-reports.service';
import { ManagerShell } from '@/components/manager/manager-shell';
import { OverviewDashboard } from '@/components/manager/overview-dashboard';

/**
 * src/app/(console)/[tenantSlug]/manager/page.tsx
 *
 * The Manager Console landing page: the "Executive Reports & Daily
 * Performance" dashboard from the Stitch design, wrapped in the shared
 * `ManagerShell`. `requireStaffSession` + a manager/owner role gate; a
 * cashier/server/kitchen session with a valid cookie gets an
 * explanatory panel inside the shell, not the numbers.
 */

export const dynamic = 'force-dynamic';

async function branchName(tenantId: string, branchId: string): Promise<string> {
  try {
    const snap = await adminDb.doc(`tenants/${tenantId}/branches/${branchId}`).get();
    const d = snap.data() as { name?: string; displayName?: string } | undefined;
    return d?.name || d?.displayName || 'Branch';
  } catch {
    return 'Branch';
  }
}

export default async function ManagerOverviewPage({
  params,
}: {
  params: Promise<{ tenantSlug: string }>;
}) {
  const { tenantSlug } = await params;
  const session = await requireStaffSession(tenantSlug);
  const isManager = session.role === 'manager' || session.role === 'owner';
  const branchId = session.bids[0] ?? null;

  if (!isManager || !branchId) {
    return (
      <ManagerShell
        tenantSlug={tenantSlug}
        displayName={session.displayName}
        role={session.role}
        active="overview"
      >
        <div className="mx-auto max-w-md rounded-lg border border-[#E5E7EB] bg-white p-6 text-center">
          <p className="text-sm font-semibold text-[#1F2937]">
            {isManager ? 'No branch assigned' : 'Manager access required'}
          </p>
          <p className="mt-1 text-sm text-[#6B7280]">
            {isManager ? (
              'Your account has no branch assigned. Contact an owner.'
            ) : (
              <>
                Reports are limited to managers and owners.{' '}
                <Link href={`/${tenantSlug}/cashier`} className="font-semibold text-[#0F5257] underline">
                  Go to the console
                </Link>
                .
              </>
            )}
          </p>
        </div>
      </ManagerShell>
    );
  }

  const [name, overview] = await Promise.all([
    branchName(session.tid, branchId),
    getManagerOverview(session.tid, branchId),
  ]);

  return (
    <ManagerShell
      tenantSlug={tenantSlug}
      displayName={session.displayName}
      role={session.role}
      active="overview"
      branchName={name}
      statusRight={
        <span className="tabular-nums">
          {overview.today.orderCount} orders today · {overview.openTables} open
        </span>
      }
    >
      <OverviewDashboard tenantSlug={tenantSlug} branchName={name} data={overview} />
    </ManagerShell>
  );
}
