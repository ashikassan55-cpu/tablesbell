'use client';

/**
 * src/components/cashier/table-card.tsx
 *
 * Light utilitarian ops palette (RULES.md §3, the original Stitch
 * `utilitarian_pos_floor_console` review) — deliberately distinct from
 * KDS's dark palette: `#F3F4F6` canvas, white cards, deep teal `#0F5257`
 * primary, crimson `#E5484D` reserved exclusively for an active table
 * call/alert (never decorative). Requirement #1's "current total
 * spending and elapsed time" render with tabular numerals throughout
 * (RULES.md §3, ops rule 3).
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

const STATUS_STYLES: Record<Table['status'], { border: string; label: string }> = {
  available: { border: 'border-[#E5E7EB]', label: 'Available' },
  occupied: { border: 'border-[#0F5257]', label: 'Occupied' },
  attention: { border: 'border-[#E5484D]', label: 'Needs Attention' },
  dirty: { border: 'border-[#D97706]', label: 'Needs Reset' },
  disabled: { border: 'border-[#9CA3AF]', label: 'Disabled' },
};

interface TableCardProps {
  table: TableWithId;
  onSelect: (tableId: string) => void;
}

export function TableCard({ table, onSelect }: TableCardProps) {
  const now = useNow();
  const oldestOpenedAt = table.parties.reduce<number | null>(
    (oldest, party) => (oldest === null || party.openedAt < oldest ? party.openedAt : oldest),
    null,
  );
  const style = STATUS_STYLES[table.status];

  return (
    <button
      type="button"
      onClick={() => onSelect(table.id)}
      className={`flex min-h-[104px] flex-col items-start gap-1.5 rounded-lg border-2 bg-white p-3 text-start shadow-sm ${style.border}`}
    >
      <div className="flex w-full items-center justify-between">
        <span className="text-base font-bold text-[#1F2937]">{table.code}</span>
        {table.activeCall ? (
          <span className="flex items-center gap-1 rounded-sm bg-[#E5484D] px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-white">
            <span aria-hidden="true">🔔</span>
            {table.activeCall.type}
          </span>
        ) : (
          <span className="text-[10px] font-semibold uppercase tracking-wide text-[#6B7280]">{style.label}</span>
        )}
      </div>

      {table.partyCount > 0 ? (
        <>
          <p className="text-lg font-bold tabular-nums text-[#1F2937]">{formatAed(table.openTabFils)}</p>
          <p className="flex items-center gap-1 text-xs tabular-nums text-[#6B7280]">
            <span aria-hidden="true">⏱</span>
            {oldestOpenedAt !== null ? formatElapsed(getElapsedSec(oldestOpenedAt, now)) : '—'}
            {table.partyCount > 1 ? <span className="ms-1 font-semibold">· {table.partyCount} parties</span> : null}
          </p>
        </>
      ) : (
        <p className="text-xs text-[#9CA3AF]">No open tab</p>
      )}
    </button>
  );
}
