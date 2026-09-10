import type { ReactNode } from 'react';
import Link from 'next/link';
import {
  BellRing,
  Store,
  Landmark,
  ServerCog,
  ShieldCheck,
  Lock,
  UserRound,
} from 'lucide-react';
import { PlatformSignOut } from '@/components/platform/platform-sign-out';

/**
 * src/components/platform/platform-shell.tsx
 *
 * The `/admin` founder-console chrome, rebuilt to the Stitch
 * "Superadmin / Founder — Tenant Fleet Directory" design: a 320px
 * dark-slate sidebar with a teal header strip, a fixed status header,
 * and a cool-white content canvas with sharp corners (Inter, 2–4px
 * radii). Server Component; only sign-out is a client island.
 *
 * The three nav items below Tenant Directory are shown for parity with
 * the design but are not wired to anything yet (no revenue / telemetry /
 * audit pipeline) — they render as disabled "Soon" rows, not links.
 */

const NAV = [
  { id: 'tenants', label: 'Tenant Directory', href: '/admin', icon: Store, ready: true },
  { id: 'revenue', label: 'Global Revenue & Billing', href: '#', icon: Landmark, ready: false },
  { id: 'health', label: 'System Health & Nodes', href: '#', icon: ServerCog, ready: false },
  { id: 'audit', label: 'Audit & Security Logs', href: '#', icon: ShieldCheck, ready: false },
] as const;

export function PlatformShell({
  email,
  active,
  tenantCount,
  branchCount,
  children,
}: {
  email: string;
  active: 'tenants';
  tenantCount?: number;
  branchCount?: number;
  children: ReactNode;
}) {
  return (
    <div className="min-h-dvh bg-[#F8F9FF] font-body text-[#121C2A]">
      {/* Sidebar */}
      <aside className="fixed inset-y-0 left-0 z-40 flex w-[280px] flex-col justify-between bg-[#27313F] text-[#EAF1FF] xl:w-[320px]">
        <div>
          <div className="flex h-14 items-center justify-between bg-[#003A3E] px-4">
            <div className="flex items-center gap-2">
              <BellRing className="h-4 w-4 text-[#96D0D6]" />
              <span className="font-heading text-base font-bold tracking-tight text-white">TableBells</span>
            </div>
            <span className="rounded-sm bg-[#0F5257] px-1.5 py-0.5 text-[10px] font-bold uppercase tracking-widest text-[#89C4C9]">
              Founder
            </span>
          </div>

          <div className="px-4 pb-1 pt-5">
            <span className="text-[10px] font-bold uppercase tracking-widest text-[#BFC8C9]">Platform Ops</span>
          </div>

          <nav className="flex flex-col gap-0.5 px-2">
            {NAV.map((item) => {
              const isActive = item.ready && item.id === active;
              if (!item.ready) {
                return (
                  <span
                    key={item.id}
                    className="flex h-11 cursor-not-allowed items-center gap-2.5 rounded-sm px-3 text-sm text-[#7F8A99]"
                  >
                    <item.icon className="h-[18px] w-[18px]" />
                    <span className="flex-1">{item.label}</span>
                    <span className="rounded-sm bg-white/5 px-1.5 py-0.5 text-[9px] font-bold uppercase tracking-wide">
                      Soon
                    </span>
                  </span>
                );
              }
              return (
                <Link
                  key={item.id}
                  href={item.href}
                  className={`flex h-11 items-center gap-2.5 rounded-sm px-3 text-sm font-semibold transition-colors ${
                    isActive
                      ? 'bg-[#0F5257] text-white'
                      : 'text-[#C9D3E0] hover:bg-white/5 hover:text-white'
                  }`}
                >
                  <item.icon className="h-[18px] w-[18px]" />
                  {item.label}
                </Link>
              );
            })}
          </nav>
        </div>

        <div className="flex flex-col gap-3 p-4">
          <div className="flex items-center justify-between rounded-sm bg-white/5 px-3 py-2">
            <div className="flex items-center gap-2">
              <Lock className="h-4 w-4 text-[#8D9AAA]" />
              <span className="text-xs font-semibold text-[#C9D3E0]">Lockdown switch</span>
            </div>
            <span className="rounded-sm bg-white/10 px-1.5 py-0.5 text-[9px] font-bold uppercase tracking-wide text-[#8D9AAA]">
              Standby
            </span>
          </div>
          <div className="flex items-center gap-2.5 border-t border-white/10 pt-3">
            <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-sm bg-[#003A3E] text-xs font-bold text-white">
              {email.slice(0, 1).toUpperCase()}
            </span>
            <div className="min-w-0 flex-1">
              <p className="truncate text-sm font-semibold text-white">{email}</p>
              <p className="text-[10px] uppercase tracking-wide text-[#8D9AAA]">Platform founder</p>
            </div>
          </div>
          <PlatformSignOut />
        </div>
      </aside>

      {/* Content */}
      <div className="pl-[280px] xl:pl-[320px]">
        <header className="sticky top-0 z-30 flex h-14 items-center justify-between border-b border-[#D9E3F6] bg-white px-6">
          <div className="flex items-center gap-4">
            <span className="inline-flex items-center gap-1.5 rounded-sm bg-[#E6EEFF] px-2 py-1 text-[10px] font-bold uppercase tracking-widest text-[#121C2A]">
              <span className="h-1.5 w-1.5 rounded-full bg-[#176B4B]" />
              Production
            </span>
            <span className="hidden text-xs text-[#404849] md:inline">
              {typeof tenantCount === 'number' ? `${tenantCount} tenant${tenantCount === 1 ? '' : 's'}` : '—'}
              {typeof branchCount === 'number' ? ` · ${branchCount} branch${branchCount === 1 ? '' : 'es'}` : ''}
            </span>
          </div>
          <span className="flex h-8 w-8 items-center justify-center rounded-full bg-[#003A3E] text-white">
            <UserRound className="h-4 w-4" />
          </span>
        </header>

        <main className="mx-auto max-w-[1180px] px-6 py-6">{children}</main>
      </div>
    </div>
  );
}
