'use client';

/**
 * src/components/cashier/table-overview-grid.tsx
 *
 * The Floor Grid: a dense, tablet-first grid of every table for the
 * branch (PRD.md §2.3), with the design's zone filter + free-text search
 * applied. Sorted so tables that need attention (calls, then bills) come
 * first, then occupied, then the rest by `sortIndex`.
 */

import { useMemo } from 'react';
import { TableCard, type TableWithId } from './table-card';

function rank(t: TableWithId): number {
  if (t.activeCall || t.status === 'attention') return 0;
  if (t.parties.some((p) => p.status === 'billing')) return 1;
  if (t.partyCount > 0 || t.status === 'occupied') return 2;
  if (t.status === 'dirty') return 3;
  return 4;
}

export function TableOverviewGrid({
  tables,
  onSelectTable,
  zoneFilter = 'all',
  query = '',
}: {
  tables: TableWithId[];
  onSelectTable: (tableId: string) => void;
  zoneFilter?: string;
  query?: string;
}) {
  const shown = useMemo(() => {
    const q = query.trim().toLowerCase();
    return tables
      .filter((t) => {
        if (zoneFilter !== 'all' && (t.zoneId || 'unzoned') !== zoneFilter) return false;
        if (q && !t.code.toLowerCase().includes(q) && !(t.label || '').toLowerCase().includes(q)) return false;
        return true;
      })
      .sort((a, b) => rank(a) - rank(b) || a.sortIndex - b.sortIndex);
  }, [tables, zoneFilter, query]);

  if (shown.length === 0) {
    return (
      <p className="rounded-xl border border-[#E5E7EB] bg-white px-4 py-10 text-center text-sm text-[#6B7280]">
        No tables match.
      </p>
    );
  }

  return (
    <ul className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5">
      {shown.map((table) => (
        <li key={table.id}>
          <TableCard table={table} onSelect={onSelectTable} />
        </li>
      ))}
    </ul>
  );
}
