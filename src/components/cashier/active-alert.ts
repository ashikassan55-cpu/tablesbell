/**
 * src/components/cashier/active-alert.ts
 *
 * One normalized shape for the two things the Cashier "Alerts & Pagers"
 * screen treats as a live alert:
 *   - a guest waiter call        — `Table.activeCall` on the table doc
 *   - an open staff alert        — a `staffAlerts` doc (bill request,
 *                                  ghost-order flag, table move)
 *
 * The dismiss set in `cashier-dashboard-view.tsx` is keyed by `key`:
 * a staff alert keeps its bare doc id (so the existing `resolveAlert` /
 * ban-review wiring is untouched); a waiter call uses `call:<tableId>`.
 */

import type { StaffAlert } from '@/types/firestore';

export interface ActiveAlert {
  key: string;
  kind: 'call' | 'staff';
  tableId: string | null;
  tableCode: string;
  title: string;
  badge: string;
  detail: string;
  /** lower = more urgent (used for focus ordering) */
  priority: number;
  createdAt: number;
  staffAlert: StaffAlert | null;
}

const STAFF_META: Record<StaffAlert['type'], { title: string; badge: string; priority: number; detail: string }> = {
  bill_request: { title: 'Bill Request', badge: 'BILL REQUEST', priority: 3, detail: 'GUEST REQUEST: Print & settle the check' },
  table_move: { title: 'Table Move Request', badge: 'TABLE MOVE', priority: 2, detail: 'GUEST REQUEST: Move party to another table' },
  ghost_suspected: { title: 'Suspected Ghost Order', badge: 'GHOST ORDER — REVIEW', priority: 2, detail: 'RISK: Order placed with no seated party detected' },
  ghost_flagged: { title: 'Flagged Ghost Order', badge: 'GHOST ORDER — FLAGGED', priority: 1, detail: 'RISK: Flagged for manager review' },
};

function prettify(type: string | undefined): string {
  if (!type) return 'Waiter call';
  return type.replace(/[_-]+/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());
}

export function callToActiveAlert(table: {
  id: string;
  code: string;
  activeCall: { type: string; priority: number; createdAt: number } | null;
}): ActiveAlert {
  return {
    key: `call:${table.id}`,
    kind: 'call',
    tableId: table.id,
    tableCode: table.code,
    title: 'Urgent Service Call',
    badge: 'URGENT SERVICE CALL',
    detail: `GUEST SERVICE REQUEST: ${prettify(table.activeCall?.type)}`,
    priority: table.activeCall?.priority ?? 0,
    createdAt: table.activeCall?.createdAt ?? 0,
    staffAlert: null,
  };
}

export function staffToActiveAlert(alert: StaffAlert): ActiveAlert {
  const meta = STAFF_META[alert.type];
  return {
    key: alert.id,
    kind: 'staff',
    tableId: null,
    tableCode: alert.tableCode,
    title: meta.title,
    badge: meta.badge,
    detail: alert.note?.trim() ? alert.note : meta.detail,
    priority: meta.priority,
    createdAt: alert.createdAt,
    staffAlert: alert,
  };
}

export function sortActiveAlerts(list: ActiveAlert[]): ActiveAlert[] {
  return [...list].sort((a, b) => a.priority - b.priority || a.createdAt - b.createdAt);
}
