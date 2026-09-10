'use client';

/**
 * src/hooks/use-live-cashier-data.ts
 *
 * The Cashier Dashboard's live Firestore backbone — replaces the four
 * mock arrays (`MOCK_TABLES`, `MOCK_ALERTS`, `MOCK_ORDERS`, and the
 * locally-seeded `useState` copies) with real `onSnapshot` listeners on
 * the active branch. Same pattern `use-live-orders.ts` (KDS) and
 * `use-live-menu.ts` (guest) already established: a `'use client'` hook,
 * `db` from `lib/firebase/client.ts`, one `loading | ready | error` state
 * machine the consumer gates on once.
 *
 * FOUR LISTENERS, ONE HOOK — deliberately not four hooks. The Cashier
 * view needs all four correlated (a table's parties → their sessions →
 * their orders), and a single hook means one loading gate and one
 * cleanup. Each listener's query is still documented independently below;
 * if these ever need to split (e.g. a standalone alerts screen), the
 * queries lift out cleanly.
 *
 *   tables      — `collection(tables) orderBy sortIndex`. ARCHITECTURE.md
 *                 §1.6: "one 24-document listener" feeding the grid; the
 *                 denormalized `parties[]` is what the grid renders.
 *   sessions    — `where status in ['active','idle','billing'] limit 100`.
 *                 Single-field `in`, no composite index. Powers the
 *                 detail panel's per-party financial breakdown
 *                 (`runningTotals`, order/item counts) — richer than the
 *                 quick `openTabFils` denormalized onto the table.
 *   orders      — `where status in ['new','prep','ready','served']
 *                 orderBy placedAt limit 200`. Reuses the existing
 *                 `orders (status ASC, placedAt ASC)` composite index
 *                 (`firestore.indexes.json`). `'served'` is included on
 *                 top of the KDS queue's three so a cashier can still
 *                 void a line on food already delivered but not yet
 *                 billed; `'voided'` is excluded.
 *   staffAlerts — `where status == 'open'`. Single-field equality, no
 *                 index. Sorted newest-first CLIENT-side (≤5 rows in
 *                 practice) rather than adding a `(status, createdAt)`
 *                 composite index for an out-of-primary-scope surface.
 *
 * The snapshot→type converters (`convertTableSnapshot`,
 * `convertSessionSnapshot`, `convertAlertSnapshot`, `toMillisMaybe`,
 * `SessionWithId`) moved to `hooks/live-snapshots.ts` once the Waiter
 * Floor's `use-live-waiter-data.ts` needed the same `tables`/`sessions`
 * conversion. Orders reuse `convertOrderSnapshot` from `use-live-orders.ts`
 * verbatim. See `live-snapshots.ts`'s header for the timestamp-conversion
 * reasoning.
 */

import { useEffect, useState } from 'react';
import {
  collection,
  onSnapshot,
  orderBy,
  query,
  where,
  limit as fsLimit,
  type FirestoreError,
} from 'firebase/firestore';
import { db } from '@/lib/firebase/client';
import { convertOrderSnapshot } from '@/hooks/use-live-orders';
import {
  convertTableSnapshot,
  convertSessionSnapshot,
  convertAlertSnapshot,
  convertServiceCallSnapshot,
  type SessionWithId,
} from '@/hooks/live-snapshots';
import type { TableWithId } from '@/components/cashier/table-card';
import type { OrderWithId } from '@/components/ops/ticket-card';
import type { ServiceCall, StaffAlert } from '@/types/firestore';

export type { SessionWithId };

const OPEN_SESSION_STATUSES = ['active', 'idle', 'billing'] as const;
const CASHIER_ORDER_STATUSES = ['new', 'prep', 'ready', 'served'] as const;
const SESSION_LIMIT = 100;
const ORDER_LIMIT = 200;

export type LiveCashierState = {
  status: 'loading' | 'ready' | 'error';
  tables: TableWithId[];
  sessions: SessionWithId[];
  orders: OrderWithId[];
  alerts: StaffAlert[];
  serviceCalls: ServiceCall[];
  error: string | null;
};

export function useLiveCashierData(tenantId: string, branchId: string): LiveCashierState {
  const [tables, setTables] = useState<TableWithId[] | null>(null);
  const [sessions, setSessions] = useState<SessionWithId[] | null>(null);
  const [orders, setOrders] = useState<OrderWithId[] | null>(null);
  const [alerts, setAlerts] = useState<StaffAlert[] | null>(null);
  const [serviceCalls, setServiceCalls] = useState<ServiceCall[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setTables(null);
    setSessions(null);
    setOrders(null);
    setAlerts(null);
    setServiceCalls(null);
    setError(null);

    const base = `tenants/${tenantId}/branches/${branchId}`;
    const onError = (err: FirestoreError) => setError(err.message);

    const unsubTables = onSnapshot(
      query(collection(db, `${base}/tables`), orderBy('sortIndex')),
      (snap) => setTables(snap.docs.map(convertTableSnapshot)),
      onError,
    );

    const unsubSessions = onSnapshot(
      query(
        collection(db, `${base}/sessions`),
        where('status', 'in', [...OPEN_SESSION_STATUSES]),
        fsLimit(SESSION_LIMIT),
      ),
      (snap) => setSessions(snap.docs.map(convertSessionSnapshot)),
      onError,
    );

    const unsubOrders = onSnapshot(
      query(
        collection(db, `${base}/orders`),
        where('status', 'in', [...CASHIER_ORDER_STATUSES]),
        orderBy('placedAt'),
        fsLimit(ORDER_LIMIT),
      ),
      (snap) => setOrders(snap.docs.map(convertOrderSnapshot)),
      onError,
    );

    const unsubAlerts = onSnapshot(
      query(collection(db, `${base}/staffAlerts`), where('status', '==', 'open')),
      (snap) =>
        setAlerts(
          snap.docs
            .map(convertAlertSnapshot)
            .sort((a, b) => b.createdAt - a.createdAt),
        ),
      onError,
    );

    // serviceCalls — guest-raised assistance requests (Stitch guest
    // ordering). Same single-field `status == 'open'` shape as staffAlerts,
    // client-sorted newest-first.
    const unsubServiceCalls = onSnapshot(
      query(collection(db, `${base}/serviceCalls`), where('status', '==', 'open')),
      (snap) =>
        setServiceCalls(
          snap.docs
            .map(convertServiceCallSnapshot)
            .sort((a, b) => b.createdAt - a.createdAt),
        ),
      onError,
    );

    return () => {
      unsubTables();
      unsubSessions();
      unsubOrders();
      unsubAlerts();
      unsubServiceCalls();
    };
  }, [tenantId, branchId]);

  if (error) {
    return { status: 'error', tables: [], sessions: [], orders: [], alerts: [], serviceCalls: [], error };
  }
  if (
    tables === null ||
    sessions === null ||
    orders === null ||
    alerts === null ||
    serviceCalls === null
  ) {
    return {
      status: 'loading',
      tables: [],
      sessions: [],
      orders: [],
      alerts: [],
      serviceCalls: [],
      error: null,
    };
  }
  return { status: 'ready', tables, sessions, orders, alerts, serviceCalls, error: null };
}
