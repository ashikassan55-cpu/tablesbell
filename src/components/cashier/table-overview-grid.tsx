'use client';

/**
 * src/components/cashier/table-overview-grid.tsx
 *
 * Requirement #1: dense, tablet-first grid of all active tables. Per
 * PRD.md §2.3, "live floor view showing every table, every party
 * occupying it... and each party's running total" is explicitly scoped
 * as part of the Cashier Dashboard's MVP feature set, not a separate,
 * undelivered Floor Grid screen — ARCHITECTURE.md §7.2 still names a
 * standalone `floor/page.tsx` for the fuller product, but that page is
 * not what this task builds or replaces.
 */

import { TableCard, type TableWithId } from './table-card';

export function TableOverviewGrid({
  tables,
  onSelectTable,
}: {
  tables: TableWithId[];
  onSelectTable: (tableId: string) => void;
}) {
  return (
    <ul className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5">
      {tables.map((table) => (
        <li key={table.id}>
          <TableCard table={table} onSelect={onSelectTable} />
        </li>
      ))}
    </ul>
  );
}
