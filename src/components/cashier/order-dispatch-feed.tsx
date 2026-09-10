'use client';

/**
 * src/components/cashier/order-dispatch-feed.tsx
 *
 * The Cashier console "Order Queue" tab, rebuilt to the Stitch
 * "Utilitarian POS & Floor Console — Order Queue" screen: an operational
 * KPI ribbon (active dispatches / avg prep pace / over-target SLA / KDS
 * stream), a station selection bar, a vertical dispatch feed of order
 * cards with live prep timers and state-driven actions, and an expediter
 * helper bar.
 *
 * Live data is the same `useLiveCashierData().orders` the rest of the
 * console uses; state transitions go through the existing
 * `advanceTicket` server action (which re-checks the `tb_staff` cookie
 * and the role matrix in `ticket-state.service.ts`). Kitchen-only steps
 * (Accept to Kitchen / Mark Ready / Recall) are disabled unless the
 * signed-in role is kitchen/manager/owner; Mark Served stays live for
 * cashier/server.
 */

import { useMemo, useState } from 'react';
import {
  ReceiptText,
  Timer,
  TriangleAlert,
  RefreshCw,
  Coffee,
  CookingPot,
  Table2,
  CheckCircle2,
  PlayCircle,
  Undo2,
  Printer,
  SlidersHorizontal,
  ArrowUpWideNarrow,
  Loader2,
} from 'lucide-react';
import { useNow } from '@/components/providers/clock-provider';
import { getElapsedSec, formatElapsed } from '@/lib/time';
import { advanceTicket } from '@/server/actions/kds.actions';
import type { OrderWithId } from '@/components/ops/ticket-card';
import type { StaffIdentity } from '@/lib/console/staff-permissions';

/** Expediter "over target" cut-off — the design's ">10m limit" copy. */
const SLA_LIMIT_SEC = 600;

const STATION_LABELS: Record<string, string> = {
  stn_bar: 'Barista / Coffee',
  stn_kitchen: 'Hot Kitchen / Bakery',
  stn_grill: 'Grill Line',
  stn_fryer: 'Fryer',
  stn_pastry: 'Pastry',
};

function stationLabel(id: string): string {
  return STATION_LABELS[id] ?? id.replace(/^stn_/, '').replace(/[_-]+/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());
}

function clockLabel(ms: number): string {
  if (!ms) return '—';
  return new Date(ms).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' });
}

type CardState = 'over' | 'incoming' | 'preparing' | 'ready';

function reasonText(reason: string): string {
  switch (reason) {
    case 'ROLE_NOT_PERMITTED':
      return "Your role can't take that step — kitchen handles it.";
    case 'ILLEGAL_TRANSITION':
      return 'That ticket already moved on.';
    case 'ALREADY_TERMINAL':
      return 'That ticket is already closed.';
    case 'NOT_AUTHENTICATED':
      return 'Session expired — lock the console and sign in again.';
    case 'BRANCH_NOT_AUTHORIZED':
      return 'You are not signed in to this branch.';
    case 'ORDER_NOT_FOUND':
      return 'Ticket not found — it may have been voided.';
    default:
      return `Couldn't update that ticket (${reason}).`;
  }
}

const KITCHEN_ROLES = new Set(['kitchen', 'manager', 'owner']);

interface OrderDispatchFeedProps {
  orders: OrderWithId[];
  liveStatus: 'loading' | 'ready' | 'error';
  staff: StaffIdentity;
  branchId: string;
  tenantSlug: string;
  onSelectTable: (tableId: string) => void;
}

export function OrderDispatchFeed({
  orders,
  liveStatus,
  staff,
  branchId,
  onSelectTable,
}: OrderDispatchFeedProps) {
  const now = useNow();
  const [station, setStation] = useState<string>('all');
  const [busyId, setBusyId] = useState<string | null>(null);
  const [errById, setErrById] = useState<Record<string, string>>({});

  const canKitchen = KITCHEN_ROLES.has(staff.role);

  /** Open tickets only — served/voided fall out of the feed automatically. */
  const feed = useMemo(
    () => orders.filter((o) => o.status === 'new' || o.status === 'prep' || o.status === 'ready'),
    [orders],
  );

  const elapsedOf = (o: OrderWithId) =>
    getElapsedSec(o.placedAt, o.status === 'ready' && o.readyAt != null ? o.readyAt : now);

  const stateOf = (o: OrderWithId): CardState => {
    if (o.status === 'ready') return 'ready';
    if (elapsedOf(o) >= SLA_LIMIT_SEC) return 'over';
    return o.status === 'new' ? 'incoming' : 'preparing';
  };

  const rankOf: Record<CardState, number> = { over: 0, incoming: 1, preparing: 2, ready: 3 };

  const sorted = useMemo(() => {
    return [...feed].sort((a, b) => {
      const ra = rankOf[stateOf(a)];
      const rb = rankOf[stateOf(b)];
      if (ra !== rb) return ra - rb;
      const ua = a.priority === 'urgent' ? 0 : 1;
      const ub = b.priority === 'urgent' ? 0 : 1;
      if (ua !== ub) return ua - ub;
      return a.placedAt - b.placedAt;
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [feed, now]);

  const stationIds = useMemo(() => {
    const s = new Set<string>();
    for (const o of feed) for (const id of o.stationIds ?? []) s.add(id);
    return [...s].sort();
  }, [feed]);

  const visible = useMemo(() => {
    if (station === 'all') return sorted;
    if (station === '__ready') return sorted.filter((o) => o.status === 'ready');
    return sorted.filter((o) => (o.stationIds ?? []).includes(station));
  }, [sorted, station]);

  // --- KPI ribbon ------------------------------------------------------------
  const activeDispatches = feed.length;
  const overTargetCount = feed.filter((o) => o.status !== 'ready' && elapsedOf(o) >= SLA_LIMIT_SEC).length;
  const prepSamples = orders.filter((o) => o.readyAt != null && o.placedAt > 0 && o.readyAt > o.placedAt);
  const avgPrepMin =
    prepSamples.length > 0
      ? prepSamples.reduce((sum, o) => sum + ((o.readyAt as number) - o.placedAt), 0) / prepSamples.length / 60000
      : null;
  const streamOk = liveStatus === 'ready';

  async function handleAdvance(orderId: string, to: 'prep' | 'ready' | 'served') {
    setBusyId(orderId);
    setErrById((m) => {
      if (!(orderId in m)) return m;
      const next = { ...m };
      delete next[orderId];
      return next;
    });
    try {
      const res = await advanceTicket({ branchId, orderId, to });
      if (res.outcome === 'rejected') {
        setErrById((m) => ({ ...m, [orderId]: reasonText(res.reason) }));
      }
    } catch {
      setErrById((m) => ({ ...m, [orderId]: 'Network error — try again.' }));
    } finally {
      setBusyId(null);
    }
  }

  return (
    <div className="space-y-4">
      {/* Operational KPI ribbon */}
      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        <KpiCard
          label="Active Dispatches"
          value={String(activeDispatches)}
          valueClass="text-[#003A3E]"
          icon={<ReceiptText className="h-5 w-5" />}
          iconClass="bg-[#EFF4FF] text-[#003A3E]"
        />
        <KpiCard
          label="Avg Prep Pace"
          value={avgPrepMin != null ? avgPrepMin.toFixed(1) : '—'}
          suffix={avgPrepMin != null ? 'min' : undefined}
          valueClass="text-[#121C2A]"
          icon={<Timer className="h-5 w-5" />}
          iconClass="bg-[#A1F0C7] text-[#1D704F]"
        />
        <KpiCard
          label="Over Target SLA"
          value={String(overTargetCount)}
          suffix=">10m limit"
          labelClass="text-[#BA1A1A]"
          valueClass="text-[#BA1A1A]"
          suffixClass="text-[#BA1A1A]"
          icon={<TriangleAlert className="h-5 w-5" />}
          iconClass="bg-[#FFDAD6] text-[#BA1A1A]"
        />
        <div className="flex items-center justify-between rounded-xl bg-white p-3 shadow-sm">
          <div className="flex flex-col">
            <span className="text-[10px] font-bold uppercase tracking-wide text-[#6B7280]">KDS Real-Time Stream</span>
            <span className="mt-1.5 flex items-center gap-1.5">
              <span
                className={`h-2.5 w-2.5 rounded-full ${streamOk ? 'animate-ping bg-[#176B4B]' : 'bg-[#BA1A1A]'}`}
              />
              <span className={`text-sm font-bold tracking-tight ${streamOk ? 'text-[#176B4B]' : 'text-[#BA1A1A]'}`}>
                {streamOk ? 'Active Connected' : 'Reconnecting'}
              </span>
            </span>
          </div>
          <span className="flex h-10 w-10 items-center justify-center rounded-xl bg-[#DEE9FC] text-[#0F5257]">
            <RefreshCw className="h-5 w-5" />
          </span>
        </div>
      </div>

      {/* Station selection bar */}
      <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl bg-white p-2 shadow-sm">
        <div className="flex flex-wrap items-center gap-1.5">
          <StationTab active={station === 'all'} count={feed.length} onClick={() => setStation('all')}>
            All Stations
          </StationTab>
          {stationIds.map((id) => (
            <StationTab
              key={id}
              active={station === id}
              count={feed.filter((o) => (o.stationIds ?? []).includes(id)).length}
              onClick={() => setStation(id)}
              icon={id === 'stn_bar' ? <Coffee className="h-4 w-4" /> : <CookingPot className="h-4 w-4" />}
            >
              {stationLabel(id)}
            </StationTab>
          ))}
          <StationTab
            active={station === '__ready'}
            count={feed.filter((o) => o.status === 'ready').length}
            onClick={() => setStation('__ready')}
            icon={<CheckCircle2 className="h-4 w-4" />}
            tone="success"
          >
            Ready for Pickup
          </StationTab>
        </div>
        <div className="ml-auto flex items-center gap-1.5">
          <span className="flex items-center gap-1 rounded-lg bg-[#EFF4FF] px-2.5 py-1.5 text-xs font-medium text-[#404849]">
            <ArrowUpWideNarrow className="h-4 w-4" /> Priority: Urgent First
          </span>
          <button
            type="button"
            title="Print active slips"
            className="flex h-9 w-9 items-center justify-center rounded-lg bg-[#EFF4FF] text-[#404849] transition-colors hover:bg-[#DEE9FC]"
          >
            <Printer className="h-4 w-4" />
          </button>
          <button
            type="button"
            title="Queue settings"
            className="flex h-9 w-9 items-center justify-center rounded-lg bg-[#EFF4FF] text-[#404849] transition-colors hover:bg-[#DEE9FC]"
          >
            <SlidersHorizontal className="h-4 w-4" />
          </button>
        </div>
      </div>

      {/* Dispatch feed */}
      {visible.length === 0 ? (
        <p className="rounded-xl border border-[#E5E7EB] bg-white px-4 py-10 text-center text-sm text-[#6B7280]">
          {feed.length === 0 ? 'No open tickets right now.' : 'No tickets at this station.'}
        </p>
      ) : (
        <div className="flex flex-col gap-3">
          {visible.map((o) => (
            <DispatchCard
              key={o.id}
              order={o}
              state={stateOf(o)}
              elapsedSec={elapsedOf(o)}
              busy={busyId === o.id}
              error={errById[o.id] ?? null}
              canKitchen={canKitchen}
              onView={() => onSelectTable(o.tableId)}
              onAdvance={handleAdvance}
            />
          ))}
        </div>
      )}

      {/* Expediter helper bar */}
      <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl bg-[#EFF4FF] p-3 text-xs text-[#404849]">
        <div className="flex flex-wrap items-center gap-4">
          <LegendDot className="bg-[#E5484D]">Urgent (&gt;10m)</LegendDot>
          <LegendDot className="bg-[#FFB77D]">Preparing</LegendDot>
          <LegendDot className="bg-[#176B4B]">Ready for Floor</LegendDot>
        </div>
        <span>
          Keyboard shortcuts: <strong className="text-[#121C2A]">[Space]</strong> Next ready,{' '}
          <strong className="text-[#121C2A]">[1-4]</strong> Station toggle
        </span>
      </div>
    </div>
  );
}

/* -------------------------------------------------------------------------- */

function KpiCard({
  label,
  value,
  suffix,
  icon,
  iconClass,
  labelClass = 'text-[#6B7280]',
  valueClass = 'text-[#121C2A]',
  suffixClass = 'text-[#6B7280]',
}: {
  label: string;
  value: string;
  suffix?: string;
  icon: React.ReactNode;
  iconClass: string;
  labelClass?: string;
  valueClass?: string;
  suffixClass?: string;
}) {
  return (
    <div className="flex items-center justify-between rounded-xl bg-white p-3 shadow-sm">
      <div className="flex flex-col">
        <span className={`text-[10px] font-bold uppercase tracking-wide ${labelClass}`}>{label}</span>
        <span className="mt-1 flex items-baseline gap-1">
          <span className={`font-heading text-[30px] font-bold leading-none tracking-tight ${valueClass}`}>{value}</span>
          {suffix ? <span className={`text-xs ${suffixClass}`}>{suffix}</span> : null}
        </span>
      </div>
      <span className={`flex h-10 w-10 items-center justify-center rounded-xl ${iconClass}`}>{icon}</span>
    </div>
  );
}

function StationTab({
  active,
  count,
  onClick,
  children,
  icon,
  tone = 'default',
}: {
  active: boolean;
  count: number;
  onClick: () => void;
  children: React.ReactNode;
  icon?: React.ReactNode;
  tone?: 'default' | 'success';
}) {
  const pill = active
    ? 'bg-[#0F5257] text-white'
    : tone === 'success'
      ? 'bg-[#176B4B] text-white'
      : 'bg-[#D9E3F6] text-[#404849]';
  return (
    <button
      type="button"
      onClick={onClick}
      className={`flex h-11 items-center gap-1.5 rounded-xl px-3 text-sm font-semibold transition-colors ${
        active ? 'bg-[#003A3E] text-white shadow-sm' : 'bg-[#EFF4FF] text-[#121C2A] hover:bg-[#DEE9FC]'
      }`}
    >
      {icon}
      <span>{children}</span>
      <span className={`ml-1 rounded-full px-2 py-0.5 text-[11px] font-bold ${pill}`}>{count}</span>
    </button>
  );
}

function LegendDot({ className, children }: { className: string; children: React.ReactNode }) {
  return (
    <span className="flex items-center gap-1.5">
      <span className={`h-2.5 w-2.5 rounded-full ${className}`} />
      {children}
    </span>
  );
}

/* -------------------------------------------------------------------------- */

const BAND: Record<CardState, string> = {
  over: 'bg-[#E5484D] animate-pulse',
  incoming: 'bg-[#0F5257]',
  preparing: 'bg-[#FFB77D]',
  ready: 'bg-[#176B4B]',
};

const BADGE: Record<CardState, { label: string; cls: string }> = {
  over: { label: 'Over Target', cls: 'bg-[#FFDAD6] text-[#BA1A1A]' },
  incoming: { label: 'New Incoming', cls: 'bg-[#B2EDF2] text-[#084F54]' },
  preparing: { label: 'Preparing', cls: 'bg-[#FFDCC3] text-[#2F1500]' },
  ready: { label: 'Ready to Serve', cls: 'bg-[#A1F0C7] text-[#1D704F]' },
};

const TIMER_CLS: Record<CardState, string> = {
  over: 'bg-[#FFDAD6] text-[#BA1A1A]',
  incoming: 'bg-[#DEE9FC] text-[#0F5257]',
  preparing: 'bg-[#DEE9FC] text-[#0F5257]',
  ready: 'bg-[#A1F0C7] text-[#1D704F]',
};

function DispatchCard({
  order,
  state,
  elapsedSec,
  busy,
  error,
  canKitchen,
  onView,
  onAdvance,
}: {
  order: OrderWithId;
  state: CardState;
  elapsedSec: number;
  busy: boolean;
  error: string | null;
  canKitchen: boolean;
  onView: () => void;
  onAdvance: (orderId: string, to: 'prep' | 'ready' | 'served') => void;
}) {
  const badge = BADGE[state];
  const activeLines = order.items.filter((l) => l.status === 'active');
  const station = (order.stationIds ?? [])[0];

  // primary action
  let primary: { label: string; to: 'prep' | 'ready' | 'served'; cls: string; gated: boolean } | null = null;
  if (state === 'ready') {
    primary = { label: 'Mark Served', to: 'served', cls: 'bg-[#176B4B] text-white hover:opacity-90', gated: false };
  } else if (order.status === 'new') {
    primary = { label: 'Accept to Kitchen', to: 'prep', cls: 'bg-[#0F5257] text-white hover:bg-[#003A3E]', gated: true };
  } else {
    primary = { label: 'Mark Ready', to: 'ready', cls: 'bg-[#0F5257] text-white hover:bg-[#003A3E]', gated: true };
  }
  const primaryDisabled = busy || (primary.gated && !canKitchen);

  const secondaryLabel = state === 'incoming' ? 'Inspect Slip' : state === 'ready' ? 'Recall' : 'View Ticket';
  const secondaryIsRecall = state === 'ready';
  const recallDisabled = busy || !canKitchen;

  return (
    <div className="flex flex-col gap-3 overflow-hidden rounded-xl border border-[#E5E7EB] bg-white p-4 shadow-sm lg:flex-row lg:items-center lg:justify-between">
      {/* identity */}
      <div className="flex min-w-[240px] items-start gap-3">
        <span className={`mt-0.5 h-14 w-3 shrink-0 rounded-full ${BAND[state]}`} />
        <div className="flex flex-col">
          <div className="flex items-center gap-2">
            <span className="font-heading text-[22px] font-bold leading-tight text-[#121C2A]">#{order.code}</span>
            <span className={`rounded px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide ${badge.cls}`}>
              {badge.label}
            </span>
          </div>
          <div className="mt-0.5 flex items-center gap-1.5">
            <Table2 className="h-4 w-4 text-[#0F5257]" />
            <span className="text-sm font-bold text-[#0F5257]">Table {order.tableCode}</span>
            {order.zoneId ? <span className="text-xs text-[#404849]">• {order.zoneId}</span> : null}
          </div>
        </div>
      </div>

      {/* items + meta */}
      <div className="flex min-w-0 flex-1 flex-col justify-center gap-2">
        <div className="flex flex-wrap items-center gap-2">
          {activeLines.map((line) => (
            <span
              key={line.lineId}
              className="flex items-center gap-1.5 rounded-lg bg-[#EFF4FF] px-2 py-1 text-sm"
            >
              <span className="font-bold text-[#0F5257]">{line.qty}x</span>
              <span className="font-semibold text-[#121C2A]">{line.nameSnapshot.en}</span>
              {line.modifiers.length > 0 ? (
                <span className="rounded bg-[#A1F0C7] px-1.5 py-0.5 text-xs font-medium text-[#1D704F]">
                  {line.modifiers.map((m) => m.nameSnapshot.en).join(' · ')}
                </span>
              ) : null}
            </span>
          ))}
          {activeLines.length === 0 ? <span className="text-xs text-[#6B7280]">All lines voided</span> : null}
        </div>
        {order.guestNote ? <p className="text-xs italic text-[#404849]">“{order.guestNote}”</p> : null}
        <div className="flex flex-wrap items-center gap-3">
          {station ? (
            <span className="rounded-lg bg-[#E6EEFF] px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide text-[#404849]">
              {stationLabel(station)}
            </span>
          ) : null}
          <span className="text-xs text-[#404849]">
            Server: {order.placedByName ?? 'Staff'} • Guest Covers: {order.covers}
          </span>
        </div>
      </div>

      {/* timer + actions */}
      <div className="flex shrink-0 items-center justify-between gap-4 lg:justify-end">
        <div className="flex flex-col items-end">
          <span
            className={`flex items-center gap-1 rounded-lg px-2 py-1 text-sm font-bold tabular-nums ${TIMER_CLS[state]}`}
          >
            {formatElapsed(elapsedSec)}
            {state === 'ready' ? ' total' : ''}
          </span>
          <span className="mt-1 text-xs text-[#404849]">
            {state === 'ready' && order.readyAt != null
              ? `Ready at ${clockLabel(order.readyAt)}`
              : `Placed ${clockLabel(order.placedAt)}`}
          </span>
        </div>
        <div className="flex flex-col items-end gap-1.5">
          <div className="flex items-center gap-1.5">
            <button
              type="button"
              onClick={secondaryIsRecall ? () => onAdvance(order.id, 'prep') : onView}
              disabled={secondaryIsRecall ? recallDisabled : false}
              title={secondaryIsRecall && !canKitchen ? 'Kitchen or manager sends tickets back to prep' : undefined}
              className="flex h-11 items-center gap-1.5 rounded-xl bg-[#E6EEFF] px-3 text-sm font-semibold text-[#003A3E] transition-colors hover:bg-[#DEE9FC] disabled:cursor-not-allowed disabled:opacity-40"
            >
              {secondaryIsRecall ? <Undo2 className="h-4 w-4" /> : null}
              {secondaryLabel}
            </button>
            <button
              type="button"
              onClick={() => onAdvance(order.id, primary.to)}
              disabled={primaryDisabled}
              title={primary.gated && !canKitchen ? 'Kitchen or manager marks kitchen progress' : undefined}
              className={`flex h-11 items-center gap-1.5 rounded-xl px-4 text-sm font-bold shadow-sm transition-colors disabled:cursor-not-allowed disabled:opacity-40 ${primary.cls}`}
            >
              {busy ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : primary.to === 'served' ? (
                <CheckCircle2 className="h-4 w-4" />
              ) : primary.to === 'prep' ? (
                <PlayCircle className="h-4 w-4" />
              ) : (
                <CheckCircle2 className="h-4 w-4" />
              )}
              {busy ? 'Working…' : primary.label}
            </button>
          </div>
          {error ? <p className="max-w-[240px] text-right text-xs text-[#BA1A1A]">{error}</p> : null}
        </div>
      </div>
    </div>
  );
}
