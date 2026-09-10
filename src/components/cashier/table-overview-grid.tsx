'use client';

/**
 * src/components/cashier/table-overview-grid.tsx
 *
 * The Floor Grid: every table for the branch as a card, with the
 * design's zone filter + free-text search applied and attention-first
 * ordering (calls, then bills, then occupied, then free).
 */

import { useMemo } from 'react';
import { TableCard, type TableWithId } from './table-card';
import type { OrderWithId } from '@/components/ops/ticket-card';

function rank(t: TableWithId): number {
  if (t.activeCall || t.status === 'attention') return 0;
  if (t.parties.some((p) => p.status === 'billing')) return 1;
  if (t.partyCount > 0 || t.status === 'occupied') return 2;
  if (t.status === 'dirty') return 3;
  return 4;
}

export function TableOverviewGrid({
  tables,
  orders = [],
  onSelectTable,
  onHandleCall,
  zoneFilter = 'all',
  query = '',
}: {
  tables: TableWithId[];
  orders?: OrderWithId[];
  onSelectTable: (tableId: string) => void;
  onHandleCall?: (tableId: string) => void;
  zoneFilter?: string;
  query?: string;
}) {
  const handleCall = onHandleCall ?? onSelectTable;
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
    <div className="grid grid-cols-1 gap-3 md:grid-cols-2 lg:grid-cols-4 xl:grid-cols-5">
      {shown.map((table) => (
        <TableCard
          key={table.id}
          table={table}
          orders={orders.filter((o) => o.tableId === table.id)}
          onSelect={onSelectTable}
          onHandleCall={handleCall}
        />
      ))}
    </div>
  );
}
