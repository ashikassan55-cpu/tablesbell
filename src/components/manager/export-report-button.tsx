'use client';

import { Download } from 'lucide-react';
import type { ManagerOverview } from '@/server/services/manager-reports.service';

/**
 * Client-side CSV export of the current overview figures — the design's
 * "Export CSV / PDF" button, CSV half only. Builds the file in the
 * browser and triggers a download; no server round-trip.
 */
export function ExportReportButton({ data, branchName }: { data: ManagerOverview; branchName: string }) {
  function run() {
    const d = data.today;
    const money = (fils: number) => (fils / 100).toFixed(2);
    const lines: (string | number)[][] = [
      ['TableBells daily report', branchName, new Date(data.generatedAt).toISOString()],
      [],
      ['Metric', 'Today', 'Yesterday'],
      ['Orders', d.orderCount, data.yesterday.orderCount],
      ['Covers', d.covers, data.yesterday.covers],
      [`Gross revenue (${data.currency})`, money(d.grossFils), money(data.yesterday.grossFils)],
      [`Net revenue (${data.currency})`, money(d.netFils), ''],
      [`VAT (${data.currency})`, money(d.vatFils), ''],
      [`Avg order value (${data.currency})`, money(d.aovFils), money(data.yesterday.aovFils)],
      ['Avg prep seconds', d.avgPrepSeconds ?? '', ''],
      [],
      ['Last 7 days', 'Orders', `Revenue (${data.currency})`],
      ...data.week.map((w) => [w.date, w.count, money(w.revenueFils)]),
      [],
      ['Top items today', 'Qty', `Revenue (${data.currency})`],
      ...data.topItems.map((t) => [t.name, t.qty, money(t.revenueFils)]),
    ];
    const csv = lines
      .map((r) => r.map((c) => (/[",\n]/.test(String(c)) ? `"${String(c).replace(/"/g, '""')}"` : String(c))).join(','))
      .join('\r\n');
    const url = URL.createObjectURL(new Blob([csv], { type: 'text/csv;charset=utf-8;' }));
    const a = document.createElement('a');
    a.href = url;
    a.download = `tablebells-report-${new Date(data.generatedAt).toISOString().slice(0, 10)}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  }

  return (
    <button
      type="button"
      onClick={run}
      className="inline-flex h-10 items-center gap-2 rounded-lg bg-[#0F5257] px-4 text-sm font-bold text-white transition-colors hover:bg-[#093336]"
    >
      <Download className="h-4 w-4" />
      Export CSV
    </button>
  );
}
