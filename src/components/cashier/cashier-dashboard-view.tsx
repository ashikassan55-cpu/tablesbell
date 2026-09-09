'use client';

/**
 * src/components/cashier/cashier-dashboard-view.tsx
 *
 * LIVE-WIRED (2026-09-09). Staff identity comes from the verified
 * `tb_staff` session (`staff` prop); floor data comes from real
 * `onSnapshot` listeners (`useLiveCashierData` → `tables`, `sessions`,
 * `orders`, `staffAlerts` for the branch). No `useState`-seeded mock
 * arrays remain here.
 *
 * WHY THE MUTATION HANDLERS GOT SIMPLER: with `orders` now a live
 * listener, `handleVoidLine` no longer does an optimistic `splitInclusive`
 * recompute or special-case an `ORDER_NOT_FOUND` against mock ids — it
 * calls the real `voidTicketLine` and lets the listener reflect the
 * result, exactly like KDS's `handleAdvance`. Only genuine rejections
 * (`ROLE_NOT_PERMITTED`, …) surface in the status line now.
 *
 * `handleExecuteBan` is STILL a mock consequence — `flagGhostOrder` is
 * out of this pass's scope (MEMORY.md §2 item 7). Since the alerts list
 * is now a live listener we can't mutate it locally, so a reviewed alert
 * is hidden via a local `dismissedAlertIds` set until the real
 * `flagGhostOrder` writes `status: 'resolved'` to the document.
 */

import { useState } from 'react';
import { ClockProvider } from '@/components/providers/clock-provider';
import { TableOverviewGrid } from './table-overview-grid';
import { TableDetailPanel } from './table-detail-panel';
import { AlertsInbox } from './alerts-inbox';
import { ExecuteBanDialog } from './execute-ban-dialog';
import { LockSwitchButton } from '@/components/console/lock-switch-button';
import { voidTicketLine, resolveStaffAlert } from '@/server/actions/bill.actions';
import { roleLabel, type StaffIdentity } from '@/lib/console/staff-permissions';
import { useLiveCashierData } from '@/hooks/use-live-cashier-data';
import type { VoidReasonCode } from '@/lib/console/void-reasons';
import type { StaffAlert } from '@/types/firestore';

interface CashierDashboardViewProps {
  tenantSlug: string;
  staff: StaffIdentity;
  tenantId: string;
  branchId: string | null;
}

export function CashierDashboardView({ tenantSlug, staff, tenantId, branchId }: CashierDashboardViewProps) {
  if (!branchId) {
    return (
      <div className="flex min-h-dvh items-center justify-center bg-[#F3F4F6] px-6 text-center">
        <p className="text-sm text-[#6B7280]">Your account has no branch assigned. Contact a manager.</p>
      </div>
    );
  }

  return (
    <ClockProvider>
      <CashierDashboardBody tenantSlug={tenantSlug} staff={staff} tenantId={tenantId} branchId={branchId} />
    </ClockProvider>
  );
}

interface VoidStatus {
  orderCode: string;
  message: string;
  tone: 'ok' | 'warn' | 'error';
}

function DashboardShell({ tenantSlug, message }: { tenantSlug: string; message: string }) {
  return (
    <div className="flex min-h-dvh flex-col bg-[#F3F4F6]">
      <header className="border-b border-[#E5E7EB] bg-white px-4 py-3">
        <h1 className="text-lg font-bold text-[#1F2937]">Cashier Console</h1>
        <p className="text-xs text-[#6B7280]">{tenantSlug} · Front of house</p>
      </header>
      <div className="flex flex-1 items-center justify-center px-6 text-center">
        <p className="text-sm text-[#6B7280]">{message}</p>
      </div>
    </div>
  );
}

function CashierDashboardBody({
  tenantSlug,
  staff,
  tenantId,
  branchId,
}: {
  tenantSlug: string;
  staff: StaffIdentity;
  tenantId: string;
  branchId: string;
}) {
  const live = useLiveCashierData(tenantId, branchId);
  const [selectedTableId, setSelectedTableId] = useState<string | null>(null);
  const [reviewingAlert, setReviewingAlert] = useState<StaffAlert | null>(null);
  const [dismissedAlertIds, setDismissedAlertIds] = useState<Set<string>>(new Set());
  const [voidStatus, setVoidStatus] = useState<VoidStatus | null>(null);

  const selectedTable = live.tables.find((table) => table.id === selectedTableId) ?? null;
  const selectedTableOrders = selectedTable
    ? live.orders.filter((order) => order.tableId === selectedTable.id)
    : [];
  const visibleAlerts = live.alerts.filter((alert) => !dismissedAlertIds.has(alert.id));

  function handleExecuteBan({ alertId }: { alertId: string; rotateSlug: boolean }) {
    // Mock consequence only — real effect is `flagGhostOrder` (out of
    // scope this pass). Hide the reviewed alert locally; the live
    // listener will drop it for real once the document flips to
    // 'resolved'.
    setDismissedAlertIds((prev) => new Set(prev).add(alertId));
    setReviewingAlert(null);
  }

  async function handleResolveAlert(alert: StaffAlert) {
    // Real write (ADR-7) for a `bill_request` alert's "Dismiss". Hide it
    // optimistically; the live listener drops it for good once the doc's
    // `status` flips to 'resolved'. A rejection re-shows it.
    setDismissedAlertIds((prev) => new Set(prev).add(alert.id));
    const result = await resolveStaffAlert({ branchId, alertId: alert.id });
    if (result.outcome === 'rejected') {
      setDismissedAlertIds((prev) => {
        const next = new Set(prev);
        next.delete(alert.id);
        return next;
      });
      setVoidStatus({ orderCode: alert.tableCode, message: `Couldn't dismiss alert: ${result.reason}.`, tone: 'error' });
    }
  }

  async function handleVoidLine(orderId: string, lineId: string, reason: VoidReasonCode, note: string) {
    const order = live.orders.find((o) => o.id === orderId);
    const orderCode = order?.code ?? orderId;

    const result = await voidTicketLine({ branchId, orderId, lineId, reason, note });

    if (result.outcome === 'voided') {
      setVoidStatus({
        orderCode,
        message: result.orderVoided ? 'Line voided — ticket fully voided and cleared.' : 'Line voided and audited.',
        tone: 'ok',
      });
    } else if (result.outcome === 'already_voided') {
      setVoidStatus({ orderCode, message: 'That line was already voided.', tone: 'warn' });
    } else {
      setVoidStatus({ orderCode, message: `Void rejected: ${result.reason}.`, tone: 'error' });
    }
    // No local recompute — the `orders` listener reflects the real
    // document the instant Firestore propagates the write.
  }

  if (live.status === 'loading') {
    return <DashboardShell tenantSlug={tenantSlug} message="Loading the floor…" />;
  }
  if (live.status === 'error') {
    return <DashboardShell tenantSlug={tenantSlug} message="Couldn't load live floor data. Check your connection." />;
  }

  return (
    <div className="flex min-h-dvh flex-col bg-[#F3F4F6]">
      <header className="flex items-center justify-between border-b border-[#E5E7EB] bg-white px-4 py-3">
        <div>
          <h1 className="text-lg font-bold text-[#1F2937]">Cashier Console</h1>
          <p className="text-xs text-[#6B7280]">{tenantSlug} · Front of house</p>
        </div>
        <div className="flex items-center gap-3">
          <div className="text-end">
            <p className="text-sm font-semibold text-[#1F2937]">{staff.displayName}</p>
            <p className="text-xs text-[#6B7280]">{roleLabel(staff.role)}</p>
          </div>
          <LockSwitchButton tenantSlug={tenantSlug} />
        </div>
      </header>

      <main className="flex-1 space-y-6 px-4 py-4">
        {voidStatus ? (
          <p
            className={[
              'rounded-lg border px-3 py-2 text-sm',
              voidStatus.tone === 'ok'
                ? 'border-[#0F5257]/30 bg-[#ECFDF5] text-[#065F46]'
                : voidStatus.tone === 'warn'
                  ? 'border-[#D97706]/30 bg-[#FFFBEB] text-[#92400E]'
                  : 'border-[#E5484D]/30 bg-[#FDECEC] text-[#7A1E22]',
            ].join(' ')}
          >
            <span className="font-semibold">#{voidStatus.orderCode}:</span> {voidStatus.message}
          </p>
        ) : null}

        <section>
          <h2 className="mb-2 text-xs font-semibold uppercase tracking-wide text-[#6B7280]">Alerts</h2>
          <AlertsInbox
            alerts={visibleAlerts}
            staff={staff}
            onReview={setReviewingAlert}
            onResolve={handleResolveAlert}
          />
        </section>

        <section>
          <h2 className="mb-2 text-xs font-semibold uppercase tracking-wide text-[#6B7280]">Tables</h2>
          <TableOverviewGrid tables={live.tables} onSelectTable={setSelectedTableId} />
        </section>
      </main>

      {selectedTable ? (
        <TableDetailPanel
          table={selectedTable}
          branchId={branchId}
          orders={selectedTableOrders}
          sessions={live.sessions}
          staff={staff}
          onVoidLine={handleVoidLine}
          onClose={() => setSelectedTableId(null)}
        />
      ) : null}

      {reviewingAlert ? (
        <ExecuteBanDialog
          alert={reviewingAlert}
          staff={staff}
          onConfirm={handleExecuteBan}
          onCancel={() => setReviewingAlert(null)}
        />
      ) : null}
    </div>
  );
}
