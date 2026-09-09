'use client';

/**
 * src/components/waiter/waiter-floor-view.tsx
 *
 * Orchestrates the Waiter Floor. Identity is the verified `tb_staff`
 * session (`staff` prop); floor data is now LIVE (2026-09-09) —
 * `useLiveWaiterData(tenantId, branchId)` opens real `onSnapshot`
 * listeners on `tables`, `sessions`, and `orders where status == 'ready'`.
 * `MOCK_TABLES` / `MOCK_ORDERS` are gone from this surface.
 *
 * PERMISSION-BOUNDARY REVISION -- DECISIONS.md ADR-5. Unchanged by the
 * live-wiring: no per-action step-up PIN, no Open Floor Mode. A waiter
 * views the grid, takes an order (draft-cart edits only, `waiter-menu-
 * entry.tsx`), marks a ready ticket served, and REPORTS (never executes)
 * a suspected ghost order. Sent-line voids happen at the Cashier terminal.
 *
 * "Lock" clears the real `tb_staff` cookie via the `lockTerminal` action.
 */

import { useState } from 'react';
import { ClockProvider } from '@/components/providers/clock-provider';
import { TableOverviewGrid } from '@/components/cashier/table-overview-grid';
import { WaiterMenuEntry } from './waiter-menu-entry';
import { ReadyTicketsPanel } from './ready-tickets-panel';
import { WaiterAlertsStrip } from './waiter-alerts-strip';
import { LockSwitchButton } from '@/components/console/lock-switch-button';
import { roleLabel, type StaffIdentity } from '@/lib/console/staff-permissions';
import { useLiveWaiterData } from '@/hooks/use-live-waiter-data';

interface WaiterFloorViewProps {
  tenantSlug: string;
  staff: StaffIdentity;
  tenantId: string;
  branchId: string | null;
  /** null only when `branchId` is null (page resolves them together). */
  menuVersion: number | null;
}

export function WaiterFloorView({ tenantSlug, staff, tenantId, branchId, menuVersion }: WaiterFloorViewProps) {
  if (!branchId) {
    return (
      <div className="flex min-h-dvh items-center justify-center bg-[#F3F4F6] px-6 text-center">
        <p className="text-sm text-[#6B7280]">Your account has no branch assigned. Contact a manager.</p>
      </div>
    );
  }

  return (
    <ClockProvider>
      {/* `menuVersion ?? 1`: it is only ever null when `branchId` is null,
          which returned above — the fallback keeps TS happy and matches
          `resolveMenuVersion`'s own default. */}
      <FloorBody
        tenantSlug={tenantSlug}
        staff={staff}
        tenantId={tenantId}
        branchId={branchId}
        menuVersion={menuVersion ?? 1}
      />
    </ClockProvider>
  );
}

function FloorShell({ tenantSlug, staff, message }: { tenantSlug: string; staff: StaffIdentity; message: string }) {
  return (
    <div className="flex min-h-dvh flex-col bg-[#F3F4F6]">
      <header className="border-b border-[#E5E7EB] bg-white px-4 py-3">
        <h1 className="text-lg font-bold text-[#1F2937]">Waiter Floor</h1>
        <p className="text-xs text-[#6B7280]">
          {tenantSlug} · {staff.displayName} ({roleLabel(staff.role)})
        </p>
      </header>
      <div className="flex flex-1 items-center justify-center px-6 text-center">
        <p className="text-sm text-[#6B7280]">{message}</p>
      </div>
    </div>
  );
}

function FloorBody({
  tenantSlug,
  staff,
  tenantId,
  branchId,
  menuVersion,
}: {
  tenantSlug: string;
  staff: StaffIdentity;
  tenantId: string;
  branchId: string;
  menuVersion: number;
}) {
  const live = useLiveWaiterData(tenantId, branchId);
  const [selectedTableId, setSelectedTableId] = useState<string | null>(null);

  const selectedTable = live.tables.find((table) => table.id === selectedTableId) ?? null;

  if (live.status === 'loading') {
    return <FloorShell tenantSlug={tenantSlug} staff={staff} message="Loading the floor…" />;
  }
  if (live.status === 'error') {
    return <FloorShell tenantSlug={tenantSlug} staff={staff} message="Couldn't load live floor data. Check your connection." />;
  }

  if (selectedTable) {
    return (
      <div className="flex min-h-dvh flex-col bg-[#F3F4F6]">
        <header className="flex items-center gap-3 border-b border-[#E5E7EB] bg-white px-4 py-3">
          <button
            type="button"
            onClick={() => setSelectedTableId(null)}
            aria-label="Back to floor"
            className="flex h-10 w-10 items-center justify-center rounded-full text-[#1F2937]"
          >
            <span aria-hidden="true">←</span>
          </button>
          <div className="min-w-0">
            <h1 className="text-base font-bold text-[#1F2937]">Take Order</h1>
            <p className="text-xs text-[#6B7280]">
              {selectedTable.code} · {selectedTable.partyCount} open part{selectedTable.partyCount === 1 ? 'y' : 'ies'}
            </p>
          </div>
        </header>
        <div className="flex-1 px-4 py-4">
          {/* Party detail + selection is the picker's job now — see
              `waiter-menu-entry.tsx`. `parties` comes straight off the live
              `tables/{id}.parties[]` denormalisation. */}
          <WaiterMenuEntry
            tenantId={tenantId}
            branchId={branchId}
            menuVersion={menuVersion}
            tableId={selectedTable.id}
            parties={selectedTable.parties}
            sessions={live.sessions}
            tableCode={selectedTable.code}
            onSent={() => setSelectedTableId(null)}
          />
        </div>
      </div>
    );
  }

  return (
    <div className="flex min-h-dvh flex-col bg-[#F3F4F6]">
      <header className="flex flex-wrap items-center justify-between gap-2 border-b border-[#E5E7EB] bg-white px-4 py-3">
        <div>
          <h1 className="text-lg font-bold text-[#1F2937]">Waiter Floor</h1>
          <p className="text-xs text-[#6B7280]">
            {tenantSlug} · {staff.displayName} ({roleLabel(staff.role)})
          </p>
        </div>
        <LockSwitchButton tenantSlug={tenantSlug} />
      </header>

      <main className="flex-1 space-y-6 px-4 py-4">
        <WaiterAlertsStrip alerts={live.alerts} branchId={branchId} />

        <section>
          <h2 className="mb-2 text-xs font-semibold uppercase tracking-wide text-[#6B7280]">Ready for Pickup</h2>
          <ReadyTicketsPanel tickets={live.readyOrders} staff={staff} branchId={branchId} />
        </section>

        <section>
          <h2 className="mb-2 text-xs font-semibold uppercase tracking-wide text-[#6B7280]">Tables — tap to take an order</h2>
          <TableOverviewGrid tables={live.tables} onSelectTable={setSelectedTableId} />
        </section>
      </main>
    </div>
  );
}
