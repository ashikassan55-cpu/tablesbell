'use client';

/**
 * src/components/ops/kds-queue-view.tsx
 *
 * LIVE-WIRED. Owns the live Firestore listener (`hooks/use-live-orders.ts`)
 * and the active station filter, and still hosts the single `ClockProvider`
 * every `TicketCard` on this screen shares. `MOCK_ORDERS`/the seeded
 * `useState` array are gone — `orders` now comes straight from the
 * listener, which is the single source of truth for what's on screen.
 *
 * DARK MODE NOTE, unchanged from the previous pass: the colors throughout
 * this component and its children remain the KDS-scoped dark palette,
 * still raw Tailwind arbitrary-value hex, not yet tokenized (MEMORY.md
 * §2, step 2, still open) — this deviates from the light ops palette
 * elsewhere by deliberate, scoped decision, not oversight.
 *
 * NO CLIENT-SIDE DOUBLE-TAP GUARD, a deliberate omission, not a missed
 * case: ARCHITECTURE.md §2.2 requires `advanceTicket` itself to be
 * idempotent ("a chef double-tapping on a laggy tablet must never see a
 * failure toast"), and `kds.actions.ts` genuinely is — a redundant tap
 * mid-flight just resolves as `{ outcome: 'already_there' }`, no error,
 * no duplicate side effect. Building a separate client-side
 * disabled-while-pending mechanism on top of a backend already designed
 * to make that safe would be solving the same problem twice.
 *
 * WHAT MOVED HERE FROM `kds/page.tsx`: the "N open tickets" live count
 * badge, previously server-rendered from `MOCK_ORDERS.length` (a number
 * always synchronously available). It now depends on the listener having
 * actually resolved — `loading`/`ready`/`error` are real states, not
 * something a server-rendered header can know ahead of a client mount.
 */

import { useMemo, useState } from 'react';
import { ClockProvider } from '@/components/providers/clock-provider';
import { StationFilter, type StationOption } from './station-filter';
import { TicketCard } from './ticket-card';
import { useLiveOrders } from '@/hooks/use-live-orders';
import { advanceTicket } from '@/server/actions/kds.actions';

const STATION_LABELS: Record<string, string> = {
  stn_bar: 'Bar',
  stn_grill: 'Grill',
  stn_fryer: 'Fryer',
};

const ALL_STATION_ID = 'all';

function QueueStatusShell({ message }: { message: string }) {
  return (
    <div className="flex flex-1 items-center justify-center px-4 py-4">
      <p className="text-sm text-[#94A3B8]">{message}</p>
    </div>
  );
}

export function KdsQueueView({
  tenantId,
  branchId,
  tenantSlug,
}: {
  tenantId: string;
  branchId: string;
  tenantSlug: string;
}) {
  const live = useLiveOrders(tenantId, branchId);
  const [activeStationId, setActiveStationId] = useState(ALL_STATION_ID);
  const [actionError, setActionError] = useState<string | null>(null);

  const orders = live.orders;

  const stationOptions = useMemo<StationOption[]>(() => {
    const stationIds = [...new Set(orders.flatMap((order) => order.stationIds))];
    return [
      { id: ALL_STATION_ID, label: 'All', count: orders.length },
      ...stationIds.map((id) => ({
        id,
        label: STATION_LABELS[id] ?? id,
        count: orders.filter((order) => order.stationIds.includes(id)).length,
      })),
    ];
  }, [orders]);

  const visibleOrders = useMemo(
    () =>
      activeStationId === ALL_STATION_ID
        ? orders
        : orders.filter((order) => order.stationIds.includes(activeStationId)),
    [orders, activeStationId],
  );

  async function handleAdvance(orderId: string, to: 'prep' | 'ready') {
    setActionError(null);
    // No actor/tenantId passed here -- `advanceTicket` derives both from
    // the real, verified staff session cookie itself now, never from a
    // client-supplied parameter. See that action's own header for why
    // that distinction is the entire point of this pass.
    const result = await advanceTicket({ branchId, orderId, to });

    if (result.outcome === 'rejected') {
      setActionError(`Couldn't advance that ticket (${result.reason}).`);
      return;
    }
    // 'advanced' and 'already_there' both need no local state update --
    // the live listener is the single source of truth now and will
    // reflect the new status the instant Firestore's write propagates
    // back down, same as any other staff terminal watching this queue.
  }

  if (live.status === 'loading') {
    return <QueueStatusShell message="Loading the queue…" />;
  }
  if (live.status === 'error') {
    return <QueueStatusShell message="Couldn't load the ticket queue. Check your connection." />;
  }

  return (
    <ClockProvider>
      <div className="flex flex-1 flex-col gap-4 overflow-hidden px-4 py-4">
        <div className="flex items-center justify-between gap-3">
          <StationFilter stations={stationOptions} activeStationId={activeStationId} onChange={setActiveStationId} />
          <span className="flex shrink-0 items-center gap-1.5 rounded-full bg-[#0F2318] px-3 py-1 text-xs font-semibold text-[#4ADE80]">
            <span className="h-1.5 w-1.5 rounded-full bg-[#4ADE80]" aria-hidden="true" />
            {orders.length} open tickets
          </span>
        </div>

        {actionError ? (
          <div role="alert" className="rounded-lg border border-[#F87171]/30 bg-[#3B1418] px-3 py-2 text-sm text-[#F87171]">
            {actionError}
          </div>
        ) : null}

        {visibleOrders.length === 0 ? (
          <p className="flex flex-1 items-center justify-center text-sm text-[#64748B]">
            No open tickets for this station.
          </p>
        ) : (
          <ul className="grid grid-cols-1 gap-3 overflow-y-auto sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
            {visibleOrders.map((order) => (
              <TicketCard key={order.id} order={order} tenantSlug={tenantSlug} onAdvance={handleAdvance} />
            ))}
          </ul>
        )}
      </div>
    </ClockProvider>
  );
}
