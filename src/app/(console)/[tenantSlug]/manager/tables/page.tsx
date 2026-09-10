import type { ReactNode } from 'react';
import Link from 'next/link';
import { adminDb } from '@/lib/firebase/admin';
import { requireStaffSession } from '@/server/services/resolve-staff-session';
import { canManageTables, roleLabel } from '@/lib/console/staff-permissions';
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
    <div className="flex min-h-dvh flex-col bg-[#F3F4F6]">
      <header className="flex items-center justify-between border-b border-[#E5E7EB] bg-white px-4 py-3">
        <div>
          <h1 className="text-lg font-bold text-[#1F2937]">Table Management</h1>
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
