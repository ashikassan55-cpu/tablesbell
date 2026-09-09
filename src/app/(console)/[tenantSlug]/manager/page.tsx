import Link from 'next/link';
import { requireStaffSession } from '@/server/services/resolve-staff-session';
import { roleLabel } from '@/lib/console/staff-permissions';

/**
 * src/app/(console)/[tenantSlug]/manager/page.tsx
 *
 * The Manager hub — the landing surface a manager/owner is sent to after
 * PIN login when no explicit `?next=` was carried in (see
 * `staff-login-view.tsx`'s `roleHome`). Middleware already gates
 * `/manager/*`; this page enforces the manager/owner role on top and,
 * for anyone else with a valid session, links back to the shared
 * console instead of the four management tools.
 */

const TOOLS = [
  { href: 'menu', title: 'Menu Maker', desc: 'Edit categories and items, publish a new menu version.' },
  { href: 'tables', title: 'Tables & QR', desc: 'Add or disable tables, print QR table tents.' },
  { href: 'staff', title: 'Staff Management', desc: 'Add staff, set roles and PINs, revoke access.' },
  { href: 'settings', title: 'Store Settings', desc: 'Currency, VAT rate, receipt footer, display name.' },
] as const;

export default async function ManagerHubPage({
  params,
}: {
  params: Promise<{ tenantSlug: string }>;
}) {
  const { tenantSlug } = await params;
  const session = await requireStaffSession(tenantSlug);
  const isManager = session.role === 'manager' || session.role === 'owner';

  return (
    <div className="flex min-h-dvh flex-col bg-[#F3F4F6]">
      <header className="flex items-center justify-between border-b border-[#E5E7EB] bg-white px-4 py-3">
        <div>
          <h1 className="text-lg font-bold text-[#1F2937]">Manager Console</h1>
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

      <div className="flex-1 px-4 py-4">
        {isManager ? (
          <div className="mx-auto grid max-w-3xl gap-3 sm:grid-cols-2">
            {TOOLS.map((tool) => (
              <Link
                key={tool.href}
                href={`/${tenantSlug}/manager/${tool.href}`}
                className="rounded-lg border border-[#E5E7EB] bg-white p-5 transition-colors hover:border-[#0F5257]"
              >
                <p className="text-sm font-bold text-[#1F2937]">{tool.title}</p>
                <p className="mt-1 text-sm text-[#6B7280]">{tool.desc}</p>
              </Link>
            ))}
          </div>
        ) : (
          <div className="mx-auto max-w-md rounded-lg border border-[#E5E7EB] bg-white p-6 text-center">
            <p className="text-sm font-semibold text-[#1F2937]">Manager access required</p>
            <p className="mt-1 text-sm text-[#6B7280]">
              This area is limited to managers and owners.{' '}
              <Link href={`/${tenantSlug}/cashier`} className="font-semibold text-[#0F5257] underline">
                Go to the console
              </Link>
              .
            </p>
          </div>
        )}
      </div>
    </div>
  );
}
