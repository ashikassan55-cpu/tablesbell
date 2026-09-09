'use client';

/**
 * src/components/cashier/alerts-inbox.tsx
 *
 * The Cashier's open-alert list. Rows now branch on `alert.type`:
 *
 *   - `bill_request` (ADR-7) — a party asked for the bill. Informational,
 *     teal, with a "Dismiss" that calls `resolveStaffAlert` via
 *     `onResolve`. No role gate beyond being signed in (any billing-
 *     capable staff member handles it; the server action re-checks).
 *   - everything else (`ghost_suspected` / `ghost_flagged` / `table_move`)
 *     — the original amber ghost-order treatment. The "Review" trigger is
 *     gated by `canExecuteBan()` (manager/owner + overrideAuth); a cashier
 *     sees the alert and an explanatory disabled state. This is the SAME
 *     role check `execute-ban-dialog.tsx` re-verifies on its own confirm
 *     handler — belt and suspenders, matching how the real backend never
 *     trusts a single check (ARCHITECTURE.md §8.2's IDOR gate).
 */

import { useNow } from '@/components/providers/clock-provider';
import { getElapsedSec, formatElapsed } from '@/lib/time';
import { canExecuteBan, type StaffIdentity } from '@/lib/console/staff-permissions';
import type { StaffAlert } from '@/types/firestore';

interface AlertsInboxProps {
  alerts: StaffAlert[];
  staff: StaffIdentity;
  onReview: (alert: StaffAlert) => void;
  onResolve: (alert: StaffAlert) => void;
}

export function AlertsInbox({ alerts, staff, onReview, onResolve }: AlertsInboxProps) {
  const now = useNow();
  const openAlerts = alerts.filter((alert) => alert.status === 'open');

  if (openAlerts.length === 0) {
    return (
      <div className="rounded-lg border border-[#E5E7EB] bg-white p-4 text-sm text-[#6B7280]">
        No open alerts.
      </div>
    );
  }

  return (
    <ul className="flex flex-col gap-2">
      {openAlerts.map((alert) =>
        alert.type === 'bill_request' ? (
          <li
            key={alert.id}
            className="flex items-start justify-between gap-3 rounded-lg border-2 border-[#0F5257] bg-white p-3"
          >
            <div className="min-w-0 flex-1">
              <p className="flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wide text-[#0F5257]">
                <span aria-hidden="true">🧾</span>
                Bill Requested · {alert.tableCode}
              </p>
              <p className="mt-1 text-sm text-[#1F2937]">{alert.note}</p>
              <p className="mt-1 text-xs tabular-nums text-[#9CA3AF]">
                {alert.reportedByRole} · {formatElapsed(getElapsedSec(alert.createdAt, now))} ago
              </p>
            </div>
            <button
              type="button"
              onClick={() => onResolve(alert)}
              className="flex h-11 shrink-0 items-center rounded-lg border border-[#E5E7EB] px-3 text-sm font-semibold text-[#1F2937]"
            >
              Dismiss
            </button>
          </li>
        ) : (
          <li
            key={alert.id}
            className="flex items-start justify-between gap-3 rounded-lg border-2 border-[#D97706] bg-white p-3"
          >
            <div className="min-w-0 flex-1">
              <p className="flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wide text-[#D97706]">
                <span aria-hidden="true">⚠</span>
                Suspected Ghost Order · {alert.tableCode}
              </p>
              <p className="mt-1 text-sm text-[#1F2937]">{alert.note}</p>
              <p className="mt-1 text-xs tabular-nums text-[#9CA3AF]">
                Reported by {alert.reportedByRole} · {formatElapsed(getElapsedSec(alert.createdAt, now))} ago
              </p>
            </div>

            {canExecuteBan(staff) ? (
              <button
                type="button"
                onClick={() => onReview(alert)}
                className="flex h-11 shrink-0 items-center rounded-lg bg-[#E5484D] px-3 text-sm font-semibold text-white"
              >
                Review
              </button>
            ) : (
              <span className="flex h-11 shrink-0 items-center rounded-lg border border-[#E5E7EB] px-3 text-center text-xs text-[#9CA3AF]">
                Manager required
              </span>
            )}
          </li>
        ),
      )}
    </ul>
  );
}
