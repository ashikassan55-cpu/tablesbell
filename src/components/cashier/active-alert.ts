/**
 * src/components/cashier/active-alert.ts
 *
 * One normalized shape for the things the Cashier "Alerts & Pagers"
 * screen treats as a live alert:
 *   - a guest waiter call        — `Table.activeCall` on the table doc
 *   - an open staff alert        — a `staffAlerts` doc (bill request,
 *                                  ghost-order flag, table move)
 *   - an open guest service call — a `serviceCalls` doc raised from the
 *                                  QR ordering surface (Call Waiter,
 *                                  Free Water, Wipes & Set, …)
 *
 * The dismiss set in `cashier-dashboard-view.tsx` is keyed by `key`:
 * a staff alert keeps its bare doc id (so the existing `resolveAlert` /
 * ban-review wiring is untouched); a waiter call uses `call:<tableId>`;
 * a service call uses `svc:<callId>`.
 */

import type { ServiceCall, StaffAlert } from '@/types/firestore';

export interface ActiveAlert {
  key: string;
  kind: 'call' | 'staff' | 'service';
  tableId: string | null;
  tableCode: string;
  title: string;
  badge: string;
  detail: string;
  /** lower = more urgent (used for focus ordering) */
  priority: number;
  createdAt: number;
  staffAlert: StaffAlert | null;
  serviceCall: ServiceCall | null;
}

const SERVICE_META: Record<
  ServiceCall['type'],
  { title: string; badge: string; priority: number; detail: string }
> = {
  waiter: { title: 'Guest Called a Waiter', badge: 'CALL WAITER', priority: 1, detail: 'GUEST REQUEST: A waiter is needed at the table' },
  water: { title: 'Water Requested', badge: 'FREE WATER', priority: 3, detail: 'GUEST REQUEST: Still / chilled water' },
  bill: { title: 'Bill Requested', badge: 'BILL REQUEST', priority: 3, detail: 'GUEST REQUEST: Print & settle the check' },
  cleanup: { title: 'Wipes & Set Requested', badge: 'WIPES & SET', priority: 3, detail: 'GUEST REQUEST: Cutlery / wipes / table reset' },
  napkins: { title: 'Extra Napkins Requested', badge: 'NAPKINS', priority: 3, detail: 'GUEST REQUEST: Extra napkins' },
  assistance: { title: 'Guest Needs Assistance', badge: 'ASSISTANCE', priority: 2, detail: 'GUEST REQUEST: General assistance / a question' },
};

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
    serviceCall: null,
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
    serviceCall: null,
  };
}

export function serviceCallToActiveAlert(call: ServiceCall, tableCode: string): ActiveAlert {
  const meta = SERVICE_META[call.type] ?? SERVICE_META.assistance;
  return {
    key: `svc:${call.id}`,
    kind: 'service',
    tableId: call.tableId,
    tableCode,
    title: meta.title,
    badge: meta.badge,
    detail: call.note?.trim() ? call.note : meta.detail,
    priority: meta.priority,
    createdAt: call.createdAt,
    staffAlert: null,
    serviceCall: call,
  };
}

export function sortActiveAlerts(list: ActiveAlert[]): ActiveAlert[] {
  return [...list].sort((a, b) => a.priority - b.priority || a.createdAt - b.createdAt);
}
