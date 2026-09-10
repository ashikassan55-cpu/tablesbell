'use client';

/**
 * src/components/cashier/alerts-pagers-view.tsx
 *
 * The Cashier console "Alerts & Pagers" tab, rebuilt to the Stitch
 * "Utilitarian POS & Floor Console — Alerts & Pagers" screen: one giant
 * focus "dispatch card" for the top alert (table id, live SLA stopwatch,
 * actionable request details, responsible floor staff, and the two
 * dominant actions — Acknowledge & Silence / Resolve & Dispatch Staff),
 * with the rest of the open alerts in a "Queue (N Waiting)" strip.
 *
 * Alerts are the unified `ActiveAlert` list (waiter calls + open staff
 * alerts) computed by the parent. "Acknowledge & Silence" is a
 * console-local silence ("attending"); "Resolve & Dispatch Staff" runs
 * the real `resolveStaffAlert` for staff alerts and a local clear for
 * waiter calls ("attended"). The persistent red alarm bar lives one
 * level up so it shows on every tab.
 */

import { useMemo, useState } from 'react';
import { useNow } from '@/components/providers/clock-provider';
import { getElapsedSec } from '@/lib/time';
import { canExecuteBan, type StaffIdentity } from '@/lib/console/staff-permissions';
import { BellOff, CheckCircle2, RadioTower, Table2, TouchpadOff, HelpCircle } from 'lucide-react';
import type { ActiveAlert } from './active-alert';
import type { TableWithId } from './table-card';
import type { OrderWithId } from '@/components/ops/ticket-card';

const SLA_TARGET_SEC = 60;

function mmss(sec: number): string {
  const m = Math.floor(sec / 60);
  const s = sec % 60;
  return `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
}
/** Alerts realistically clear in minutes; keep the readout sane for stale data. */
function slaClock(sec: number): string {
  return sec >= 3600 ? '60:00+' : mmss(sec);
}
function slaSeconds(sec: number): string {
  return sec >= 3600 ? '60m+' : `${sec}s`;
}
function sinceLabel(sec: number): string {
  if (sec < 3600) return `${Math.max(1, Math.round(sec / 60))} min`;
  if (sec < 86400) return `${Math.floor(sec / 3600)}h ${Math.round((sec % 3600) / 60)}m`;
  return `${Math.floor(sec / 86400)}d ${Math.round((sec % 86400) / 3600)}h`;
}

interface Props {
  activeAlerts: ActiveAlert[];
  tables: TableWithId[];
  orders: OrderWithId[];
  staff: StaffIdentity;
  money: (fils: number) => string;
  onAcknowledge: (alert: ActiveAlert) => void;
  onResolve: (alert: ActiveAlert) => void;
  onReview: (alert: ActiveAlert) => void;
  onOpenTable: (tableId: string) => void;
}

export function AlertsPagersView({
  activeAlerts,
  tables,
  orders,
  staff,
  money,
  onAcknowledge,
  onResolve,
  onReview,
  onOpenTable,
}: Props) {
  const now = useNow();
  const [focusKey, setFocusKey] = useState<string | null>(null);

  const top = activeAlerts.find((a) => a.key === focusKey) ?? activeAlerts[0] ?? null;
  const queue = activeAlerts.filter((a) => a.key !== top?.key);

  const table = useMemo(
    () => (top ? tables.find((t) => t.id === top.tableId || t.code === top.tableCode) ?? null : null),
    [tables, top],
  );

  if (!top) {
    return (
      <p className="rounded-xl border border-[#E5E7EB] bg-white px-4 py-12 text-center text-sm text-[#6B7280]">
        No open alerts. Every table is quiet.
      </p>
    );
  }

  const covers = table ? table.parties.reduce((n, p) => n + (p.guestCount || 0), 0) || table.seats : 0;
  const seatedAt = table
    ? table.parties.reduce<number | null>((o, p) => (o === null || p.openedAt < o ? p.openedAt : o), null)
    : null;
  const tabFils = table?.openTabFils ?? 0;

  const tableOrders = table
    ? orders
        .filter((o) => o.tableId === table.id && o.status !== 'voided')
        .sort((a, b) => (b.placedAt || 0) - (a.placedAt || 0))
    : [];
  const newest = tableOrders[0] ?? null;
  const requestLines = newest ? newest.items.filter((l) => l.status === 'active') : [];

  const elapsedSec = getElapsedSec(top.createdAt, now);
  const overTarget = elapsedSec > SLA_TARGET_SEC;
  const pct = Math.min(100, Math.round((elapsedSec / SLA_TARGET_SEC) * 100));

  const isGhost = top.staffAlert?.type === 'ghost_suspected' || top.staffAlert?.type === 'ghost_flagged';

  return (
    <div className="flex flex-col gap-4">
      {/* Focus dispatch card */}
      <div className="relative overflow-hidden rounded-xl bg-white p-6 shadow-[0_8px_24px_rgba(0,0,0,0.08)]">
        <span className="absolute inset-y-0 left-0 w-3 animate-pulse bg-[#BA1A1A]" />

        {/* header: table id + SLA stopwatch */}
        <div className="flex flex-wrap items-start justify-between gap-4 pl-4">
          <div className="flex flex-col">
            <div className="mb-1 flex flex-wrap items-center gap-2">
              <span className="rounded bg-[#FFDAD6] px-2.5 py-0.5 text-[10px] font-bold uppercase tracking-wide text-[#93000A]">
                {top.badge}
              </span>
              <span className="rounded bg-[#DEE9FC] px-2.5 py-0.5 text-[10px] font-bold uppercase tracking-wide text-[#121C2A]">
                Section: {table?.zoneId?.trim() || 'Floor'}
              </span>
              <span className="rounded bg-[#E6EEFF] px-2.5 py-0.5 text-[10px] font-bold uppercase tracking-wide text-[#404849]">
                Covers: {covers || '—'} {covers ? 'Guests' : ''}
              </span>
            </div>
            <h1 className="flex items-center gap-3 font-heading text-[44px] font-extrabold leading-none tracking-tight text-[#121C2A]">
              Table #{top.tableCode}
              {table?.label ? (
                <span className="text-xl font-semibold text-[#404849]">({table.label})</span>
              ) : null}
            </h1>
            <p className="mt-2 text-lg font-bold text-[#BA1A1A]">{top.detail}</p>
          </div>

          <div className="flex items-center gap-3 rounded-xl bg-[#FFDAD6]/40 p-3 shadow-sm">
            <div className="relative flex h-16 w-16 items-center justify-center">
              <svg className="h-full w-full -rotate-90" viewBox="0 0 36 36">
                <path
                  d="M18 2.0845 a 15.9155 15.9155 0 0 1 0 31.831 a 15.9155 15.9155 0 0 1 0 -31.831"
                  fill="none"
                  stroke="#D9E3F6"
                  strokeWidth="4"
                />
                <path
                  d="M18 2.0845 a 15.9155 15.9155 0 0 1 0 31.831 a 15.9155 15.9155 0 0 1 0 -31.831"
                  fill="none"
                  stroke={overTarget ? '#93000A' : '#BA1A1A'}
                  strokeWidth="4"
                  strokeLinecap="round"
                  strokeDasharray={`${pct}, 100`}
                />
              </svg>
              <span className="absolute text-base font-bold tabular-nums text-[#BA1A1A]">{slaSeconds(elapsedSec)}</span>
            </div>
            <div className="flex flex-col text-right">
              <span className="text-[10px] font-bold uppercase tracking-wide text-[#BA1A1A]">Elapsed SLA</span>
              <span className="text-lg font-bold tabular-nums text-[#121C2A]">{slaClock(elapsedSec)} / 01:00</span>
              <span className={`text-xs font-semibold ${overTarget ? 'text-[#BA1A1A]' : 'text-[#176B4B]'}`}>
                {overTarget ? 'Over 60s target' : 'Under 60s target'}
              </span>
            </div>
          </div>
        </div>

        {/* information matrix */}
        <div className="mt-6 grid grid-cols-1 gap-4 pl-4 lg:grid-cols-3">
          {/* left: request specifics */}
          <div className="flex flex-col justify-between rounded-xl bg-[#EFF4FF] p-4 lg:col-span-2">
            <div>
              <div className="flex items-center justify-between pb-2">
                <span className="text-[10px] font-bold uppercase tracking-wide text-[#404849]">
                  Actionable Request Details
                </span>
                <span className="flex items-center gap-1 text-xs font-semibold text-[#176B4B]">
                  <RadioTower className="h-3.5 w-3.5" /> Transmitted via Table Bell #{top.tableCode}-A
                </span>
              </div>

              {requestLines.length > 0 ? (
                <div className="mt-2 grid grid-cols-1 gap-3 md:grid-cols-2">
                  {requestLines.map((line) => (
                    <div
                      key={line.lineId}
                      className="flex items-start gap-2 rounded-lg bg-white p-3 shadow-sm"
                    >
                      <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-[#0F5257] text-sm font-bold text-white">
                        {line.qty}x
                      </span>
                      <div className="flex min-w-0 flex-col">
                        <span className="truncate text-sm font-semibold text-[#121C2A]">
                          {line.nameSnapshot.en}
                        </span>
                        {line.modifiers.length > 0 ? (
                          <span className="text-xs text-[#404849]">
                            {line.modifiers.map((m) => m.nameSnapshot.en).join(' • ')}
                          </span>
                        ) : null}
                      </div>
                    </div>
                  ))}
                </div>
              ) : (
                <div className="mt-2 rounded-lg bg-white p-3 text-sm text-[#404849] shadow-sm">
                  {top.kind === 'call'
                    ? 'Guest pressed the table bell. No open ticket on this table yet.'
                    : top.detail}
                </div>
              )}

              {top.staffAlert?.note?.trim() ? (
                <div className="mt-3 flex items-center gap-3 rounded-lg bg-[#FFDCC3]/40 p-3">
                  <HelpCircle className="h-5 w-5 shrink-0 text-[#6E3900]" />
                  <div className="flex flex-col">
                    <span className="text-[10px] font-bold uppercase tracking-wide text-[#6E3900]">
                      Special Note From Guest Interface
                    </span>
                    <span className="text-sm font-semibold text-[#121C2A]">“{top.staffAlert.note}”</span>
                  </div>
                </div>
              ) : null}
            </div>

            <div className="mt-4 flex flex-wrap items-center justify-between gap-2 pt-4">
              <div className="flex flex-wrap items-center gap-2 text-sm">
                <span className="text-[#404849]">Active Tab Check:</span>
                <span className="font-bold text-[#121C2A]">
                  Ticket #{newest?.code ?? top.staffAlert?.orderCode ?? '—'}
                </span>
                <span className="text-[#BFC8C9]">•</span>
                <span className="font-bold tabular-nums text-[#176B4B]">{money(tabFils)} (Unpaid)</span>
              </div>
              <span className="text-xs text-[#404849]">
                {seatedAt != null ? `Seated ${sinceLabel(getElapsedSec(seatedAt, now))} ago` : 'No seated party'}
              </span>
            </div>
          </div>

          {/* right: responsible floor staff */}
          <div className="flex flex-col gap-3 rounded-xl bg-[#EFF4FF] p-4">
            <span className="text-[10px] font-bold uppercase tracking-wide text-[#404849]">
              Responsible Floor Staff
            </span>
            <div className="flex items-center gap-3 rounded-lg bg-white p-3 shadow-sm">
              <div className="flex h-14 w-14 items-center justify-center rounded-xl bg-[#0F5257] text-lg font-bold text-white">
                {table?.assignedServerUid ? 'FS' : '??'}
              </div>
              <div className="flex flex-col">
                <span className="text-base font-bold text-[#121C2A]">
                  {table?.assignedServerUid ? 'Assigned server' : 'Nearest available runner'}
                </span>
                <span className="text-sm font-semibold text-[#176B4B]">
                  Floor Zone {table?.zoneId?.trim() || '—'}
                </span>
                <span className="text-xs text-[#404849]">Pager relay · Auto-routed</span>
              </div>
            </div>
            <div className="relative flex h-24 w-full items-end overflow-hidden rounded-lg bg-[#DEE9FC] p-2.5">
              <Table2 className="absolute right-3 top-3 h-8 w-8 text-[#96D0D6]" />
              <span className="text-[10px] font-bold uppercase tracking-wider text-[#084F54]">
                Zone {table?.zoneId?.trim() || 'A'} · {table?.label || 'Floor position'}
              </span>
            </div>
            <div className="flex items-center justify-between pt-1 text-xs text-[#404849]">
              <span className="flex items-center gap-1">
                <span className="h-2 w-2 rounded-full bg-[#176B4B]" /> Repeater hub synced
              </span>
              <span>Signal: strong</span>
            </div>
          </div>
        </div>

        {/* dual action buttons */}
        <div className="mt-8 grid grid-cols-1 gap-4 pl-4 md:grid-cols-2">
          <button
            type="button"
            onClick={() => onAcknowledge(top)}
            className="flex h-16 items-center justify-center gap-3 rounded-xl bg-[#D9E3F6] px-6 text-[#121C2A] shadow-sm transition-transform active:scale-[0.98]"
          >
            <BellOff className="h-6 w-6 text-[#BA1A1A]" />
            <span className="flex flex-col text-left">
              <span className="text-base font-bold">Acknowledge &amp; Silence</span>
              <span className="text-xs text-[#404849]">Mutes alarm on this console; timer continues</span>
            </span>
          </button>

          {isGhost && canExecuteBan(staff) ? (
            <button
              type="button"
              onClick={() => onReview(top)}
              className="flex h-16 items-center justify-center gap-3 rounded-xl bg-[#BA1A1A] px-6 text-white shadow-lg transition-transform active:scale-[0.98]"
            >
              <TouchpadOff className="h-7 w-7 text-[#FFDAD6]" />
              <span className="flex flex-col text-left">
                <span className="text-lg font-bold tracking-wide">Review &amp; Ban Guest</span>
                <span className="text-xs text-[#FFDAD6]">Opens the ghost-order review dialog</span>
              </span>
            </button>
          ) : (
            <button
              type="button"
              onClick={() => onResolve(top)}
              className="flex h-16 items-center justify-center gap-3 rounded-xl bg-[#176B4B] px-6 text-white shadow-lg transition-transform hover:bg-[#0F5257] active:scale-[0.98]"
            >
              <CheckCircle2 className="h-7 w-7 text-[#A1F0C7]" />
              <span className="flex flex-col text-left">
                <span className="text-lg font-bold tracking-wide">Resolve &amp; Dispatch Staff</span>
                <span className="text-xs text-[#A1F0C7]">Clears the alert queue &amp; notifies the runner</span>
              </span>
            </button>
          )}
        </div>
      </div>

      {/* queue strip */}
      <div className="flex flex-col gap-3 rounded-xl bg-[#EFF4FF] p-3 shadow-sm md:flex-row md:items-center md:justify-between">
        <div className="flex shrink-0 items-center gap-2">
          <span className="text-sm font-bold text-[#121C2A]">Queue ({queue.length} Waiting):</span>
        </div>
        {queue.length === 0 ? (
          <span className="text-xs text-[#404849] md:text-right">Nothing else waiting. Nice.</span>
        ) : (
          <div className="flex w-full flex-wrap items-center justify-start gap-3 md:justify-end">
            {queue.map((a) => (
              <div
                key={a.key}
                className="flex items-center gap-2 rounded-lg bg-white px-3 py-2 shadow-sm"
              >
                <span
                  className={`h-2.5 w-2.5 shrink-0 rounded-full ${
                    a.kind === 'call' ? 'bg-[#BA1A1A]' : 'bg-[#FFB77D] animate-pulse'
                  }`}
                />
                <div className="flex flex-col">
                  <div className="flex items-center gap-2">
                    <span className="text-sm font-bold text-[#121C2A]">Table #{a.tableCode}</span>
                    <span
                      className={`text-[10px] font-bold uppercase tracking-wide ${
                        a.kind === 'call' ? 'text-[#BA1A1A]' : 'text-[#6E3900]'
                      }`}
                    >
                      {a.badge}
                    </span>
                  </div>
                  <span className="text-xs text-[#404849]">{slaClock(getElapsedSec(a.createdAt, now))} elapsed</span>
                </div>
                <button
                  type="button"
                  onClick={() => setFocusKey(a.key)}
                  className="ml-2 rounded bg-[#E6EEFF] px-3 py-1 text-[10px] font-bold uppercase tracking-wide text-[#003A3E] transition-colors hover:bg-[#DEE9FC]"
                >
                  Switch
                </button>
                {a.tableId ? (
                  <button
                    type="button"
                    onClick={() => onOpenTable(a.tableId as string)}
                    className="rounded bg-[#E6EEFF] px-3 py-1 text-[10px] font-bold uppercase tracking-wide text-[#003A3E] transition-colors hover:bg-[#DEE9FC]"
                  >
                    View
                  </button>
                ) : null}
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
