import { ShoppingBag, Banknote, Receipt, Timer, ArrowRight } from 'lucide-react';
import Link from 'next/link';
import { formatMoney } from '@/lib/format/money';
import type { ManagerOverview } from '@/server/services/manager-reports.service';

/**
 * src/components/manager/overview-dashboard.tsx
 *
 * Presentational — renders the `getManagerOverview` result as the
 * "Executive Reports & Daily Performance" landing view. Every figure is
 * real (today's priced orders for this branch); the design's fake
 * telemetry (peak-record targets, SLA %, "rush target") is dropped
 * rather than faked.
 */

export function OverviewDashboard({
  tenantSlug,
  branchName,
  data,
}: {
  tenantSlug: string;
  branchName: string;
  data: ManagerOverview;
}) {
  const { today, week, topItems, currency } = data;
  const money = (fils: number) => formatMoney(fils, currency);
  const maxWeek = Math.max(1, ...week.map((d) => d.count));
  const peak = week.reduce((a, b) => (b.count > a.count ? b : a), week[0]);
  const low = week.reduce((a, b) => (b.count < a.count ? b : a), week[0]);
  const todayStr = new Date(data.generatedAt).toLocaleDateString('en-AE', {
    weekday: 'long',
    day: 'numeric',
    month: 'short',
  });

  return (
    <div className="flex flex-col gap-4">
      {/* Header */}
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div>
          <span className="inline-block rounded bg-[#E5E7EB] px-2 py-0.5 text-[10px] font-bold uppercase tracking-widest text-[#0F5257]">
            {branchName}
          </span>
          <h1 className="mt-1.5 text-xl font-bold tracking-tight text-[#1F2937]">
            Executive Reports &amp; Daily Performance
          </h1>
          <p className="text-sm text-[#6B7280]">
            {todayStr} · figures reset at Dubai midnight
          </p>
        </div>
        <div className="flex items-center gap-2 text-xs text-[#6B7280]">
          <span className="rounded bg-white px-2 py-1 font-semibold text-[#1F2937] ring-1 ring-[#E5E7EB]">
            {data.openTables} open table{data.openTables === 1 ? '' : 's'}
          </span>
          <span
            className={`rounded px-2 py-1 font-semibold ring-1 ${
              data.openAlerts > 0
                ? 'bg-[#FEE2E2] text-[#E5484D] ring-[#FCA5A5]'
                : 'bg-white text-[#1F2937] ring-[#E5E7EB]'
            }`}
          >
            {data.openAlerts} unresolved call{data.openAlerts === 1 ? '' : 's'}
          </span>
        </div>
      </div>

      {/* KPIs */}
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <Kpi icon={ShoppingBag} label="Today's orders" value={String(today.orderCount)} sub={`${today.covers} covers`} />
        <Kpi
          icon={Banknote}
          label="Gross revenue"
          value={money(today.grossFils)}
          sub={`Net ${money(today.netFils)}`}
        />
        <Kpi
          icon={Receipt}
          label="Avg order value"
          value={today.orderCount > 0 ? money(today.aovFils) : '—'}
          sub={`${today.orderCount} tickets`}
        />
        <Kpi
          icon={Timer}
          label="Avg prep time"
          value={today.avgPrepSeconds != null ? fmtDuration(today.avgPrepSeconds) : '—'}
          sub={today.avgPrepSeconds != null ? 'order → ready' : 'no ready times yet'}
        />
      </div>

      {/* Week volume */}
      <section className="rounded-lg border border-[#E5E7EB] bg-white p-5 shadow-sm">
        <div className="flex items-center justify-between">
          <h2 className="text-base font-bold text-[#1F2937]">Order volume · last 7 days</h2>
          <span className="rounded bg-[#E5E7EB] px-2 py-0.5 text-[10px] font-bold uppercase text-[#4B5563]">
            {peak.label} {peak.count} peak · {low.label} {low.count} low
          </span>
        </div>
        <div className="mt-4 flex items-end gap-2" style={{ height: 132 }}>
          {week.map((d) => (
            <div key={d.date} className="flex flex-1 flex-col items-center gap-1.5">
              <span className="text-[11px] font-semibold tabular-nums text-[#6B7280]">{d.count}</span>
              <div
                className={`w-full rounded-t ${d.isToday ? 'bg-[#0F5257]' : 'bg-[#96D0D6]'}`}
                style={{ height: `${Math.max(4, (d.count / maxWeek) * 100)}%` }}
              />
              <span className={`text-[11px] ${d.isToday ? 'font-bold text-[#0F5257]' : 'text-[#6B7280]'}`}>
                {d.label}
              </span>
            </div>
          ))}
        </div>
      </section>

      {/* Top items */}
      <section className="rounded-lg border border-[#E5E7EB] bg-white p-5 shadow-sm">
        <div className="flex items-center justify-between">
          <div>
            <h2 className="text-base font-bold text-[#1F2937]">Top selling items</h2>
            <p className="text-xs text-[#6B7280]">By revenue, today</p>
          </div>
          <Link
            href={`/${tenantSlug}/manager/menu`}
            className="inline-flex items-center gap-0.5 text-sm font-semibold text-[#0F5257] hover:underline"
          >
            Manage menu <ArrowRight className="h-4 w-4" />
          </Link>
        </div>

        {topItems.length === 0 ? (
          <p className="mt-4 rounded-lg bg-[#F3F4F6] px-3 py-6 text-center text-sm text-[#6B7280]">
            No orders yet today. The board fills as tickets come in.
          </p>
        ) : (
          <ul className="mt-3 divide-y divide-[#E5E7EB]">
            {topItems.map((it, i) => (
              <li key={it.name + i} className="flex items-center gap-3 py-2.5">
                <span
                  className={`flex h-6 w-6 shrink-0 items-center justify-center rounded-md text-[11px] font-bold ${
                    i === 0 ? 'bg-[#0F5257] text-white' : 'bg-[#E5E7EB] text-[#1F2937]'
                  }`}
                >
                  {i + 1}
                </span>
                <span className="min-w-0 flex-1 truncate text-sm font-semibold text-[#1F2937]">{it.name}</span>
                <span className="shrink-0 text-xs text-[#6B7280]">{it.qty} sold</span>
                <span className="shrink-0 text-sm font-semibold tabular-nums text-[#1F2937]">
                  {money(it.revenueFils)}
                </span>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}

function fmtDuration(sec: number): string {
  const m = Math.floor(sec / 60);
  const s = sec % 60;
  return m > 0 ? `${m}m ${String(s).padStart(2, '0')}s` : `${s}s`;
}

function Kpi({
  icon: Icon,
  label,
  value,
  sub,
}: {
  icon: typeof ShoppingBag;
  label: string;
  value: string;
  sub: string;
}) {
  return (
    <div className="rounded-lg border border-[#E5E7EB] bg-white p-4 shadow-sm">
      <div className="flex items-start justify-between">
        <span className="text-[10px] font-bold uppercase tracking-widest text-[#6B7280]">{label}</span>
        <span className="flex h-9 w-9 items-center justify-center rounded-lg bg-[#F3F4F6] text-[#0F5257]">
          <Icon className="h-4 w-4" />
        </span>
      </div>
      <p className="mt-1.5 text-2xl font-bold tracking-tight tabular-nums text-[#1F2937]">{value}</p>
      <p className="mt-0.5 text-xs text-[#6B7280]">{sub}</p>
    </div>
  );
}
