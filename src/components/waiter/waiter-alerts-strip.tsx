'use client';

/**
 * src/components/waiter/waiter-alerts-strip.tsx
 *
 * The Waiter Floor's slim alert strip (ADR-7). The waiter has no full
 * alerts inbox — that stays a Cashier surface — but a `bill_request`
 * alert HAS to reach the floor, because the waiter standing by the table
 * is who walks the bill over. So this renders ONLY `type ===
 * 'bill_request'` rows from the shared `staffAlerts` listener
 * (`use-live-waiter-data`); ghost-order alerts are filtered out here.
 *
 * "Dismiss" calls `resolveStaffAlert` (same action the Cashier inbox
 * uses). Optimistically hidden; the live listener drops it for good once
 * the doc flips to `status: 'resolved'`, and a rejection re-shows it.
 */

import { useState } from 'react';
import { resolveStaffAlert } from '@/server/actions/bill.actions';
import type { StaffAlert } from '@/types/firestore';

interface WaiterAlertsStripProps {
  alerts: StaffAlert[];
  branchId: string;
}

export function WaiterAlertsStrip({ alerts, branchId }: WaiterAlertsStripProps) {
  const [dismissed, setDismissed] = useState<Set<string>>(new Set());
  const [busyId, setBusyId] = useState<string | null>(null);

  const billRequests = alerts.filter(
    (alert) => alert.type === 'bill_request' && alert.status === 'open' && !dismissed.has(alert.id),
  );

  if (billRequests.length === 0) return null;

  async function handleDismiss(alert: StaffAlert) {
    if (busyId) return;
    setBusyId(alert.id);
    setDismissed((prev) => new Set(prev).add(alert.id));
    const result = await resolveStaffAlert({ branchId, alertId: alert.id });
    setBusyId(null);
    if (result.outcome === 'rejected') {
      setDismissed((prev) => {
        const next = new Set(prev);
        next.delete(alert.id);
        return next;
      });
    }
  }

  return (
    <section>
      <h2 className="mb-2 text-xs font-semibold uppercase tracking-wide text-[#6B7280]">Bill Requests</h2>
      <ul className="flex flex-col gap-2">
        {billRequests.map((alert) => (
          <li
            key={alert.id}
            className="flex items-center justify-between gap-3 rounded-lg border-2 border-[#0F5257] bg-white p-3"
          >
            <p className="min-w-0 flex-1 text-sm text-[#1F2937]">
              <span className="font-semibold">{alert.tableCode}</span> · {alert.note}
            </p>
            <button
              type="button"
              onClick={() => handleDismiss(alert)}
              disabled={busyId === alert.id}
              className="flex h-10 shrink-0 items-center rounded-lg border border-[#E5E7EB] px-3 text-sm font-semibold text-[#1F2937] disabled:opacity-50"
            >
              {busyId === alert.id ? 'Dismissing…' : 'Dismiss'}
            </button>
          </li>
        ))}
      </ul>
    </section>
  );
}
