'use client';

/**
 * src/components/waiter/ready-tickets-panel.tsx
 *
 * The Waiter Floor's "ready for pickup" list. `tickets` is LIVE —
 * `orders where status == 'ready'` from `use-live-waiter-data.ts`.
 *
 * "Mark as Served" is now REAL — `markOrderServed`
 * (`server/actions/kds.actions.ts`, a thin wrapper over `advanceTicket`'s
 * `ready → served` transition: cookie-verified, `checkTransition`
 * role-gated to server/cashier/manager/owner, stamps `servedAt`, appends
 * the `events` audit row, idempotent). On success the row simply leaves
 * this query — no local mutation. `optimisticallyServed` hides the row
 * between the tap and the listener delta, and drops the id back on a
 * rejection so the ticket reappears with the error.
 *
 * "Report Suspected Ghost Order" is still local-state only (no
 * `staffAlerts` writer action yet).
 */

import { useEffect, useState } from 'react';
import { markOrderServed } from '@/server/actions/kds.actions';
import type { StaffIdentity } from '@/lib/console/staff-permissions';
import type { OrderWithId } from '@/components/ops/ticket-card';

export function ReadyTicketsPanel({
  tickets,
  staff,
  branchId,
}: {
  tickets: OrderWithId[];
  staff: StaffIdentity;
  branchId: string;
}) {
  const [reportedOrderIds, setReportedOrderIds] = useState<Set<string>>(new Set());
  const [optimisticallyServed, setOptimisticallyServed] = useState<Set<string>>(new Set());
  const [serveError, setServeError] = useState<string | null>(null);

  // Keep `optimisticallyServed` from growing: once a served ticket has
  // actually left the live query, forget it.
  useEffect(() => {
    setOptimisticallyServed((prev) => {
      if (prev.size === 0) return prev;
      const liveIds = new Set(tickets.map((t) => t.id));
      const next = new Set([...prev].filter((id) => liveIds.has(id)));
      return next.size === prev.size ? prev : next;
    });
  }, [tickets]);

  async function handleMarkServed(orderId: string) {
    setServeError(null);
    setOptimisticallyServed((prev) => new Set(prev).add(orderId));
    const result = await markOrderServed({ branchId, orderId });
    if (result.outcome === 'rejected') {
      setOptimisticallyServed((prev) => {
        const next = new Set(prev);
        next.delete(orderId);
        return next;
      });
      setServeError(`Couldn't mark that ticket served (${result.reason}).`);
    }
    // 'advanced' / 'already_there': the live `status == 'ready'` listener
    // drops the row; the effect above then prunes the id.
  }

  function handleReportGhost(orderId: string) {
    // Mock: the real version writes a `staffAlerts` doc for a manager.
    setReportedOrderIds((prev) => new Set(prev).add(orderId));
  }

  const visibleTickets = tickets.filter((ticket) => !optimisticallyServed.has(ticket.id));

  if (visibleTickets.length === 0) {
    return (
      <div className="rounded-lg border border-[#E5E7EB] bg-white p-4 text-sm text-[#6B7280]">
        Nothing ready for pickup.
      </div>
    );
  }

  return (
    <div className="space-y-2">
      {serveError ? (
        <p role="alert" className="rounded-md border border-[#E5484D]/30 bg-[#FDECEC] px-3 py-2 text-xs text-[#7A1E22]">
          {serveError}
        </p>
      ) : null}

      <ul className="flex flex-col gap-2">
        {visibleTickets.map((ticket) => {
          const activeItems = ticket.items.filter((line) => line.status === 'active');
          const alreadyReported = reportedOrderIds.has(ticket.id);

          return (
            <li key={ticket.id} className="rounded-lg border border-[#2E7D5B] bg-white p-3">
              <div className="flex items-center justify-between">
                <p className="text-sm font-bold text-[#1F2937]">
                  {ticket.tableCode} <span className="font-normal text-[#6B7280]">· #{ticket.code}</span>
                </p>
                <button
                  type="button"
                  onClick={() => handleMarkServed(ticket.id)}
                  className="flex h-11 items-center rounded-lg bg-[#2E7D5B] px-3 text-sm font-semibold text-white"
                >
                  Mark as Served
                </button>
              </div>

              <ul className="mt-2 flex flex-col gap-1">
                {activeItems.map((line) => (
                  <li key={line.lineId} className="text-sm text-[#1F2937]">
                    <span className="font-semibold tabular-nums">{line.qty}×</span> {line.nameSnapshot.en}
                  </li>
                ))}
              </ul>

              <button
                type="button"
                onClick={() => handleReportGhost(ticket.id)}
                disabled={alreadyReported}
                className="mt-2 flex h-9 items-center gap-1.5 text-xs font-semibold text-[#D97706] disabled:text-[#9CA3AF]"
              >
                <span aria-hidden="true">⚠</span>
                {alreadyReported ? `Reported by ${staff.displayName}` : 'Report Suspected Ghost Order'}
              </button>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
