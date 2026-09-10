'use client';

import { useMemo, useRef, useState, useTransition } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { Search, Download, MoreVertical, ArrowUpRight, Power, PlayCircle } from 'lucide-react';
import type { TenantSummary, TenantStatus, SubscriptionPlan } from '@/types/firestore';
import { planMeta, PLAN_IDS } from '@/lib/platform/plans';
import { setTenantStatus } from '@/server/actions/platform.actions';

const STATUS_STYLES: Record<TenantStatus, string> = {
  trial: 'bg-[#FFDCC3] text-[#7A3E00]',
  active: 'bg-[#A1F0C7] text-[#1D704F]',
  past_due: 'bg-[#FFDAD6] text-[#93000A]',
  suspended: 'bg-[#FFDAD6] text-[#93000A]',
  churned: 'bg-[#DEE9FC] text-[#404849]',
};
const STATUS_LABEL: Record<TenantStatus, string> = {
  trial: 'Trial',
  active: 'Active',
  past_due: 'Past due',
  suspended: 'Suspended',
  churned: 'Churned',
};

function csvCell(v: string | number): string {
  const s = String(v);
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

export function TenantDirectory({ tenants }: { tenants: TenantSummary[] }) {
  const router = useRouter();
  const [q, setQ] = useState('');
  const [status, setStatus] = useState<'all' | TenantStatus>('all');
  const [plan, setPlan] = useState<'all' | SubscriptionPlan>('all');
  const [openMenu, setOpenMenu] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const searchRef = useRef<HTMLInputElement>(null);

  const filtered = useMemo(() => {
    const needle = q.trim().toLowerCase();
    return tenants.filter((t) => {
      if (status !== 'all' && t.status !== status) return false;
      if (plan !== 'all' && t.plan !== plan) return false;
      if (!needle) return true;
      return (
        t.name.toLowerCase().includes(needle) ||
        t.slug.toLowerCase().includes(needle) ||
        t.ownerEmail.toLowerCase().includes(needle) ||
        t.city.toLowerCase().includes(needle) ||
        t.id.toLowerCase().includes(needle)
      );
    });
  }, [tenants, q, status, plan]);

  function exportCsv() {
    const header = [
      'tenant_id',
      'name',
      'slug',
      'status',
      'plan',
      'billing_status',
      'monthly_fee_aed',
      'owner_name',
      'owner_email',
      'city',
      'branches',
      'created_at',
    ];
    const rows = filtered.map((t) => [
      t.id,
      t.name,
      t.slug,
      t.status,
      t.plan,
      t.billingStatus,
      t.monthlyFeeAed,
      t.ownerName,
      t.ownerEmail,
      t.city,
      t.branchCount,
      t.createdAt ? new Date(t.createdAt).toISOString() : '',
    ]);
    const csv = [header, ...rows].map((r) => r.map(csvCell).join(',')).join('\r\n');
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `tablebells-tenants-${new Date().toISOString().slice(0, 10)}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  }

  function quickStatus(t: TenantSummary, next: TenantStatus) {
    setOpenMenu(null);
    const verb = next === 'suspended' ? 'Suspend' : 'Reactivate';
    if (!window.confirm(`${verb} “${t.name}”? This takes effect immediately.`)) return;
    startTransition(async () => {
      const res = await setTenantStatus({
        tenantId: t.id,
        status: next,
        reason: next === 'suspended' ? 'Suspended from directory' : '',
      });
      if (res.outcome === 'updated') router.refresh();
      else window.alert(res.message);
    });
  }

  const selectClass =
    'h-11 rounded-sm border border-[#BFC8C9] bg-[#EFF4FF] px-2 text-sm font-medium text-[#121C2A] outline-none focus:border-[#0F5257]';

  return (
    <div className="rounded border border-[#D9E3F6] bg-white p-3 shadow-sm">
      {/* Filters */}
      <div className="flex flex-col gap-2 lg:flex-row lg:items-center">
        <div className="flex flex-1 items-center gap-2 rounded-sm border border-[#BFC8C9] bg-[#EFF4FF] px-3">
          <Search className="h-4 w-4 text-[#707979]" />
          <input
            ref={searchRef}
            id="tenant-search"
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Filter by name, slug, tenant id, owner email, city…"
            className="w-full bg-transparent py-2.5 text-sm text-[#121C2A] outline-none placeholder:text-[#707979]"
          />
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <select value={plan} onChange={(e) => setPlan(e.target.value as 'all' | SubscriptionPlan)} className={selectClass}>
            <option value="all">All plans</option>
            {PLAN_IDS.map((p) => (
              <option key={p} value={p}>
                {planMeta(p).name}
              </option>
            ))}
          </select>
          <select value={status} onChange={(e) => setStatus(e.target.value as 'all' | TenantStatus)} className={selectClass}>
            <option value="all">All statuses</option>
            <option value="trial">Trial</option>
            <option value="active">Active</option>
            <option value="past_due">Past due</option>
            <option value="suspended">Suspended</option>
            <option value="churned">Churned</option>
          </select>
          <button
            type="button"
            onClick={() => {
              setQ('');
              setStatus('all');
              setPlan('all');
            }}
            className="h-11 rounded-sm px-3 text-sm font-medium text-[#404849] hover:bg-[#EFF4FF]"
          >
            Reset
          </button>
          <button
            type="button"
            onClick={exportCsv}
            className="inline-flex h-11 items-center gap-1.5 rounded-sm border border-[#BFC8C9] bg-[#EFF4FF] px-3 text-sm font-semibold text-[#121C2A] hover:bg-[#DEE9FC]"
          >
            <Download className="h-4 w-4" />
            Export CSV
          </button>
        </div>
      </div>

      {/* Table */}
      <div className="mt-3 overflow-x-auto">
        <table className="w-full min-w-[860px] text-left text-sm">
          <thead>
            <tr className="bg-[#DEE9FC] text-[10px] uppercase tracking-widest text-[#404849]">
              <th className="px-3 py-2.5 font-bold">Restaurant &amp; slug</th>
              <th className="px-3 py-2.5 font-bold">Tier</th>
              <th className="px-3 py-2.5 font-bold">Status</th>
              <th className="px-3 py-2.5 font-bold">Branches</th>
              <th className="px-3 py-2.5 font-bold">Fee / mo</th>
              <th className="px-3 py-2.5 font-bold">Created</th>
              <th className="px-3 py-2.5 text-right font-bold">Founder actions</th>
            </tr>
          </thead>
          <tbody>
            {filtered.length === 0 ? (
              <tr>
                <td colSpan={7} className="px-3 py-10 text-center text-sm text-[#707979]">
                  No restaurants match these filters.
                </td>
              </tr>
            ) : (
              filtered.map((t) => (
                <tr key={t.id} className="border-b border-[#EFF4FF] transition-colors hover:bg-[#EFF4FF]/60">
                  <td className="px-3 py-2.5">
                    <p className="font-semibold text-[#121C2A]">{t.name}</p>
                    <p className="font-mono text-xs text-[#707979]">
                      /{t.slug || '—'} · {t.id} · {t.city || 'UAE'}
                    </p>
                  </td>
                  <td className="px-3 py-2.5 text-[#404849]">{planMeta(t.plan).name}</td>
                  <td className="px-3 py-2.5">
                    <span className={`inline-block rounded-sm px-2 py-0.5 text-[10px] font-bold uppercase ${STATUS_STYLES[t.status]}`}>
                      {STATUS_LABEL[t.status]}
                    </span>
                  </td>
                  <td className="px-3 py-2.5 font-mono text-[#404849]">{t.branchCount}</td>
                  <td className="px-3 py-2.5 font-medium text-[#121C2A]">
                    AED {t.monthlyFeeAed.toLocaleString('en-AE')}
                  </td>
                  <td className="px-3 py-2.5 text-[#404849]">
                    {t.createdAt ? new Date(t.createdAt).toLocaleDateString('en-AE') : '—'}
                  </td>
                  <td className="px-3 py-2.5">
                    <div className="flex items-center justify-end gap-1.5">
                      <Link
                        href={`/admin/tenants/${t.id}`}
                        className="inline-flex items-center gap-1 rounded-sm bg-[#003A3E] px-2.5 py-1.5 text-xs font-bold text-white hover:bg-[#0F5257]"
                      >
                        Manage <ArrowUpRight className="h-3.5 w-3.5" />
                      </Link>
                      <div className="relative">
                        <button
                          type="button"
                          onClick={() => setOpenMenu(openMenu === t.id ? null : t.id)}
                          className="rounded-sm p-1.5 text-[#404849] hover:bg-[#DEE9FC]"
                          aria-label="More actions"
                        >
                          <MoreVertical className="h-4 w-4" />
                        </button>
                        {openMenu === t.id ? (
                          <div className="absolute right-0 z-10 mt-1 w-44 rounded-sm border border-[#BFC8C9] bg-white py-1 text-left shadow-lg">
                            {t.status === 'suspended' || t.status === 'churned' ? (
                              <button
                                type="button"
                                disabled={pending}
                                onClick={() => quickStatus(t, 'active')}
                                className="flex w-full items-center gap-2 px-3 py-1.5 text-sm text-[#1D704F] hover:bg-[#EFF4FF] disabled:opacity-50"
                              >
                                <PlayCircle className="h-4 w-4" /> Reactivate
                              </button>
                            ) : (
                              <button
                                type="button"
                                disabled={pending}
                                onClick={() => quickStatus(t, 'suspended')}
                                className="flex w-full items-center gap-2 px-3 py-1.5 text-sm text-[#93000A] hover:bg-[#FFDAD6]/50 disabled:opacity-50"
                              >
                                <Power className="h-4 w-4" /> Suspend
                              </button>
                            )}
                            <Link
                              href={`/admin/tenants/${t.id}`}
                              className="flex items-center gap-2 px-3 py-1.5 text-sm text-[#121C2A] hover:bg-[#EFF4FF]"
                            >
                              Open detail
                            </Link>
                          </div>
                        ) : null}
                      </div>
                    </div>
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>

      <p className="mt-2 px-1 text-xs text-[#707979]">
        {filtered.length} of {tenants.length} shown{pending ? ' · updating…' : ''}
      </p>
    </div>
  );
}
