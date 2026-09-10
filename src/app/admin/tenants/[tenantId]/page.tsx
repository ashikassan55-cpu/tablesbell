import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { ArrowLeft, ExternalLink } from 'lucide-react';
import { requirePlatformSession } from '@/server/services/resolve-platform-session';
import { getTenant } from '@/server/services/tenant.service';
import { PlatformShell } from '@/components/platform/platform-shell';
import { TenantPlanControls } from '@/components/platform/tenant-plan-controls';
import { TenantStatusControls } from '@/components/platform/tenant-status-controls';
import { planMeta } from '@/lib/platform/plans';
import type { TenantStatus } from '@/types/firestore';

export const metadata: Metadata = {
  title: 'Restaurant',
  robots: { index: false, follow: false },
};

export const dynamic = 'force-dynamic';

const STATUS_BADGE: Record<TenantStatus, string> = {
  trial: 'bg-[#FFE7D6] text-[#8E4E14]',
  active: 'bg-[#DDF3E4] text-[#1E6751]',
  past_due: 'bg-[#FDECEC] text-[#B4231F]',
  suspended: 'bg-[#FDECEC] text-[#B4231F]',
  churned: 'bg-[#E8E1DE] text-[#59413C]',
};

export default async function TenantDetailPage({
  params,
}: {
  params: Promise<{ tenantId: string }>;
}) {
  const { tenantId } = await params;
  const session = await requirePlatformSession();
  const tenant = await getTenant(tenantId);
  if (!tenant) notFound();

  const meta = planMeta(tenant.subscription?.plan);
  const sub = tenant.subscription ?? {
    plan: 'starter' as const,
    billingStatus: 'trialing' as const,
    monthlyFeeAed: meta.monthlyFeeAed,
    currentPeriodEnd: null,
    notes: '',
  };

  return (
    <PlatformShell email={session.email} active="tenants">
      <Link href="/admin" className="mb-4 inline-flex items-center gap-1 text-sm font-semibold text-[#E85D3F]">
        <ArrowLeft className="h-4 w-4" /> Directory
      </Link>

      <div className="rounded-xl border border-[#E0BFB8] bg-white p-6 shadow-sm">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <div className="flex flex-wrap items-center gap-2">
              <h1 className="font-heading text-2xl font-bold tracking-tight text-[#1E1B19]">{tenant.name}</h1>
              <span
                className={`rounded px-2 py-0.5 text-xs font-bold uppercase ${STATUS_BADGE[tenant.status] ?? ''}`}
              >
                {tenant.status}
              </span>
              <span className="rounded bg-[#F4ECE9] px-2 py-0.5 font-mono text-xs text-[#59413C]">
                {tenant.id}
              </span>
            </div>
            <p className="mt-1 text-sm text-[#59413C]">
              <span className="font-mono">/{tenant.slug}</span> · {tenant.city || 'UAE'} · owner {tenant.ownerName}
            </p>
          </div>
          <Link
            href={`/${tenant.slug}/lock`}
            target="_blank"
            className="inline-flex items-center gap-1.5 rounded-lg bg-[#F4ECE9] px-3 py-2 text-sm font-semibold text-[#1E1B19] hover:bg-[#EEE7E3]"
          >
            Open staff login <ExternalLink className="h-3.5 w-3.5" />
          </Link>
        </div>

        {tenant.status === 'suspended' && tenant.suspendReason ? (
          <p className="mt-3 rounded-lg bg-[#FDECEC] px-3 py-2 text-sm text-[#7A1E22]">
            Suspended: {tenant.suspendReason}
          </p>
        ) : null}

        <dl className="mt-5 grid gap-4 text-sm sm:grid-cols-3">
          <Cell k="Legal entity" v={tenant.legalEntity || '—'} />
          <Cell k="TRN" v={tenant.trn || '—'} mono />
          <Cell k="Owner email" v={tenant.ownerEmail || '—'} />
          <Cell k="Primary branch" v={tenant.primaryBranchId || '—'} mono />
          <Cell k="Created" v={tenant.createdAt ? new Date(tenant.createdAt).toLocaleDateString('en-AE') : '—'} />
          <Cell
            k="Current plan"
            v={`${meta.name} · AED ${sub.monthlyFeeAed}/mo · ${sub.billingStatus}`}
          />
        </dl>
      </div>

      <div className="mt-5 grid gap-5 lg:grid-cols-2">
        <TenantPlanControls tenantId={tenant.id} subscription={sub} />
        <TenantStatusControls tenantId={tenant.id} status={tenant.status} />
      </div>
    </PlatformShell>
  );
}

function Cell({ k, v, mono }: { k: string; v: string; mono?: boolean }) {
  return (
    <div>
      <dt className="text-xs uppercase tracking-wide text-[#8D716B]">{k}</dt>
      <dd className={`mt-0.5 text-[#1E1B19] ${mono ? 'font-mono' : ''}`}>{v}</dd>
    </div>
  );
}
