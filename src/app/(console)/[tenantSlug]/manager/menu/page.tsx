import type { ReactNode } from 'react';
import Link from 'next/link';
import { requireStaffSession } from '@/server/services/resolve-staff-session';
import { resolveMenuVersion } from '@/server/services/menu-version';
import { canManageMenu, roleLabel } from '@/lib/console/staff-permissions';
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
    <div className="flex min-h-dvh flex-col bg-[#F3F4F6]">
      <header className="flex items-center justify-between border-b border-[#E5E7EB] bg-white px-4 py-3">
        <div>
          <h1 className="text-lg font-bold text-[#1F2937]">Menu Maker</h1>
          <p className="text-xs text-[#6B7280]">
            {tenantSlug} · {session.displayName} ({roleLabel(session.role)})
          </p>
        </div>
        <Link
          href={`/${tenantSlug}/cashier`}
          className="flex h-10 items-center rounded-lg border border-[#E5E7EB] px-3 text-sm font-semibold text-[#1F2937]"
        >
          Back to console
        </Link>
      </header>
      <div className="flex-1 px-4 py-4">{body}</div>
    </div>
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

  const liveVersion = await resolveMenuVersion(session.tid, branchId);

  return shell(
    <MenuMakerView tenantId={session.tid} branchId={branchId} liveVersion={liveVersion} />,
  );
}
