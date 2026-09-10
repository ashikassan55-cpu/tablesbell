import type { ReactNode } from 'react';
import Link from 'next/link';
import {
  LayoutDashboard,
  UtensilsCrossed,
  UsersRound,
  Settings2,
  MonitorCog,
  CircleUserRound,
} from 'lucide-react';
import { roleLabel } from '@/lib/console/staff-permissions';
import { LockSwitchButton } from '@/components/console/lock-switch-button';
import type { StaffRole } from '@/types/firestore';

/**
 * src/components/manager/manager-shell.tsx
 *
 * The Manager Console chrome, from the Stitch "Manager Console —
 * Executive Reports" design: a 320px white sidebar (shift + nav + user +
 * lock) and a slim status header over a cool `#F3F4F6` canvas. Shared by
 * the overview dashboard and every management sub-page so the console
 * feels like one app, not five separate screens.
 *
 * `active`: which nav group is current. Staff and Tables share one nav
 * entry ("Staff & Tables").
 */

type ManagerNav = 'overview' | 'menu' | 'staff-tables' | 'settings';

const NAV: { id: Exclude<ManagerNav, never>; label: string; href: string; icon: typeof LayoutDashboard }[] = [
  { id: 'overview', label: 'Overview & Reports', href: '', icon: LayoutDashboard },
  { id: 'menu', label: 'Menu Management', href: '/menu', icon: UtensilsCrossed },
  { id: 'staff-tables', label: 'Staff & Tables', href: '/staff', icon: UsersRound },
  { id: 'settings', label: 'Store Settings', href: '/settings', icon: Settings2 },
];

export function ManagerShell({
  tenantSlug,
  displayName,
  role,
  active,
  branchName,
  statusRight,
  title,
  subNav,
  children,
}: {
  tenantSlug: string;
  displayName: string;
  role: StaffRole;
  active: ManagerNav;
  branchName?: string;
  statusRight?: ReactNode;
  /** Page heading shown above the content (the overview dashboard sets
   *  its own, so it leaves this unset). */
  title?: string;
  /** Optional segmented sub-navigation shown under the title — used to
   *  split a single sidebar entry (e.g. "Staff & Tables") into its pages. */
  subNav?: { label: string; href: string; current: boolean }[];
  children: ReactNode;
}) {
  return (
    <div className="min-h-dvh bg-[#F3F4F6] font-body text-[#1F2937]">
      {/* Sidebar */}
      <aside className="fixed inset-y-0 left-0 z-40 flex w-[260px] flex-col justify-between border-r border-[#E5E7EB] bg-white xl:w-[300px]">
        <div>
          <div className="flex items-center gap-2.5 border-b border-[#E5E7EB] px-4 py-3.5">
            <span className="flex h-9 w-9 items-center justify-center rounded-lg bg-[#0F5257] text-sm font-bold text-white">
              TB
            </span>
            <div className="leading-tight">
              <p className="text-sm font-bold text-[#1F2937]">TableBells</p>
              <p className="text-xs text-[#6B7280]">Manager Console</p>
            </div>
          </div>

          <div className="border-b border-[#E5E7EB] px-4 py-3">
            <div className="flex items-center justify-between">
              <span className="text-[10px] font-bold uppercase tracking-widest text-[#6B7280]">Store</span>
              <span className="inline-flex items-center gap-1 rounded-full bg-[#D1FAE5] px-2 py-0.5 text-[10px] font-bold uppercase text-[#2E7D5B]">
                <span className="h-1.5 w-1.5 rounded-full bg-[#2E7D5B]" /> Live
              </span>
            </div>
            <p className="mt-0.5 text-sm font-semibold text-[#1F2937]">{branchName || tenantSlug}</p>
          </div>

          <nav className="flex flex-col gap-1 p-2">
            {NAV.map((item) => {
              const isActive = item.id === active;
              return (
                <Link
                  key={item.id}
                  href={`/${tenantSlug}/manager${item.href}`}
                  className={`flex min-h-[44px] items-center gap-3 rounded-lg px-3 text-sm font-semibold transition-colors ${
                    isActive
                      ? 'bg-[#0F5257] text-white'
                      : 'text-[#4B5563] hover:bg-[#F3F4F6] hover:text-[#1F2937]'
                  }`}
                >
                  <item.icon className="h-[18px] w-[18px]" />
                  {item.label}
                </Link>
              );
            })}
            <Link
              href={`/${tenantSlug}/cashier`}
              className="flex min-h-[44px] items-center justify-between gap-3 rounded-lg px-3 text-sm font-semibold text-[#4B5563] transition-colors hover:bg-[#F3F4F6] hover:text-[#1F2937]"
            >
              <span className="flex items-center gap-3">
                <MonitorCog className="h-[18px] w-[18px]" />
                Live Operations
              </span>
              <span className="rounded bg-[#E5E7EB] px-1.5 py-0.5 text-[9px] font-bold uppercase text-[#4B5563]">
                Console
              </span>
            </Link>
          </nav>
        </div>

        <div className="border-t border-[#E5E7EB] p-3">
          <div className="mb-2 flex items-center gap-2 px-1">
            <CircleUserRound className="h-8 w-8 text-[#9CA3AF]" />
            <div className="min-w-0">
              <p className="truncate text-sm font-bold text-[#1F2937]">{displayName}</p>
              <p className="text-xs text-[#6B7280]">{roleLabel(role)}</p>
            </div>
          </div>
          <LockSwitchButton tenantSlug={tenantSlug} />
        </div>
      </aside>

      {/* Content */}
      <div className="pl-[260px] xl:pl-[300px]">
        <header className="sticky top-0 z-30 flex h-12 items-center justify-between border-b border-[#E5E7EB] bg-white px-6 text-xs text-[#6B7280]">
          <span className="inline-flex items-center gap-1.5">
            <span className="h-1.5 w-1.5 rounded-full bg-[#2E7D5B]" />
            Console connected
          </span>
          <div>{statusRight}</div>
        </header>
        <main className="mx-auto max-w-[1180px] px-6 py-6">
          {title ? (
            <h1 className="mb-4 text-xl font-bold tracking-tight text-[#1F2937]">{title}</h1>
          ) : null}
          {subNav && subNav.length > 0 ? (
            <div className="mb-4 inline-flex gap-1 rounded-lg bg-[#E5E7EB] p-1">
              {subNav.map((s) => (
                <Link
                  key={s.href}
                  href={s.href}
                  aria-current={s.current ? 'page' : undefined}
                  className={`rounded-md px-3 py-1.5 text-sm font-semibold transition-colors ${
                    s.current
                      ? 'bg-white text-[#0F5257] shadow-sm'
                      : 'text-[#4B5563] hover:text-[#1F2937]'
                  }`}
                >
                  {s.label}
                </Link>
              ))}
            </div>
          ) : null}
          {children}
        </main>
      </div>
    </div>
  );
}
