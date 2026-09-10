import type { Metadata } from 'next';
import Link from 'next/link';
import { Plus } from 'lucide-react';
import { requirePlatformSession } from '@/server/services/resolve-platform-session';
import { listTenants } from '@/server/services/tenant.service';
import { PlatformShell } from '@/components/platform/platform-shell';
import { TenantDirectory } from '@/components/platform/tenant-directory';

export const metadata: Metadata = {
  title: 'Restaurants',
  robots: { index: false, follow: false },
};

// Founder data — never cache, never prerender.
export const dynamic = 'force-dynamic';

export default async function PlatformHomePage() {
  const session = await requirePlatformSession();
  const tenants = await listTenants();

  const kpi = {
    total: tenants.length,
    active: tenants.filter((t) => t.status === 'active').length,
    trial: tenants.filter((t) => t.status === 'trial').length,
    suspended: tenants.filter((t) => t.status === 'suspended' || t.status === 'past_due').length,
    mrr: tenants
      .filter((t) => t.status === 'active')
      .reduce((sum, t) => sum + (t.monthlyFeeAed || 0), 0),
  };

  return (
    <PlatformShell email={session.email} active="tenants">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="font-heading text-2xl font-bold tracking-tight text-[#1E1B19]">
            Tenant Directory
          </h1>
          <p className="text-sm text-[#59413C]">Every restaurant on the platform. Onboard, plan, suspend.</p>
        </div>
        <Link
          href="/admin/tenants/new"
          className="inline-flex items-center gap-2 rounded-lg bg-[#E85D3F] px-4 py-2.5 text-sm font-bold text-white shadow-sm transition-colors hover:bg-[#d24e33]"
        >
          <Plus className="h-4 w-4" />
          New restaurant
        </Link>
      </div>

      <div className="mt-5 grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Kpi label="Total accounts" value={String(kpi.total)} />
        <Kpi label="Active" value={String(kpi.active)} tone="good" />
        <Kpi label="On trial" value={String(kpi.trial)} tone="warn" />
        <Kpi label="Suspended / past due" value={String(kpi.suspended)} tone="bad" />
      </div>
      <p className="mt-2 text-xs text-[#8D716B]">
        Approx. active MRR: <strong className="text-[#1E6751]">AED {kpi.mrr.toLocaleString('en-AE')}</strong>{' '}
        (sum of active plan fees — manual billing, not a payment-processor figure)
      </p>

      <div className="mt-5">
        <TenantDirectory tenants={tenants} />
      </div>
    </PlatformShell>
  );
}

function Kpi({ label, value, tone }: { label: string; value: string; tone?: 'good' | 'warn' | 'bad' }) {
  const toneClass =
    tone === 'good'
      ? 'text-[#1E6751]'
      : tone === 'warn'
        ? 'text-[#8E4E14]'
        : tone === 'bad'
          ? 'text-[#B4231F]'
          : 'text-[#1E1B19]';
  return (
    <div className="rounded-xl border border-[#E0BFB8] bg-white p-4 shadow-sm">
      <p className="text-xs font-semibold uppercase tracking-wide text-[#8D716B]">{label}</p>
      <p className={`mt-1 font-heading text-2xl font-bold ${toneClass}`}>{value}</p>
    </div>
  );
}
