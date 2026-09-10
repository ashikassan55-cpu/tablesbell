import Link from 'next/link';
import {
  ShoppingBag,
  Banknote,
  Receipt,
  Timer,
  ArrowRight,
  ArrowUp,
  ArrowDown,
  CalendarDays,
  Flame,
  RefreshCw,
  BadgeCheck,
  Printer,
} from 'lucide-react';
import { formatMoney } from '@/lib/format/money';
import { OverviewChart } from '@/components/manager/overview-chart';
import { ExportReportButton } from '@/components/manager/export-report-button';
import type { ManagerOverview } from '@/server/services/manager-reports.service';

/**
 * src/components/manager/overview-dashboard.tsx
 *
 * The "Executive Reports & Daily Performance" landing view, matching the
 * Stitch design section-for-section: filter/action bar, 4 KPI cards with
 * day-over-day deltas, a 66/34 split of the 7-day volume chart and the
 * Top Selling Items panel, and a floor-ops status bar. Every figure is
 * real (today's priced orders for this branch); a section with nothing
 * to show renders its empty state rather than being hidden.
 */

function pctDelta(now: number, prev: number): number | null {
  if (prev <= 0) return now > 0 ? 100 : null;
  return Math.round(((now - prev) / prev) * 1000) / 10;
}

export function OverviewDashboard({
  tenantSlug,
  branchName,
  managerName,
  data,
}: {
  tenantSlug: string;
  branchName: string;
  managerName: string;
  data: ManagerOverview;
}) {
  const { today, yesterday, week, topItems, currency } = data;
  const money = (fils: number) => formatMoney(fils, currency);
  const dateStr = new Date(data.generatedAt).toLocaleDateString('en-AE', {
    weekday: 'short',
    day: 'numeric',
    month: 'short',
    year: 'numeric',
  });

  const topRevenue = topItems.reduce((s, t) => s + t.revenueFils, 0);
  const leadShare = topRevenue > 0 && topItems[0] ? Math.round((topItems[0].revenueFils / topRevenue) * 100) : 0;
  const maxItemRevenue = Math.max(1, ...topItems.map((t) => t.revenueFils));

  return (
    <div className="flex flex-col gap-4">
      {/* Filter / action bar */}
      <section className="flex flex-col gap-3 rounded-xl border border-[#E5E7EB] bg-white p-5 shadow-sm md:flex-row md:items-center md:justify-between">
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <span className="rounded bg-[#E5E7EB] px-2 py-0.5 text-[10px] font-bold uppercase tracking-widest text-[#0F5257]">
              {branchName}
            </span>
            <span className="inline-flex items-center gap-1 text-xs text-[#6B7280]">
              <span className="h-1.5 w-1.5 rounded-full bg-[#2E7D5B]" /> Live telemetry connected
            </span>
          </div>
          <h1 className="mt-1.5 text-xl font-bold tracking-tight text-[#1F2937]">
            Executive Reports &amp; Daily Performance
          </h1>
          <p className="mt-0.5 text-sm text-[#6B7280]">Operational analytics &amp; floor audit</p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <span className="inline-flex items-center gap-1.5 rounded-lg bg-[#F3F4F6] px-3 py-2 text-sm font-semibold text-[#1F2937]">
            <CalendarDays className="h-4 w-4 text-[#0F5257]" />
            Today ({dateStr})
          </span>
          <ExportReportButton data={data} branchName={branchName} />
        </div>
      </section>

      {/* KPI cards */}
      <section className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <Kpi
          icon={ShoppingBag}
          label="Today's orders"
          value={String(today.orderCount)}
          delta={pctDelta(today.orderCount, yesterday.orderCount)}
          foot={`${today.covers} covers`}
        />
        <Kpi
          icon={Banknote}
          label="Gross revenue"
          value={money(today.grossFils)}
          delta={pctDelta(today.grossFils, yesterday.grossFils)}
          foot={`Net ${money(today.netFils)}`}
        />
        <Kpi
          icon={Receipt}
          label="Average order value"
          value={today.orderCount > 0 ? money(today.aovFils) : '—'}
          delta={pctDelta(today.aovFils, yesterday.aovFils)}
          foot={`${today.orderCount} tickets`}
        />
        <Kpi
          icon={Timer}
          label="Avg prep time"
          value={today.avgPrepSeconds != null ? fmtDuration(today.avgPrepSeconds) : '—'}
          delta={null}
          foot={today.avgPrepSeconds != null ? 'order → ready' : 'no ready times yet'}
        />
      </section>

      {/* Chart + top sellers */}
      <section className="grid grid-cols-1 gap-4 lg:grid-cols-12">
        <div className="lg:col-span-8">
          <OverviewChart week={week} currency={currency} />
        </div>

        <div className="lg:col-span-4">
          <div className="flex h-full flex-col rounded-lg border border-[#E5E7EB] bg-white p-5 shadow-sm">
            <div className="flex items-start justify-between pb-3">
              <div>
                <h2 className="text-base font-bold text-[#1F2937]">Top Selling Items</h2>
                <p className="text-xs text-[#6B7280]">Today&apos;s kitchen velocity</p>
              </div>
              <Link
                href={`/${tenantSlug}/manager/menu`}
                className="inline-flex items-center gap-0.5 text-sm font-semibold text-[#0F5257] hover:underline"
              >
                All insights <ArrowRight className="h-4 w-4" />
              </Link>
            </div>

            {topItems.length === 0 ? (
              <p className="rounded-lg bg-[#F3F4F6] px-3 py-8 text-center text-sm text-[#6B7280]">
                No orders yet today. The board fills as tickets come in.
              </p>
            ) : (
              <ul className="flex flex-col gap-3">
                {topItems.map((it, i) => (
                  <li key={it.name + i}>
                    <div className="flex items-center gap-2.5">
                      <span
                        className={`flex h-6 w-6 shrink-0 items-center justify-center rounded-md text-[11px] font-bold ${
                          i === 0 ? 'bg-[#0F5257] text-white' : 'bg-[#DEE9FC] text-[#1F2937]'
                        }`}
                      >
                        {i + 1}
                      </span>
                      <div className="min-w-0 flex-1">
                        <p className="truncate text-sm font-semibold text-[#1F2937]">{it.name}</p>
                        <span className="rounded bg-[#F3F4F6] px-1.5 py-0.5 text-[10px] font-bold uppercase text-[#6B7280]">
                          {it.qty} sold
                        </span>
                      </div>
                      <span className="shrink-0 text-sm font-semibold tabular-nums text-[#1F2937]">
                        {money(it.revenueFils)}
                      </span>
                    </div>
                    <div className="mt-1.5 h-1.5 w-full overflow-hidden rounded-full bg-[#F3F4F6]">
                      <div
                        className="h-full rounded-full bg-[#96D0D6]"
                        style={{ width: `${Math.max(6, (it.revenueFils / maxItemRevenue) * 100)}%` }}
                      />
                    </div>
                  </li>
                ))}
              </ul>
            )}

            <div className="mt-4 flex items-center justify-between rounded-lg bg-[#F3F4F6] px-3 py-2.5">
              <span className="flex items-center gap-2 text-xs text-[#1F2937]">
                <Flame className="h-4 w-4 text-[#D97706]" />
                {topItems[0]
                  ? `${topItems[0].name} is ${leadShare}% of today's item revenue`
                  : 'Item mix appears once orders land'}
              </span>
              <span className="text-[10px] font-bold uppercase text-[#2E7D5B]">
                {topItems.length > 0 ? 'Live' : '—'}
              </span>
            </div>
          </div>
        </div>
      </section>

      {/* Floor ops bar */}
      <section className="flex flex-col items-center justify-between gap-3 rounded-lg border border-[#E5E7EB] bg-white px-5 py-3.5 text-sm text-[#6B7280] shadow-sm md:flex-row">
        <div className="flex flex-wrap items-center gap-x-5 gap-y-1.5">
          <span className="flex items-center gap-1.5">
            <span className="h-2 w-2 rounded-full bg-[#2E7D5B]" />
            <span className="font-medium text-[#1F2937]">KDS sync live</span>
          </span>
          <span className="flex items-center gap-1.5">
            <RefreshCw className="h-3.5 w-3.5" /> {data.openTables} open table{data.openTables === 1 ? '' : 's'}
          </span>
          <span className="flex items-center gap-1.5">
            <BadgeCheck className="h-3.5 w-3.5" />
            Manager on shift: <strong className="font-semibold text-[#1F2937]">{managerName}</strong>
          </span>
        </div>
        <Link
          href={`/${tenantSlug}/cashier`}
          className="inline-flex items-center gap-1.5 font-semibold text-[#0F5257] hover:text-[#093336]"
        >
          <Printer className="h-4 w-4" /> Open cashier &amp; close-out
        </Link>
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
  delta,
  foot,
}: {
  icon: typeof ShoppingBag;
  label: string;
  value: string;
  delta: number | null;
  foot: string;
}) {
  const up = delta != null && delta >= 0;
  return (
    <div className="rounded-xl border border-[#E5E7EB] bg-white p-4 shadow-sm">
      <div className="flex items-start justify-between">
        <span className="text-[10px] font-bold uppercase tracking-widest text-[#6B7280]">{label}</span>
        <span className="flex h-10 w-10 items-center justify-center rounded-xl bg-[#F3F4F6] text-[#0F5257]">
          <Icon className="h-[18px] w-[18px]" />
        </span>
      </div>
      <p className="mt-1 text-3xl font-bold tracking-tight tabular-nums text-[#1F2937]">{value}</p>
      <div className="mt-2 flex items-center justify-between">
        {delta == null ? (
          <span className="text-[11px] text-[#9CA3AF]">no comparison</span>
        ) : (
          <span
            className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-bold ${
              up ? 'bg-[#D1FAE5] text-[#2E7D5B]' : 'bg-[#FEE2E2] text-[#E5484D]'
            }`}
          >
            {up ? <ArrowUp className="h-3 w-3" /> : <ArrowDown className="h-3 w-3" />}
            {up ? '+' : ''}
            {delta}% vs yest.
          </span>
        )}
        <span className="text-xs text-[#6B7280]">{foot}</span>
      </div>
    </div>
  );
}
