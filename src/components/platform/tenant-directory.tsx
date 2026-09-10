'use client';

import { useMemo, useState } from 'react';
import Link from 'next/link';
import { Search, ArrowUpRight } from 'lucide-react';
import type { TenantSummary, TenantStatus } from '@/types/firestore';
import { planMeta } from '@/lib/platform/plans';

const STATUS_STYLES: Record<TenantStatus, string> = {
  trial: 'bg-[#FFE7D6] text-[#8E4E14]',
  active: 'bg-[#DDF3E4] text-[#1E6751]',
  past_due: 'bg-[#FDECEC] text-[#B4231F]',
  suspended: 'bg-[#FDECEC] text-[#B4231F]',
  churned: 'bg-[#E8E1DE] text-[#59413C]',
};

const STATUS_LABEL: Record<TenantStatus, string> = {
  trial: 'Trial',
  active: 'Active',
  past_due: 'Past due',
  suspended: 'Suspended',
  churned: 'Churned',
};

export function TenantDirectory({ tenants }: { tenants: TenantSummary[] }) {
  const [q, setQ] = useState('');
  const [status, setStatus] = useState<'all' | TenantStatus>('all');

  const filtered = useMemo(() => {
    const needle = q.trim().toLowerCase();
    return tenants.filter((t) => {
      if (status !== 'all' && t.status !== status) return false;
      if (!needle) return true;
      return (
        t.name.toLowerCase().includes(needle) ||
        t.slug.toLowerCase().includes(needle) ||
        t.ownerEmail.toLowerCase().includes(needle) ||
        t.city.toLowerCase().includes(needle)
      );
    });
  }, [tenants, q, status]);

  return (
    <div className="rounded-xl border border-[#E0BFB8] bg-white p-4 shadow-sm">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
        <div className="flex flex-1 items-center gap-2 rounded-lg border border-[#E0BFB8] bg-[#FAF2EF] px-3">
          <Search className="h-4 w-4 text-[#8D716B]" />
          <input
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Filter by name, slug, owner email, city…"
            className="w-full bg-transparent py-2.5 text-sm text-[#1E1B19] outline-none"
          />
        </div>
        <select
          value={status}
          onChange={(e) => setStatus(e.target.value as 'all' | TenantStatus)}
          className="rounded-lg border border-[#E0BFB8] bg-white px-3 py-2.5 text-sm font-medium text-[#1E1B19] outline-none"
        >
          <option value="all">All statuses</option>
          <option value="trial">Trial</option>
          <option value="active">Active</option>
          <option value="past_due">Past due</option>
          <option value="suspended">Suspended</option>
          <option value="churned">Churned</option>
        </select>
      </div>

      <div className="mt-3 overflow-x-auto">
        <table className="w-full min-w-[720px] text-left text-sm">
          <thead>
            <tr className="border-b border-[#E0BFB8] text-xs uppercase tracking-wide text-[#8D716B]">
              <th className="px-3 py-2 font-semibold">Restaurant</th>
              <th className="px-3 py-2 font-semibold">Plan</th>
              <th className="px-3 py-2 font-semibold">Status</th>
              <th className="px-3 py-2 font-semibold">Fee / mo</th>
              <th className="px-3 py-2 font-semibold">Branches</th>
              <th className="px-3 py-2 text-right font-semibold">Manage</th>
            </tr>
          </thead>
          <tbody>
            {filtered.length === 0 ? (
              <tr>
                <td colSpan={6} className="px-3 py-8 text-center text-sm text-[#8D716B]">
                  No restaurants match.
                </td>
              </tr>
            ) : (
              filtered.map((t) => (
                <tr key={t.id} className="border-b border-[#F4ECE9] last:border-0">
                  <td className="px-3 py-3">
                    <p className="font-semibold text-[#1E1B19]">{t.name}</p>
                    <p className="font-mono text-xs text-[#8D716B]">
                      /{t.slug || '—'} · {t.city || 'UAE'}
                    </p>
                  </td>
                  <td className="px-3 py-3 text-[#59413C]">{planMeta(t.plan).name}</td>
                  <td className="px-3 py-3">
                    <span
                      className={`inline-block rounded px-2 py-0.5 text-xs font-bold uppercase ${STATUS_STYLES[t.status]}`}
                    >
                      {STATUS_LABEL[t.status]}
                    </span>
                  </td>
                  <td className="px-3 py-3 font-medium text-[#1E1B19]">AED {t.monthlyFeeAed.toLocaleString('en-AE')}</td>
                  <td className="px-3 py-3 text-[#59413C]">{t.branchCount}</td>
                  <td className="px-3 py-3 text-right">
                    <Link
                      href={`/admin/tenants/${t.id}`}
                      className="inline-flex items-center gap-1 rounded-lg bg-[#F4ECE9] px-3 py-1.5 text-xs font-semibold text-[#E85D3F] hover:bg-[#EEE7E3]"
                    >
                      Manage <ArrowUpRight className="h-3.5 w-3.5" />
                    </Link>
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
