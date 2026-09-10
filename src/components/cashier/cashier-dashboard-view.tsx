'use client';

/**
 * src/components/cashier/cashier-dashboard-view.tsx
 *
 * The Cashier / front-of-house console, restyled to the Stitch
 * "Utilitarian POS & Floor Console — Floor Grid" design: a white top bar
 * with a Floor Grid / Order Queue / Shift Close segmented nav, a zone
 * filter + search toolbar, and the table-card grid. Live data still
 * comes from `useLiveCashierData` (`tables` / `sessions` / `orders` /
 * `staffAlerts` snapshots); the void, alert-resolve and settle-&-close
 * flows are unchanged.
 */

import { useMemo, useState } from 'react';
import { LayoutGrid, ListOrdered, DoorClosed, Search } from 'lucide-react';
import { ClockProvider } from '@/components/providers/clock-provider';
import { TableOverviewGrid } from './table-overview-grid';
import { TableDetailPanel } from './table-detail-panel';
import { AlertsInbox } from './alerts-inbox';
import { ExecuteBanDialog } from './execute-ban-dialog';
import { LockSwitchButton } from '@/components/console/lock-switch-button';
import { voidTicketLine, resolveStaffAlert } from '@/server/actions/bill.actions';
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

type Tab = 'floor' | 'queue' | 'shift';

function Shell({ tenantSlug, message }: { tenantSlug: string; message: string }) {
  return (
    <div className="flex min-h-dvh flex-col bg-[#F3F4F6]">
      <header className="border-b border-[#E5E7EB] bg-white px-6 py-3">
        <p className="text-sm font-bold text-[#003A3E]">TableBells</p>
        <p className="text-xs text-[#6B7280]">Staff Operations · {tenantSlug}</p>
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

  const zones = useMemo(() => {
    const set = new Set<string>();
    for (const t of live.tables) set.add(t.zoneId || 'unzoned');
    return [...set].sort();
  }, [live.tables]);

  const occupiedCount = live.tables.filter((t) => t.partyCount > 0 || t.status === 'occupied').length;
  const billingTables = live.tables.filter((t) => t.parties.some((p) => p.status === 'billing'));
  const floorTotalFils = live.tables.reduce((s, t) => s + (t.openTabFils || 0), 0);
  const currency = live.orders.find((o) => typeof o.currency === 'string')?.currency;
  const money = (fils: number) => formatMoney(fils, currency);

  function handleExecuteBan({ alertId }: { alertId: string; rotateSlug: boolean }) {
    setDismissedAlertIds((prev) => new Set(prev).add(alertId));
    setReviewingAlert(null);
  }

  async function handleResolveAlert(alert: StaffAlert) {
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
  }

  if (live.status === 'loading') return <Shell tenantSlug={tenantSlug} message="Loading the floor…" />;
  if (live.status === 'error') {
    return <Shell tenantSlug={tenantSlug} message="Couldn't load live floor data. Check your connection." />;
  }

  const tabs: { id: Tab; label: string; icon: typeof LayoutGrid }[] = [
    { id: 'floor', label: 'Floor Grid', icon: LayoutGrid },
    { id: 'queue', label: 'Order Queue', icon: ListOrdered },
    { id: 'shift', label: 'Shift Close', icon: DoorClosed },
  ];

  return (
    <div className="flex min-h-dvh flex-col bg-[#F3F4F6]">
      {/* Top bar */}
      <header className="sticky top-0 z-30 flex flex-wrap items-center justify-between gap-3 border-b border-[#E5E7EB] bg-white px-6 py-3">
        <div className="flex items-center gap-5">
          <div>
            <p className="text-sm font-bold text-[#003A3E]">TableBells</p>
            <p className="text-xs text-[#6B7280]">Staff Operations · {tenantSlug}</p>
          </div>
          <nav className="flex items-center gap-1 rounded-xl bg-[#F3F4F6] p-1">
            {tabs.map((t) => (
              <button
                key={t.id}
                type="button"
                onClick={() => setTab(t.id)}
                className={`inline-flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-sm font-semibold transition-colors ${
                  tab === t.id ? 'bg-[#0F5257] text-white shadow-sm' : 'text-[#4B5563] hover:text-[#1F2937]'
                }`}
              >
                <t.icon className="h-4 w-4" />
                {t.label}
              </button>
            ))}
          </nav>
        </div>
        <div className="flex items-center gap-3">
          <div className="hidden text-end sm:block">
            <p className="text-sm font-semibold text-[#1F2937]">{staff.displayName}</p>
            <p className="text-xs text-[#6B7280]">{roleLabel(staff.role)}</p>
          </div>
          <LockSwitchButton tenantSlug={tenantSlug} />
        </div>
      </header>

      {/* Toolbar (floor tab only) */}
      {tab === 'floor' ? (
        <div className="flex flex-wrap items-center gap-2 border-b border-[#E5E7EB] bg-white px-6 py-2.5">
          <div className="flex flex-wrap items-center gap-1 rounded-lg bg-[#F3F4F6] p-1">
            <ZoneTab active={zone === 'all'} onClick={() => setZone('all')}>
              All zones ({live.tables.length})
            </ZoneTab>
            {zones.map((z) => (
              <ZoneTab key={z} active={zone === z} onClick={() => setZone(z)}>
                {z === 'unzoned' ? 'Unzoned' : z} ({live.tables.filter((t) => (t.zoneId || 'unzoned') === z).length})
              </ZoneTab>
            ))}
          </div>
          <div className="ms-auto flex h-9 items-center gap-2 rounded-lg border border-[#E5E7EB] bg-[#F3F4F6] px-3">
            <Search className="h-4 w-4 text-[#6B7280]" />
            <input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Find table…"
              className="w-40 bg-transparent text-sm text-[#1F2937] outline-none placeholder:text-[#9CA3AF]"
            />
          </div>
          {visibleAlerts.length > 0 ? (
            <span className="rounded-full bg-[#FEE2E2] px-2.5 py-1 text-xs font-bold text-[#E5484D] ring-1 ring-[#FCA5A5]">
              {visibleAlerts.length} alert{visibleAlerts.length === 1 ? '' : 's'}
            </span>
          ) : null}
        </div>
      ) : null}

      <main className="flex-1 space-y-4 px-6 py-4">
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
          <>
            {visibleAlerts.length > 0 ? (
              <section>
                <h2 className="mb-2 text-[10px] font-bold uppercase tracking-widest text-[#6B7280]">Alerts</h2>
                <AlertsInbox
                  alerts={visibleAlerts}
                  staff={staff}
                  onReview={setReviewingAlert}
                  onResolve={handleResolveAlert}
                />
              </section>
            ) : null}
            <TableOverviewGrid
              tables={live.tables}
              onSelectTable={setSelectedTableId}
              zoneFilter={zone}
              query={query}
            />
          </>
        ) : null}

        {tab === 'queue' ? (
          <OrderQueue orders={live.orders} money={money} onSelectTable={setSelectedTableId} />
        ) : null}

        {tab === 'shift' ? (
          <ShiftClose
            occupiedCount={occupiedCount}
            floorTotal={money(floorTotalFils)}
            billingTables={billingTables.map((t) => ({ id: t.id, code: t.code }))}
            onOpenTable={setSelectedTableId}
          />
        ) : null}
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

function ZoneTab({
  active,
  onClick,
  children,
}: {
  active: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`rounded-md px-2.5 py-1 text-xs font-semibold capitalize transition-colors ${
        active ? 'bg-white text-[#0F5257] shadow-sm' : 'text-[#4B5563] hover:text-[#1F2937]'
      }`}
    >
      {children}
    </button>
  );
}

interface QueueOrder {
  id: string;
  code: string;
  tableCode: string;
  tableId: string;
  status: string;
  grossFils: number;
  items: { qty: number }[];
}

function OrderQueue({
  orders,
  money,
  onSelectTable,
}: {
  orders: QueueOrder[];
  money: (fils: number) => string;
  onSelectTable: (id: string) => void;
}) {
  if (orders.length === 0) {
    return (
      <p className="rounded-xl border border-[#E5E7EB] bg-white px-4 py-10 text-center text-sm text-[#6B7280]">
        No open tickets right now.
      </p>
    );
  }
  return (
    <div className="overflow-hidden rounded-xl border border-[#E5E7EB] bg-white shadow-sm">
      <table className="w-full text-left text-sm">
        <thead>
          <tr className="bg-[#F3F4F6] text-[10px] uppercase tracking-widest text-[#6B7280]">
            <th className="px-4 py-3 font-bold">Ticket</th>
            <th className="px-3 py-3 font-bold">Table</th>
            <th className="px-3 py-3 font-bold">Items</th>
            <th className="px-3 py-3 font-bold">Status</th>
            <th className="px-4 py-3 text-right font-bold">Total</th>
          </tr>
        </thead>
        <tbody>
          {orders.map((o) => (
            <tr
              key={o.id}
              onClick={() => onSelectTable(o.tableId)}
              className="cursor-pointer border-t border-[#F3F4F6] hover:bg-[#F3F4F6]/60"
            >
              <td className="px-4 py-3 font-mono font-semibold text-[#1F2937]">#{o.code}</td>
              <td className="px-3 py-3 text-[#4B5563]">{o.tableCode}</td>
              <td className="px-3 py-3 text-[#4B5563]">
                {o.items.reduce((n, it) => n + (it.qty || 0), 0)}
              </td>
              <td className="px-3 py-3">
                <span className="rounded bg-[#DEE9FC] px-2 py-0.5 text-[10px] font-bold uppercase text-[#0F5257]">
                  {o.status}
                </span>
              </td>
              <td className="px-4 py-3 text-right font-semibold tabular-nums text-[#1F2937]">{money(o.grossFils)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
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
        <ShiftStat label="Bills requested" value={String(billingTables.length)} tone={billingTables.length ? 'warn' : undefined} />
      </div>

      <section className="rounded-xl border border-[#E5E7EB] bg-white p-5 shadow-sm">
        <h2 className="text-sm font-bold text-[#1F2937]">Tables waiting to settle</h2>
        {billingTables.length === 0 ? (
          <p className="mt-2 text-sm text-[#6B7280]">No bill requests open. Settle any table from the Floor Grid.</p>
        ) : (
          <ul className="mt-3 flex flex-col gap-2">
            {billingTables.map((t) => (
              <li key={t.id} className="flex items-center justify-between rounded-lg bg-[#F3F4F6] px-3 py-2">
                <span className="font-bold text-[#1F2937]">{t.code}</span>
                <button
                  type="button"
                  onClick={() => onOpenTable(t.id)}
                  className="rounded-lg bg-[#0F5257] px-3 py-1.5 text-xs font-bold text-white hover:bg-[#093336]"
                >
                  Open to settle
                </button>
              </li>
            ))}
          </ul>
        )}
        <p className="mt-3 text-xs text-[#9CA3AF]">
          Settle &amp; Close lives inside each table&apos;s detail panel — it verifies payment handling and frees the
          table on the floor.
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
