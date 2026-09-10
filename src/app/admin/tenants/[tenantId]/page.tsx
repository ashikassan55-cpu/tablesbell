import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { ArrowLeft, ExternalLink, Store, Building2, CalendarClock, Mail, IdCard } from 'lucide-react';
import { requirePlatformSession } from '@/server/services/resolve-platform-session';
import { getTenant } from '@/server/services/tenant.service';
import { adminDb } from '@/lib/firebase/admin';
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
  trial: 'bg-[#FFDCC3] text-[#7A3E00]',
  active: 'bg-[#A1F0C7] text-[#1D704F]',
  past_due: 'bg-[#FFDAD6] text-[#93000A]',
  suspended: 'bg-[#FFDAD6] text-[#93000A]',
  churned: 'bg-[#DEE9FC] text-[#404849]',
};

async function countBranches(tenantId: string): Promise<number> {
  try {
    const snap = await adminDb.collection(`tenants/${tenantId}/branches`).get();
    return snap.size;
  } catch {
    return 0;
  }
}

export default async function TenantDetailPage({ params }: { params: Promise<{ tenantId: string }> }) {
  const { tenantId } = await params;
  const session = await requirePlatformSession();
  const tenant = await getTenant(tenantId);
  if (!tenant) notFound();

  const branchCount = await countBranches(tenant.id);
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
      <Link href="/admin" className="mb-4 inline-flex items-center gap-1 text-sm font-semibold text-[#003A3E]">
        <ArrowLeft className="h-4 w-4" /> Back to Tenant Directory
      </Link>

      {/* Header */}
      <section className="flex flex-col gap-4 rounded border border-[#D9E3F6] bg-white p-5 shadow-sm xl:flex-row xl:items-center xl:justify-between">
        <div className="flex items-start gap-4">
          <span className="flex h-14 w-14 shrink-0 items-center justify-center rounded bg-[#003A3E] text-white">
            <Store className="h-7 w-7" />
          </span>
          <div>
            <div className="flex flex-wrap items-center gap-2">
              <h1 className="font-heading text-xl font-bold tracking-tight text-[#121C2A]">{tenant.name}</h1>
              <span className={`rounded-sm px-2 py-0.5 text-[10px] font-bold uppercase ${STATUS_BADGE[tenant.status] ?? ''}`}>
                {tenant.status}
              </span>
              <span className="rounded-sm bg-[#EFF4FF] px-2 py-0.5 font-mono text-[10px] font-bold uppercase text-[#404849]">
                {tenant.id}
              </span>
            </div>
            <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-[#404849]">
              <span className="font-mono font-semibold text-[#003A3E]">/{tenant.slug}</span>
              <span className="text-[#BFC8C9]">•</span>
              <span>Created {tenant.createdAt ? new Date(tenant.createdAt).toLocaleDateString('en-AE') : '—'}</span>
              <span className="text-[#BFC8C9]">•</span>
              <span>{branchCount} branch{branchCount === 1 ? '' : 'es'}</span>
            </div>
          </div>
        </div>
        <Link
          href={`/${tenant.slug}/lock`}
          target="_blank"
          className="inline-flex h-11 items-center gap-1.5 self-start rounded-sm border border-[#BFC8C9] bg-[#EFF4FF] px-3 text-sm font-semibold text-[#121C2A] hover:bg-[#DEE9FC] xl:self-center"
        >
          Open staff login <ExternalLink className="h-3.5 w-3.5" />
        </Link>
      </section>

      {tenant.status === 'suspended' && tenant.suspendReason ? (
        <p className="mt-3 rounded-sm bg-[#FFDAD6] px-3 py-2 text-sm text-[#7A1E22]">
          Suspended: {tenant.suspendReason}
        </p>
      ) : null}

      {/* Profile + plan */}
      <div className="mt-4 grid gap-4 xl:grid-cols-2">
        <section className="rounded border border-[#D9E3F6] bg-white p-5 shadow-sm">
          <div className="flex items-center gap-2 pb-3">
            <IdCard className="h-5 w-5 text-[#003A3E]" />
            <h2 className="font-heading text-base font-bold text-[#121C2A]">Restaurant profile</h2>
          </div>
          <dl className="grid gap-2">
            <Spec icon={Building2} k="Legal entity" v={tenant.legalEntity || '—'} />
            <Spec icon={IdCard} k="Tax registration (TRN)" v={tenant.trn || '—'} mono />
            <Spec icon={Store} k="Owner" v={tenant.ownerName || '—'} />
            <Spec icon={Mail} k="Owner email" v={tenant.ownerEmail || '—'} />
            <Spec icon={Building2} k="Primary branch" v={tenant.primaryBranchId || '—'} mono />
            <Spec icon={CalendarClock} k="City" v={tenant.city || 'UAE'} />
          </dl>
        </section>

        <TenantPlanControls tenantId={tenant.id} subscription={sub} />
      </div>

      <div className="mt-4">
        <TenantStatusControls tenantId={tenant.id} status={tenant.status} />
      </div>
    </PlatformShell>
  );
}

function Spec({
  icon: Icon,
  k,
  v,
  mono,
}: {
  icon: typeof Store;
  k: string;
  v: string;
  mono?: boolean;
}) {
  return (
    <div className="flex items-start gap-2 rounded-sm bg-[#EFF4FF] p-2.5">
      <Icon className="mt-0.5 h-4 w-4 shrink-0 text-[#707979]" />
      <div className="min-w-0">
        <dt className="text-[10px] font-bold uppercase tracking-wide text-[#707979]">{k}</dt>
        <dd className={`text-sm text-[#121C2A] ${mono ? 'font-mono' : ''}`}>{v}</dd>
      </div>
    </div>
  );
}
