import type { Metadata } from 'next';
import Link from 'next/link';
import { Plus, Building2, Wallet, GitBranch, TriangleAlert } from 'lucide-react';
import { requirePlatformSession } from '@/server/services/resolve-platform-session';
import { listTenants } from '@/server/services/tenant.service';
import { PlatformShell } from '@/components/platform/platform-shell';
import { TenantDirectory } from '@/components/platform/tenant-directory';

export const metadata: Metadata = {
  title: 'Tenant Directory',
  robots: { index: false, follow: false },
};

export const dynamic = 'force-dynamic';

export default async function PlatformHomePage() {
  const session = await requirePlatformSession();
  const tenants = await listTenants();

  const active = tenants.filter((t) => t.status === 'active').length;
  const trial = tenants.filter((t) => t.status === 'trial').length;
  const suspended = tenants.filter((t) => t.status === 'suspended').length;
  const attention = tenants.filter((t) => t.status === 'suspended' || t.status === 'past_due').length;
  const branchTotal = tenants.reduce((s, t) => s + t.branchCount, 0);
  const mrr = tenants
    .filter((t) => t.status === 'active')
    .reduce((s, t) => s + (t.monthlyFeeAed || 0), 0);

  const aed = (n: number) => `AED ${n.toLocaleString('en-AE')}`;

  return (
    <PlatformShell email={session.email} active="tenants" tenantCount={tenants.length} branchCount={branchTotal}>
      {/* Header card */}
      <section className="flex flex-col gap-3 rounded border border-[#D9E3F6] bg-white p-5 shadow-sm xl:flex-row xl:items-center xl:justify-between">
        <div>
          <span className="inline-block rounded-sm bg-[#DEE9FC] px-2 py-0.5 text-[10px] font-bold uppercase tracking-widest text-[#003A3E]">
            Founder Console
          </span>
          <h1 className="mt-1.5 font-heading text-xl font-bold tracking-tight text-[#121C2A]">
            Tenant Fleet &amp; Account Directory
          </h1>
          <p className="text-sm text-[#404849]">
            Onboard restaurants, set their plan, and suspend the ones that stop paying.
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Link
            href="/admin/tenants/new"
            className="inline-flex h-11 items-center gap-2 rounded-sm bg-[#003A3E] px-4 text-sm font-bold text-white transition-colors hover:bg-[#0F5257]"
          >
            <Plus className="h-4 w-4" />
            New restaurant
          </Link>
        </div>
      </section>

      {/* KPIs */}
      <section className="mt-4 grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <Kpi icon={Building2} label="Total accounts" value={String(tenants.length)}>
          <span className="font-semibold text-[#176B4B]">{active} active</span>
          <Dot />
          <span className="text-[#B7691B]">{trial} trial</span>
          <Dot />
          <span className="font-semibold text-[#BA1A1A]">{suspended} suspended</span>
        </Kpi>
        <Kpi icon={Wallet} label="Monthly plan fees" value={aed(mrr)} iconTone="green">
          <span>Sum of active-account plan prices</span>
        </Kpi>
        <Kpi icon={GitBranch} label="Branches" value={String(branchTotal)}>
          <span>Across all tenants</span>
        </Kpi>
        <Kpi
          icon={TriangleAlert}
          label="Needs attention"
          value={String(attention)}
          iconTone="error"
          valueTone={attention > 0 ? 'error' : undefined}
        >
          <span>Past-due or suspended</span>
        </Kpi>
      </section>

      <div className="mt-4">
        <TenantDirectory tenants={tenants} />
      </div>
    </PlatformShell>
  );
}

function Dot() {
  return <span className="text-[#BFC8C9]">•</span>;
}

function Kpi({
  icon: Icon,
  label,
  value,
  children,
  iconTone,
  valueTone,
}: {
  icon: typeof Building2;
  label: string;
  value: string;
  children: React.ReactNode;
  iconTone?: 'green' | 'error';
  valueTone?: 'error';
}) {
  const iconClass =
    iconTone === 'green' ? 'text-[#176B4B]' : iconTone === 'error' ? 'text-[#BA1A1A]' : 'text-[#404849]';
  return (
    <div className="flex flex-col justify-between rounded border border-[#D9E3F6] bg-white p-4 shadow-sm">
      <div className="mb-2 flex items-center justify-between">
        <span className="text-[10px] font-bold uppercase tracking-widest text-[#404849]">{label}</span>
        <Icon className={`h-4 w-4 ${iconClass}`} />
      </div>
      <p
        className={`font-heading text-2xl font-bold tracking-tight ${
          valueTone === 'error' ? 'text-[#BA1A1A]' : 'text-[#121C2A]'
        }`}
      >
        {value}
      </p>
      <div className="mt-1 flex flex-wrap items-center gap-1.5 text-xs text-[#404849]">{children}</div>
    </div>
  );
}
