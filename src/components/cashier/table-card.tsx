'use client';

/**
 * src/components/cashier/table-card.tsx
 *
 * A floor node from the Stitch "Utilitarian POS & Floor Console" design:
 * a white `rounded-xl` card with a 4px status band across the top —
 * teal for a seated/occupied table, crimson for an active customer call,
 * amber (pulsing) for a bill request or a table needing reset, grey for
 * an empty table. Crimson is never decorative (RULES.md §3). Table id is
 * large; total + elapsed use tabular numerals. The whole card is the tap
 * target — it opens the table detail panel.
 */

import { useNow } from '@/components/providers/clock-provider';
import { getElapsedSec, formatElapsed } from '@/lib/time';
import type { Table } from '@/types/firestore';

export interface TableWithId extends Table {
  id: string;
}

function formatAed(fils: number): string {
  return `AED ${(fils / 100).toFixed(2)}`;
}

type CardState = 'call' | 'bill' | 'occupied' | 'dirty' | 'available' | 'disabled';

const BAND: Record<CardState, string> = {
  call: 'bg-[#E5484D]',
  bill: 'bg-[#D97706] animate-pulse',
  occupied: 'bg-[#0F5257]',
  dirty: 'bg-[#D97706]',
  available: 'bg-[#E5E7EB]',
  disabled: 'bg-[#9CA3AF]',
};

function stateOf(table: TableWithId): CardState {
  if (table.activeCall || table.status === 'attention') return 'call';
  if (table.parties.some((p) => p.status === 'billing')) return 'bill';
  if (table.status === 'occupied' || table.partyCount > 0) return 'occupied';
  if (table.status === 'dirty') return 'dirty';
  if (table.status === 'disabled') return 'disabled';
  return 'available';
}

function chipFor(state: CardState): { text: string; cls: string } {
  switch (state) {
    case 'call':
      return { text: 'Waiter call', cls: 'bg-[#FEE2E2] text-[#E5484D] ring-[#FCA5A5]' };
    case 'bill':
      return { text: 'Bill requested', cls: 'bg-[#FEF3C7] text-[#D97706] ring-[#FCD34D]' };
    case 'occupied':
      return { text: 'Occupied', cls: 'bg-[#DEE9FC] text-[#0F5257] ring-[#BFD3F2]' };
    case 'dirty':
      return { text: 'Needs reset', cls: 'bg-[#FEF3C7] text-[#D97706] ring-[#FCD34D]' };
    case 'disabled':
      return { text: 'Disabled', cls: 'bg-[#F3F4F6] text-[#6B7280] ring-[#E5E7EB]' };
    default:
      return { text: 'Available', cls: 'bg-[#D1FAE5] text-[#2E7D5B] ring-[#6EE7B7]' };
  }
}

interface TableCardProps {
  table: TableWithId;
  onSelect: (tableId: string) => void;
}

export function TableCard({ table, onSelect }: TableCardProps) {
  const now = useNow();
  const state = stateOf(table);
  const chip = chipFor(state);
  const guests = table.parties.reduce((n, p) => n + (p.guestCount || 0), 0);
  const oldestOpenedAt = table.parties.reduce<number | null>(
    (oldest, p) => (oldest === null || p.openedAt < oldest ? p.openedAt : oldest),
    null,
  );
  const occupied = table.partyCount > 0;

  return (
    <button
      type="button"
      onClick={() => onSelect(table.id)}
      className="relative flex min-h-[116px] w-full flex-col justify-between overflow-hidden rounded-xl bg-white p-3 text-start shadow-sm transition-shadow hover:shadow-md"
    >
      <span className={`absolute inset-x-0 top-0 h-1.5 ${BAND[state]}`} />

      <div>
        <div className="flex items-start justify-between gap-2">
          <div className="min-w-0">
            <span className="block text-2xl font-bold leading-none tracking-tight text-[#1F2937]">
              {table.code}
            </span>
            <span className="mt-1 block truncate text-xs text-[#6B7280]">
              {occupied
                ? `${guests || table.partyCount} guest${(guests || table.partyCount) === 1 ? '' : 's'}`
                : `${table.seats} seats`}
              {table.zoneId ? ` · ${table.zoneId}` : ''}
            </span>
          </div>
          <span className={`shrink-0 rounded px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide ring-1 ${chip.cls}`}>
            {chip.text}
          </span>
        </div>

        {state === 'call' && table.activeCall ? (
          <div className="mt-2 flex items-center justify-between rounded-lg bg-[#FEE2E2] px-2 py-1.5">
            <span className="truncate text-xs font-semibold text-[#7A1E22]">{table.activeCall.type}</span>
            <span className="shrink-0 text-[10px] font-bold uppercase text-[#E5484D]">Urgent</span>
          </div>
        ) : null}
      </div>

      <div className="mt-3 flex items-end justify-between">
        <span className="text-xs tabular-nums text-[#6B7280]">
          {occupied ? (
            <span className="inline-flex items-center gap-1">
              <span aria-hidden="true">⏱</span>
              {oldestOpenedAt !== null ? formatElapsed(getElapsedSec(oldestOpenedAt, now)) : '—'}
              {table.partyCount > 1 ? <span className="font-semibold"> · {table.partyCount} parties</span> : null}
            </span>
          ) : (
            <span className="text-[#9CA3AF]">No open tab</span>
          )}
        </span>
        {occupied ? (
          <span className="text-base font-bold tabular-nums text-[#0F5257]">{formatAed(table.openTabFils)}</span>
        ) : null}
      </div>
    </button>
  );
}
