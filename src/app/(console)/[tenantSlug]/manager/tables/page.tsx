import type { ReactNode } from 'react';
import { adminDb } from '@/lib/firebase/admin';
import { requireStaffSession } from '@/server/services/resolve-staff-session';
import { canManageTables } from '@/lib/console/staff-permissions';
import { ManagerShell } from '@/components/manager/manager-shell';
import { TablesManagerView } from '@/components/manager/tables-manager-view';

/**
 * src/app/(console)/[tenantSlug]/manager/tables/page.tsx
 *
 * Server Component shell for Manager Table Management (ARCHITECTURE.md
 * §1.6, §8.1). `requireStaffSession` verifies `tb_staff` (middleware
 * also gates `/manager/*`); this page enforces `canManageTables` on top —
 * a cashier/server/kitchen session gets an explanatory panel.
 *
 * `NEXT_PUBLIC_APP_URL` is the public origin the printed QR codes point
 * at (`${origin}/t/{slug}`). Read here rather than in the client so the
 * fallback and its "wrong for real print runs" caveat live in one place.
 * The restaurant display name is a best-effort read of `tenants/{tid}`
 * (falls back to the slug — MEMORY.md §4's "display name is hardcoded"
 * gap, sourced properly the first time here).
 */
export default async function ManagerTablesPage({
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
      title="Tables & QR codes"
    >
      {body}
    </ManagerShell>
  );

  if (!canManageTables({ role: session.role, overrideAuth: session.overrideAuth })) {
    return shell(
      <div className="mx-auto max-w-md rounded-lg border border-[#E5E7EB] bg-white p-6 text-center">
        <p className="text-sm font-semibold text-[#1F2937]">Manager access required</p>
        <p className="mt-1 text-sm text-[#6B7280]">
          Table setup and QR codes are limited to managers and owners.
        </p>
      </div>,
    );
  }

  if (!branchId) {
    return shell(<p className="text-sm text-[#6B7280]">Your account has no branch assigned. Contact an owner.</p>);
  }

  const appUrl = (process.env.NEXT_PUBLIC_APP_URL || 'https://app.tablebells.ae').replace(/\/+$/, '');

  let restaurantName = tenantSlug;
  try {
    const tenantSnap = await adminDb.doc(`tenants/${session.tid}`).get();
    const data = tenantSnap.data() as { name?: string; displayName?: string } | undefined;
    restaurantName = (data?.displayName || data?.name || tenantSlug).toString();
  } catch {
    // Best-effort only — the slug is a fine fallback for a print header.
  }

  return shell(
    <TablesManagerView
      tenantId={session.tid}
      branchId={branchId}
      appUrl={appUrl}
      restaurantName={restaurantName}
    />,
  );
}
