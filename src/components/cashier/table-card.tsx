'use client';

/**
 * src/components/cashier/table-card.tsx
 *
 * A floor node built to match the Stitch "Utilitarian POS & Floor
 * Console — Floor Grid" card, state for state:
 *
 *   WAITER CALL   red pulsing band · red chip + "Nm ago" · reason box ·
 *                 "Tab: N items" + total · [Call Handled] [receipt]
 *   BILL REQUEST  amber pulsing band · amber chip + "Nm ago" · "Bill
 *                 printed" box · "Seated Nm" + total · [Settle Bill] [split]
 *   OCCUPIED      amber band · "Preparing/Dining/Served" chip · items or
 *                 prep-progress box · "Seated Nm" + total · [Add Item] [receipt]
 *   AVAILABLE     green band · "Available" chip · "Ready to seat" box ·
 *                 "No active tab" + AED 0.00 · [Seat Guests]
 *   DISABLED      grey band · "Disabled" chip · no action
 *
 * Concrete colours are the design's own overrides: bands #FF6B4A /
 * #10B981 / #EF4444, dark #1F2937 primary button, table id in Plus
 * Jakarta Sans 32px, totals in bold tabular #1F2937.
 */

import { useNow } from '@/components/providers/clock-provider';
import { getElapsedSec, formatElapsed } from '@/lib/time';
import type { Table } from '@/types/firestore';
import type { OrderWithId } from '@/components/ops/ticket-card';

export interface TableWithId extends Table {
  id: string;
}

function formatAed(fils: number): string {
  return `AED ${(fils / 100).toFixed(2)}`;
}
function agoLabel(ms: number, now: number): string {
  const s = Math.max(0, Math.floor((now - ms) / 1000));
  const m = Math.floor(s / 60);
  const r = s % 60;
  return `${String(m).padStart(2, '0')}:${String(r).padStart(2, '0')}m ago`;
}

type CardState = 'call' | 'bill' | 'occupied' | 'available' | 'disabled';

function stateOf(t: TableWithId): CardState {
  if (t.activeCall || t.status === 'attention') return 'call';
  if (t.parties.some((p) => p.status === 'billing')) return 'bill';
  if (t.status === 'disabled') return 'disabled';
  if (t.status === 'occupied' || t.partyCount > 0) return 'occupied';
  return 'available';
}

const BAND: Record<CardState, string> = {
  call: 'bg-[#EF4444] animate-pulse',
  bill: 'bg-[#FF6B4A] animate-pulse',
  occupied: 'bg-[#FF6B4A]',
  available: 'bg-[#10B981]',
  disabled: 'bg-[#9CA3AF]',
};

interface Props {
  table: TableWithId;
  orders: OrderWithId[];
  onSelect: (tableId: string) => void;
  onHandleCall: (tableId: string) => void;
}

export function TableCard({ table, orders, onSelect, onHandleCall }: Props) {
  const now = useNow();
  const state = stateOf(table);
  const guests = table.parties.reduce((n, p) => n + (p.guestCount || 0), 0) || table.partyCount;
  const seatedAt = table.parties.reduce<number | null>(
    (o, p) => (o === null || p.openedAt < o ? p.openedAt : o),
    null,
  );
  const seatedLabel = seatedAt !== null ? `Seated ${formatElapsed(getElapsedSec(seatedAt, now))}` : 'Seated';

  const live = orders.filter((o) => o.status !== 'voided');
  const itemCount = live.reduce((n, o) => n + o.items.filter((i) => i.status !== 'voided').reduce((a, i) => a + i.qty, 0), 0);
  const newest = live.slice().sort((a, b) => (b.placedAt || 0) - (a.placedAt || 0))[0];
  const itemsSummary = newest
    ? newest.items
        .filter((i) => i.status !== 'voided')
        .map((i) => `${i.qty}x ${i.nameSnapshot.en}`)
        .join(', ')
    : '';
  const prepping = live.some((o) => o.status === 'new' || o.status === 'prep');
  const subStatus = prepping ? 'Preparing' : live.length > 0 ? 'Served' : 'Dining';

  const openCard = () => onSelect(table.id);

  return (
    <div className="relative flex min-h-[168px] flex-col justify-between overflow-hidden rounded-xl border border-[#E5E7EB] bg-white p-3 shadow-sm transition-shadow hover:shadow-md">
      <span className={`absolute inset-x-0 top-0 h-1.5 ${BAND[state]}`} />

      {/* tap target = header + body */}
      <button type="button" onClick={openCard} className="w-full text-start">
        <div className="flex items-start justify-between gap-2">
          <div className="min-w-0">
            <span className="block font-heading text-[30px] font-bold leading-none tracking-tight text-[#1F2937]">
              {table.code}
            </span>
            <span className="mt-1 block truncate text-xs text-[#6B7280]">
              {state === 'available' || state === 'disabled'
                ? `Capacity: ${table.seats} seats`
                : `👥 ${guests} guest${guests === 1 ? '' : 's'}${table.zoneId ? ` · ${table.zoneId}` : ''}`}
            </span>
          </div>

          {state === 'call' ? (
            <div className="flex flex-col items-end">
              <span className="flex items-center gap-1 rounded bg-[#FFDAD6] px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide text-[#93000A]">
                🔔 Waiter call
              </span>
              {table.activeCall ? (
                <span className="mt-1 text-xs font-bold tabular-nums text-[#EF4444]">
                  {agoLabel(table.activeCall.createdAt, now)}
                </span>
              ) : null}
            </div>
          ) : state === 'bill' ? (
            <div className="flex flex-col items-end">
              <span className="flex items-center gap-1 rounded bg-[#FFDCC3] px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide text-[#2F1500]">
                💰 Bill request
              </span>
            </div>
          ) : state === 'available' ? (
            <span className="flex items-center gap-1 rounded bg-[#A1F0C7] px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide text-[#1D704F]">
              <span className="h-1.5 w-1.5 rounded-full bg-[#10B981]" /> Available
            </span>
          ) : state === 'disabled' ? (
            <span className="rounded bg-[#F3F4F6] px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide text-[#6B7280]">
              Disabled
            </span>
          ) : (
            <span
              className={`rounded px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide text-[#003A3E] ${
                subStatus === 'Preparing' ? 'bg-[#DEE9FC]' : 'bg-[#E6EEFF]'
              }`}
            >
              {subStatus}
            </span>
          )}
        </div>

        {/* body box */}
        {state === 'call' ? (
          <div className="mt-3 flex items-center justify-between rounded-lg bg-[#FFDAD6]/50 p-2">
            <span className="truncate text-xs font-semibold text-[#7A1E22]">
              {table.activeCall?.type ?? 'Service call'}
            </span>
            <span className="shrink-0 text-[10px] font-bold uppercase text-[#EF4444]">Urgent</span>
          </div>
        ) : state === 'bill' ? (
          <div className="mt-3 flex items-center justify-between rounded-lg bg-[#EFF4FF] p-2">
            <span className="text-xs text-[#404849]">Awaiting settlement</span>
            <span className="text-[10px] font-bold uppercase text-[#6B7280]">Bill printed</span>
          </div>
        ) : state === 'occupied' && prepping ? (
          <div className="mt-3 flex flex-col gap-1">
            <div className="flex items-center justify-between text-xs">
              <span className="text-[#6B7280]">In the kitchen</span>
              <span className="font-semibold text-[#176B4B]">{itemCount} item{itemCount === 1 ? '' : 's'}</span>
            </div>
            <div className="h-1.5 w-full overflow-hidden rounded-full bg-[#E6EEFF]">
              <div className="h-full w-2/3 rounded-full bg-[#10B981]" />
            </div>
          </div>
        ) : state === 'occupied' ? (
          <div className="mt-3 rounded-lg bg-[#EFF4FF] p-2">
            <p className="truncate text-xs text-[#404849]">{itemsSummary || `${itemCount} items on the tab`}</p>
          </div>
        ) : state === 'available' ? (
          <div className="mt-4 rounded-lg bg-[#EFF4FF] p-3 text-center">
            <span className="text-xs text-[#6B7280]">
              {table.lastSanitizedAt
                ? `Turned & sanitized ${formatElapsed(getElapsedSec(table.lastSanitizedAt, now))} ago`
                : 'Ready to seat'}
            </span>
          </div>
        ) : (
          <div className="mt-4 rounded-lg bg-[#F3F4F6] p-3 text-center">
            <span className="text-xs text-[#6B7280]">Not in service</span>
          </div>
        )}

        {/* total row */}
        <div className="mt-3 flex items-center justify-between text-xs text-[#6B7280]">
          <span className="tabular-nums">
            {state === 'call'
              ? `Tab: ${itemCount} item${itemCount === 1 ? '' : 's'}`
              : state === 'available' || state === 'disabled'
                ? 'No active tab'
                : seatedLabel}
            {table.partyCount > 1 ? <span className="font-semibold"> · {table.partyCount} parties</span> : null}
          </span>
          <span
            className={`text-base font-bold tabular-nums ${
              state === 'available' || state === 'disabled' ? 'text-[#BFC8C9]' : 'text-[#1F2937]'
            }`}
          >
            {formatAed(table.openTabFils)}
          </span>
        </div>
      </button>

      {/* action row */}
      <div className="mt-3 flex items-center gap-2 pt-1">
        {state === 'call' ? (
          <>
            <button
              type="button"
              onClick={() => onHandleCall(table.id)}
              className="flex min-h-[44px] flex-1 items-center justify-center gap-1 rounded-lg bg-[#EF4444] text-sm font-bold text-white shadow-sm transition-transform hover:bg-[#DC2626] active:scale-95"
            >
              ✓ Call handled
            </button>
            <SquareBtn onClick={openCard} label="Table details">🧾</SquareBtn>
          </>
        ) : state === 'bill' ? (
          <>
            <button
              type="button"
              onClick={openCard}
              className="flex min-h-[44px] flex-1 items-center justify-center gap-1 rounded-lg bg-[#FF6B4A] text-sm font-bold text-white shadow-sm transition-transform hover:bg-[#E05333] active:scale-95"
            >
              💳 Settle bill
            </button>
            <SquareBtn onClick={openCard} label="Split bill">⑃</SquareBtn>
          </>
        ) : state === 'occupied' ? (
          <>
            <button
              type="button"
              onClick={openCard}
              className="flex min-h-[44px] flex-1 items-center justify-center gap-1 rounded-lg bg-[#1F2937] text-sm font-bold text-white shadow-sm transition-transform hover:bg-[#111827] active:scale-95"
            >
              + Open tab
            </button>
            <SquareBtn onClick={openCard} label="Table details">🧾</SquareBtn>
          </>
        ) : state === 'available' ? (
          <button
            type="button"
            onClick={openCard}
            className="flex min-h-[44px] w-full items-center justify-center gap-1 rounded-lg bg-[#10B981] text-sm font-bold text-white shadow-sm transition-transform hover:bg-[#059669] active:scale-95"
          >
            👤 Seat guests
          </button>
        ) : (
          <button
            type="button"
            disabled
            className="min-h-[44px] w-full rounded-lg bg-[#F3F4F6] text-sm font-semibold text-[#9CA3AF]"
          >
            Out of service
          </button>
        )}
      </div>
    </div>
  );
}

function SquareBtn({
  onClick,
  label,
  children,
}: {
  onClick: () => void;
  label: string;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      title={label}
      aria-label={label}
      className="flex h-11 w-11 shrink-0 items-center justify-center rounded-lg bg-[#E6EEFF] text-[#003A3E] transition-colors hover:bg-[#DEE9FC]"
    >
      {children}
    </button>
  );
}
