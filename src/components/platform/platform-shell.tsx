import type { ReactNode } from 'react';
import Link from 'next/link';
import { Building2, LayoutGrid } from 'lucide-react';
import { PlatformSignOut } from '@/components/platform/platform-sign-out';

/**
 * src/components/platform/platform-shell.tsx
 *
 * The `/admin` founder-console chrome: dark fixed sidebar + light content
 * area, from the Stitch "Superadmin / Founder" design. Server Component;
 * only the sign-out control is a client island. Nav is intentionally
 * short — the revenue / system-health / audit screens in the design are
 * a later pass (DECISIONS.md ADR-12, "core management" scope).
 */

export function PlatformShell({
  email,
  active,
  children,
}: {
  email: string;
  active: 'tenants';
  children: ReactNode;
}) {
  const nav = [{ id: 'tenants', label: 'Restaurants', href: '/admin', icon: Building2 }] as const;

  return (
    <div className="min-h-dvh bg-[#F4ECE9] font-body text-[#1E1B19]">
      <aside className="fixed inset-y-0 left-0 z-40 flex w-60 flex-col justify-between bg-[#1E1B19] px-4 py-5 text-[#F7EFEC]">
        <div>
          <div className="flex items-center gap-2">
            <span className="font-heading text-lg font-extrabold tracking-tight">
              Table<span className="text-[#E85D3F]">Bells</span>
            </span>
          </div>
          <span className="mt-1 inline-block rounded bg-[#E85D3F]/20 px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider text-[#FFB4A4]">
            Founder Console
          </span>

          <nav className="mt-8 flex flex-col gap-1">
            {nav.map((item) => {
              const isActive = item.id === active;
              return (
                <Link
                  key={item.id}
                  href={item.href}
                  className={`flex items-center gap-2.5 rounded-lg px-3 py-2 text-sm font-semibold transition-colors ${
                    isActive
                      ? 'bg-[#E85D3F] text-white'
                      : 'text-[#C9BDB8] hover:bg-white/10 hover:text-white'
                  }`}
                >
                  <item.icon className="h-4 w-4" />
                  {item.label}
                </Link>
              );
            })}
          </nav>
        </div>

        <div className="border-t border-white/10 pt-3">
          <div className="flex items-center gap-2 px-3 py-2">
            <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-[#E85D3F] text-xs font-bold text-white">
              {email.slice(0, 1).toUpperCase()}
            </span>
            <div className="min-w-0">
              <p className="truncate text-sm font-semibold text-white">{email}</p>
              <p className="text-[10px] uppercase tracking-wide text-[#8D716B]">Platform founder</p>
            </div>
          </div>
          <PlatformSignOut />
        </div>
      </aside>

      <main className="ml-60 min-h-dvh">
        <div className="mx-auto max-w-6xl px-6 py-8">
          <div className="mb-6 flex items-center gap-2 text-xs font-semibold uppercase tracking-wide text-[#8D716B]">
            <LayoutGrid className="h-3.5 w-3.5" />
            Platform Ops
          </div>
          {children}
        </div>
      </main>
    </div>
  );
}
