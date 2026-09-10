import type { ReactNode } from 'react';
import Link from 'next/link';
import { requireStaffSession } from '@/server/services/resolve-staff-session';
import { canManageSettings, roleLabel } from '@/lib/console/staff-permissions';
import { StoreSettingsView } from '@/components/manager/store-settings-view';

/**
 * src/app/(console)/[tenantSlug]/manager/settings/page.tsx
 *
 * Server Component shell for Manager Store Settings (DECISIONS.md
 * ADR-11). `requireStaffSession` + a `canManageSettings` (manager/owner)
 * gate on top of the cookie. The VAT rate configured here feeds
 * `priceOrderRequest`'s money math, so a non-manager gets an explanatory
 * panel, not the form.
 */
export default async function ManagerSettingsPage({
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
          <h1 className="text-lg font-bold text-[#1F2937]">Store Settings</h1>
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

  if (!canManageSettings({ role: session.role, overrideAuth: session.overrideAuth })) {
    return shell(
      <div className="mx-auto max-w-md rounded-lg border border-[#E5E7EB] bg-white p-6 text-center">
        <p className="text-sm font-semibold text-[#1F2937]">Manager access required</p>
        <p className="mt-1 text-sm text-[#6B7280]">
          Currency, tax rate, and receipt settings are limited to managers and owners.
        </p>
      </div>,
    );
  }

  if (!branchId) {
    return shell(<p className="text-sm text-[#6B7280]">Your account has no branch assigned. Contact an owner.</p>);
  }

  return shell(<StoreSettingsView tenantId={session.tid} branchId={branchId} tenantSlug={tenantSlug} />);
}
