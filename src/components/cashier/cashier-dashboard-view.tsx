'use client';

/**
 * src/components/cashier/cashier-dashboard-view.tsx
 *
 * The Cashier / front-of-house console, built to the Stitch "Utilitarian
 * POS & Floor Console — Floor Grid" screen: a full-width top bar (brand,
 * live status pills, Floor Grid / Alerts & Pagers / Order Queue / Shift
 * Close nav, Lock Console), a 64px icon rail, a stats-and-filter toolbar,
 * and the table-card grid. Live data still comes from `useLiveCashierData`
 * (`tables` / `sessions` / `orders` / `staffAlerts` snapshots); the void,
 * alert-resolve and settle-&-close flows are unchanged.
 */

import { useMemo, useState } from 'react';
import {
  LayoutGrid,
  BellRing,
  Monitor,
  IdCard,
  SlidersHorizontal,
  Siren,
  Search,
  RefreshCw,
  Volume2,
} from 'lucide-react';
import { ClockProvider } from '@/components/providers/clock-provider';
import { TableOverviewGrid } from './table-overview-grid';
import { TableDetailPanel } from './table-detail-panel';
import { ExecuteBanDialog } from './execute-ban-dialog';
import { OrderDispatchFeed } from './order-dispatch-feed';
import { AlarmBar } from './alarm-bar';
import { AlertsPagersView } from './alerts-pagers-view';
import {
  callToActiveAlert,
  staffToActiveAlert,
  serviceCallToActiveAlert,
  sortActiveAlerts,
  type ActiveAlert,
} from './active-alert';
import { LockSwitchButton } from '@/components/console/lock-switch-button';
import { voidTicketLine, resolveStaffAlert, resolveServiceCall } from '@/server/actions/bill.actions';
import { roleLabel, type StaffIdentity } from '@/lib/console/staff-permissions';
import { useLiveCashierData } from '@/hooks/use-live-cashier-data';
import { formatMoney } from '@/lib/format/money';
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
      <div className="flex min-h-dvh items-center justify-center bg-[#F8F9FF] px-6 text-center">
        <p className="text-sm text-[#6B7280]">Your account has no branch assigned. Contact a manager.</p>
      </div>
    );
  }
  return (
    <ClockProvider>
      <Body tenantSlug={tenantSlug} staff={staff} tenantId={tenantId} branchId={branchId} />
    </ClockProvider>
  );
}

interface VoidStatus {
  orderCode: string;
  message: string;
  tone: 'ok' | 'warn' | 'error';
}
type Tab = 'floor' | 'alerts' | 'queue' | 'shift';

function LoadState({ message }: { message: string }) {
  return (
    <div className="flex min-h-dvh flex-col bg-[#F8F9FF]">
      <header className="border-b border-[#E5E7EB] bg-white px-6 py-3">
        <p className="text-sm font-bold text-[#003A3E]">TableBells</p>
        <p className="text-xs text-[#6B7280]">Staff Operations</p>
      </header>
      <div className="flex flex-1 items-center justify-center px-6 text-center">
        <p className="text-sm text-[#6B7280]">{message}</p>
      </div>
    </div>
  );
}

function Body({
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
  const [tab, setTab] = useState<Tab>('floor');
  const [zone, setZone] = useState('all');
  const [query, setQuery] = useState('');
  const [selectedTableId, setSelectedTableId] = useState<string | null>(null);
  const [reviewingAlert, setReviewingAlert] = useState<StaffAlert | null>(null);
  const [dismissedAlertIds, setDismissedAlertIds] = useState<Set<string>>(new Set());
  const [voidStatus, setVoidStatus] = useState<VoidStatus | null>(null);

  const selectedTable = live.tables.find((t) => t.id === selectedTableId) ?? null;
  const selectedTableOrders = selectedTable ? live.orders.filter((o) => o.tableId === selectedTable.id) : [];
  const visibleAlerts = live.alerts.filter((a) => !dismissedAlertIds.has(a.id));

  /** Waiter calls + open staff alerts + guest service calls, one
   *  normalized list, most urgent first. */
  const tableCodeById = new Map(live.tables.map((t) => [t.id, t.code]));
  const activeAlerts = sortActiveAlerts([
    ...live.tables
      .filter((t) => t.activeCall && !dismissedAlertIds.has(`call:${t.id}`))
      .map((t) => callToActiveAlert(t)),
    ...visibleAlerts.map((a) => staffToActiveAlert(a)),
    ...live.serviceCalls
      .filter((c) => !dismissedAlertIds.has(`svc:${c.id}`))
      .map((c) => serviceCallToActiveAlert(c, tableCodeById.get(c.tableId) ?? c.tableId)),
  ]);

  const zones = useMemo(() => {
    const s = new Set<string>();
    for (const t of live.tables) s.add(t.zoneId || 'unzoned');
    return [...s].sort();
  }, [live.tables]);

  const occupied = live.tables.filter((t) => t.partyCount > 0 || t.status === 'occupied').length;
  const available = live.tables.filter((t) => t.status === 'available').length;
  const attention = live.tables.filter((t) => t.activeCall || t.status === 'attention').length;
  const billingTables = live.tables.filter((t) => t.parties.some((p) => p.status === 'billing'));
  const floorTotalFils = live.tables.reduce((s, t) => s + (t.openTabFils || 0), 0);
  const pct = live.tables.length ? Math.round((occupied / live.tables.length) * 100) : 0;
  const currency = live.orders.find((o) => typeof o.currency === 'string')?.currency;
  const money = (fils: number) => formatMoney(fils, currency);

  function handleExecuteBan({ alertId }: { alertId: string; rotateSlug: boolean }) {
    setDismissedAlertIds((prev) => new Set(prev).add(alertId));
    setReviewingAlert(null);
  }

  async function resolveAlert(alert: StaffAlert) {
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

  /** "Attending" — silence the alarm on this console; the alert stays open. */
  function acknowledgeAlert(alert: ActiveAlert) {
    setDismissedAlertIds((prev) => new Set(prev).add(alert.key));
  }

  /** "Attended" — clear the alert. Staff alerts hit the real server action;
   *  waiter calls have no backend clear yet, so they resolve on this console. */
  function resolveActiveAlert(alert: ActiveAlert) {
    if (alert.staffAlert) {
      void resolveAlert(alert.staffAlert);
      return;
    }
    if (alert.serviceCall) {
      const callId = alert.serviceCall.id;
      setDismissedAlertIds((prev) => new Set(prev).add(alert.key));
      void resolveServiceCall({ branchId, callId }).then((result) => {
        if (result.outcome === 'rejected') {
          setDismissedAlertIds((prev) => {
            const next = new Set(prev);
            next.delete(alert.key);
            return next;
          });
          setVoidStatus({
            orderCode: alert.tableCode,
            message: `Couldn't clear that request: ${result.reason}.`,
            tone: 'error',
          });
        }
      });
      return;
    }
    setDismissedAlertIds((prev) => new Set(prev).add(alert.key));
    setVoidStatus({
      orderCode: alert.tableCode,
      message: 'Runner dispatched — call cleared on this console.',
      tone: 'ok',
    });
  }

  function reviewActiveAlert(alert: ActiveAlert) {
    if (alert.staffAlert) setReviewingAlert(alert.staffAlert);
  }

  function handleHandleCall(tableId: string) {
    const table = live.tables.find((t) => t.id === tableId);
    if (!table) return;
    const match = visibleAlerts.find((a) => a.tableCode === table.code);
    if (match) void resolveAlert(match);
    else setSelectedTableId(tableId);
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
  }

  if (live.status === 'loading') return <LoadState message="Loading the floor…" />;
  if (live.status === 'error') return <LoadState message="Couldn't load live floor data. Check your connection." />;

  const NAV: { id: Tab; label: string }[] = [
    { id: 'floor', label: 'Floor Grid' },
    { id: 'alerts', label: 'Alerts & Pagers' },
    { id: 'queue', label: 'Order Queue' },
    { id: 'shift', label: 'Shift Close' },
  ];
  const RAIL: { id: Tab | 'roster' | 'settings' | 'sos'; icon: typeof LayoutGrid; label: string; dot?: boolean }[] = [
    { id: 'floor', icon: LayoutGrid, label: 'Floor map' },
    { id: 'alerts', icon: BellRing, label: 'Service bell calls', dot: activeAlerts.length > 0 },
    { id: 'queue', icon: Monitor, label: 'Live docket' },
    { id: 'roster', icon: IdCard, label: 'Staff roster' },
  ];

  return (
    <div className="min-h-dvh bg-[#F8F9FF]">
      {/* Top bar */}
      <header className="fixed inset-x-0 top-0 z-40 flex h-14 items-center justify-between gap-3 border-b border-[#E5E7EB] bg-white px-4">
        <div className="flex min-w-0 items-center gap-3">
          <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-[#003A3E] text-xs font-bold text-white">
            TB
          </span>
          <div className="min-w-0 leading-tight">
            <p className="text-sm font-bold text-[#003A3E]">TableBells</p>
            <p className="truncate text-xs text-[#6B7280]">Staff Operations · {tenantSlug}</p>
          </div>
          <span className="mx-1 hidden h-6 w-px bg-[#E5E7EB] lg:block" />
          <span className="hidden items-center gap-1.5 rounded-xl bg-[#EFF4FF] px-2.5 py-1 text-xs text-[#1F2937] lg:inline-flex">
            <span className="h-2 w-2 animate-pulse rounded-full bg-[#10B981]" /> Service active
          </span>
          <span className="hidden items-center gap-1.5 rounded-xl bg-[#E6EEFF] px-2.5 py-1 text-[10px] font-bold uppercase xl:inline-flex">
            <span className="text-[#EF4444]">{activeAlerts.length} alerts</span>
            <span className="text-[#BFC8C9]">•</span>
            <span className="text-[#176B4B]">{occupied} tables open</span>
          </span>
        </div>

        <nav className="hidden items-center gap-1 rounded-xl bg-[#EFF4FF] p-1 md:flex">
          {NAV.map((n) => (
            <button
              key={n.id}
              type="button"
              onClick={() => setTab(n.id)}
              className={`rounded-lg px-3 py-1.5 text-sm font-semibold transition-colors ${
                tab === n.id ? 'bg-[#FF6B4A] text-white shadow-sm' : 'text-[#4B5563] hover:text-[#1F2937]'
              }`}
            >
              {n.label}
            </button>
          ))}
        </nav>

        <div className="flex items-center gap-2">
          <span className="hidden items-center gap-1 rounded-xl bg-[#EFF4FF] px-2.5 py-1.5 text-[10px] font-bold uppercase text-[#404849] lg:inline-flex">
            <Volume2 className="h-3.5 w-3.5 text-[#176B4B]" /> Sound on
          </span>
          <LockSwitchButton tenantSlug={tenantSlug} />
          <span className="flex h-8 w-8 items-center justify-center rounded-full bg-[#FF6B4A] text-xs font-bold text-white">
            {staff.displayName.slice(0, 1).toUpperCase()}
          </span>
        </div>
      </header>

      {/* Icon rail */}
      <aside className="fixed left-0 top-14 z-30 flex h-[calc(100dvh-3.5rem)] w-16 flex-col items-center justify-between border-r border-[#E5E7EB] bg-white py-4">
        <div className="flex flex-col items-center gap-2">
          {RAIL.map((r) => {
            const isActive = r.id === tab;
            return (
              <button
                key={r.id}
                type="button"
                title={r.label}
                aria-label={r.label}
                onClick={() => {
                  if (r.id === 'floor' || r.id === 'alerts' || r.id === 'queue') setTab(r.id);
                }}
                className={`relative flex h-11 w-11 items-center justify-center rounded-xl transition-colors ${
                  isActive ? 'bg-[#E6EEFF] text-[#003A3E]' : 'text-[#6B7280] hover:bg-[#EFF4FF] hover:text-[#1F2937]'
                }`}
              >
                <r.icon className="h-5 w-5" />
                {r.dot ? (
                  <span className="absolute right-2 top-2 h-2.5 w-2.5 rounded-full bg-[#EF4444] ring-2 ring-white" />
                ) : null}
              </button>
            );
          })}
        </div>
        <div className="flex flex-col items-center gap-2">
          <span className="flex h-11 w-11 items-center justify-center rounded-xl text-[#6B7280]">
            <SlidersHorizontal className="h-5 w-5" />
          </span>
          <span className="flex h-11 w-11 items-center justify-center rounded-xl bg-[#FFDAD6] text-[#93000A]">
            <Siren className="h-5 w-5" />
          </span>
        </div>
      </aside>

      {/* Content */}
      <div className="pl-16 pt-14">
        {/* Persistent alarm bar — shows on every tab until acknowledged / resolved */}
        {activeAlerts.length > 0 ? (
          <AlarmBar
            count={activeAlerts.length}
            sinceMs={activeAlerts[0].createdAt}
            terminalLabel={`${tenantSlug} console`}
            onOpen={() => setTab('alerts')}
          />
        ) : null}

        {/* Toolbar */}
        <div className="flex flex-wrap items-center gap-2 bg-[#EFF4FF] px-4 py-3 shadow-sm">
          <StatPill label="Capacity" value={`${live.tables.length} tables`} />
          <span className="inline-flex items-center gap-1.5 rounded-xl bg-[#1F2937] px-3 py-1.5 text-sm font-bold text-white">
            <span className="h-2 w-2 rounded-full bg-[#FF6B4A]" /> {occupied} occupied
            <span className="font-normal opacity-80">({pct}%)</span>
          </span>
          <span className="inline-flex items-center gap-1.5 rounded-xl border border-[#A7F3D0] bg-[#ECFDF5] px-3 py-1.5 text-sm font-bold text-[#047857]">
            <span className="h-2 w-2 rounded-full bg-[#10B981]" /> {available} available
          </span>
          <span className="inline-flex items-center gap-1.5 rounded-xl border border-[#FECACA] bg-[#FEF2F2] px-3 py-1.5 text-sm font-bold text-[#DC2626]">
            <span className={`h-2 w-2 rounded-full bg-[#EF4444] ${attention ? 'animate-ping' : ''}`} /> {attention} attention
          </span>

          {tab === 'floor' ? (
            <>
              <div className="flex flex-wrap items-center gap-1 rounded-xl bg-[#E6EEFF] p-1">
                <ZoneTab active={zone === 'all'} onClick={() => setZone('all')}>
                  All zones ({live.tables.length})
                </ZoneTab>
                {zones.map((z) => (
                  <ZoneTab key={z} active={zone === z} onClick={() => setZone(z)}>
                    {z === 'unzoned' ? 'Unzoned' : z} (
                    {live.tables.filter((t) => (t.zoneId || 'unzoned') === z).length})
                  </ZoneTab>
                ))}
              </div>
              <div className="ms-auto flex items-center gap-2">
                <div className="flex h-10 items-center gap-2 rounded-xl bg-white px-3 shadow-sm">
                  <Search className="h-4 w-4 text-[#6B7280]" />
                  <input
                    value={query}
                    onChange={(e) => setQuery(e.target.value)}
                    placeholder="Find table or server…"
                    className="w-44 bg-transparent text-sm text-[#1F2937] outline-none placeholder:text-[#9CA3AF]"
                  />
                </div>
                <span className="flex h-10 w-10 items-center justify-center rounded-xl bg-[#E6EEFF] text-[#003A3E]">
                  <RefreshCw className="h-4 w-4" />
                </span>
              </div>
            </>
          ) : null}
        </div>

        <main className="space-y-4 p-4">
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

          {tab === 'floor' ? (
            <TableOverviewGrid
              tables={live.tables}
              orders={live.orders}
              onSelectTable={setSelectedTableId}
              onHandleCall={handleHandleCall}
              zoneFilter={zone}
              query={query}
            />
          ) : null}

          {tab === 'alerts' ? (
            <AlertsPagersView
              activeAlerts={activeAlerts}
              tables={live.tables}
              orders={live.orders}
              staff={staff}
              money={money}
              onAcknowledge={acknowledgeAlert}
              onResolve={resolveActiveAlert}
              onReview={reviewActiveAlert}
              onOpenTable={setSelectedTableId}
            />
          ) : null}

          {tab === 'queue' ? (
            <OrderDispatchFeed
              orders={live.orders}
              liveStatus={live.status}
              staff={staff}
              branchId={branchId}
              tenantSlug={tenantSlug}
              onSelectTable={setSelectedTableId}
            />
          ) : null}

          {tab === 'shift' ? (
            <ShiftClose
              occupiedCount={occupied}
              floorTotal={money(floorTotalFils)}
              billingTables={billingTables.map((t) => ({ id: t.id, code: t.code }))}
              onOpenTable={setSelectedTableId}
            />
          ) : null}
        </main>
      </div>

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

function StatPill({ label, value }: { label: string; value: string }) {
  return (
    <span className="inline-flex items-center gap-1.5 rounded-xl bg-white px-3 py-1.5 text-sm shadow-sm">
      <span className="text-[10px] font-bold uppercase tracking-wide text-[#6B7280]">{label}</span>
      <span className="font-bold text-[#003A3E]">{value}</span>
    </span>
  );
}

function ZoneTab({ active, onClick, children }: { active: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`rounded-lg px-2.5 py-1 text-xs font-bold capitalize transition-colors ${
        active ? 'bg-[#FF6B4A] text-white shadow-sm' : 'text-[#4B5563] hover:text-[#1F2937]'
      }`}
    >
      {children}
    </button>
  );
}

function ShiftClose({
  occupiedCount,
  floorTotal,
  billingTables,
  onOpenTable,
}: {
  occupiedCount: number;
  floorTotal: string;
  billingTables: { id: string; code: string }[];
  onOpenTable: (id: string) => void;
}) {
  return (
    <div className="flex flex-col gap-4">
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
        <ShiftStat label="Occupied tables" value={String(occupiedCount)} />
        <ShiftStat label="On the floor" value={floorTotal} />
        <ShiftStat
          label="Bills requested"
          value={String(billingTables.length)}
          tone={billingTables.length ? 'warn' : undefined}
        />
      </div>
      <section className="rounded-xl border border-[#E5E7EB] bg-white p-5 shadow-sm">
        <h2 className="text-sm font-bold text-[#1F2937]">Tables waiting to settle</h2>
        {billingTables.length === 0 ? (
          <p className="mt-2 text-sm text-[#6B7280]">No bill requests open. Settle any table from the Floor Grid.</p>
        ) : (
          <ul className="mt-3 flex flex-col gap-2">
            {billingTables.map((t) => (
              <li key={t.id} className="flex items-center justify-between rounded-lg bg-[#EFF4FF] px-3 py-2">
                <span className="font-bold text-[#1F2937]">{t.code}</span>
                <button
                  type="button"
                  onClick={() => onOpenTable(t.id)}
                  className="rounded-lg bg-[#FF6B4A] px-3 py-1.5 text-xs font-bold text-white hover:bg-[#E05333]"
                >
                  Open to settle
                </button>
              </li>
            ))}
          </ul>
        )}
        <p className="mt-3 text-xs text-[#9CA3AF]">
          Settle &amp; Close lives inside each table&apos;s detail panel — it frees the table on the floor once handled.
        </p>
      </section>
    </div>
  );
}

function ShiftStat({ label, value, tone }: { label: string; value: string; tone?: 'warn' }) {
  return (
    <div className="rounded-xl border border-[#E5E7EB] bg-white p-4 shadow-sm">
      <span className="text-[10px] font-bold uppercase tracking-widest text-[#6B7280]">{label}</span>
      <p className={`mt-1 text-2xl font-bold tabular-nums ${tone === 'warn' ? 'text-[#D97706]' : 'text-[#1F2937]'}`}>
        {value}
      </p>
    </div>
  );
}
