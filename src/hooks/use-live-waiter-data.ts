'use client';

/**
 * src/hooks/use-live-waiter-data.ts
 *
 * The Waiter Floor's live Firestore backbone — replaces `MOCK_TABLES` and
 * `MOCK_ORDERS`. Same pattern as `use-live-cashier-data.ts`, but a
 * DELIBERATELY NARROWER read budget, because the Waiter surface renders
 * less than the Cashier one:
 *
 *   - `staffAlerts` listener ADDED BACK (2026-09-09, ADR-7). It was
 *     originally omitted — the waiter has no ghost-order inbox — but a
 *     `bill_request` alert has to reach the floor: a waiter standing at
 *     the table is who walks the bill over. Same query as the Cashier
 *     hook (`status == 'open'`, single-field equality, sorted client-
 *     side). The Waiter UI only surfaces `type === 'bill_request'` rows;
 *     ghost alerts stay a Cashier concern.
 *   - `orders` is `where status == 'ready'` only (single-field equality,
 *     no index), not the Cashier's four-status `in` query. The one
 *     order-derived thing the Waiter Floor shows is the "Ready for
 *     Pickup" panel; a waiter taking a new order never reads existing
 *     orders. Sorted oldest-first CLIENT-side (FIFO pickup) rather than
 *     adding a `(status, readyAt)` composite index.
 *   - `tables` and `sessions` are identical to the Cashier hook (same
 *     queries, same shared converters in `hooks/live-snapshots.ts`).
 *     `tables` carries the `status: 'attention'` flag and
 *     `parties[].riskFlagged` the grid needs; `sessions` backs the
 *     per-party running total shown in the take-order header.
 *
 * A separate hook rather than a parameterised shared one: two consumers
 * with genuinely different query sets is not enough to justify an
 * options-bag abstraction, and the shared part (the converters) is
 * already extracted.
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
  type SessionWithId,
} from '@/hooks/live-snapshots';
import type { TableWithId } from '@/components/cashier/table-card';
import type { OrderWithId } from '@/components/ops/ticket-card';
import type { StaffAlert } from '@/types/firestore';

export type { SessionWithId };

const OPEN_SESSION_STATUSES = ['active', 'idle', 'billing'] as const;
const SESSION_LIMIT = 100;
const READY_ORDER_LIMIT = 100;

export type LiveWaiterState = {
  status: 'loading' | 'ready' | 'error';
  tables: TableWithId[];
  sessions: SessionWithId[];
  readyOrders: OrderWithId[];
  alerts: StaffAlert[];
  error: string | null;
};

export function useLiveWaiterData(tenantId: string, branchId: string): LiveWaiterState {
  const [tables, setTables] = useState<TableWithId[] | null>(null);
  const [sessions, setSessions] = useState<SessionWithId[] | null>(null);
  const [readyOrders, setReadyOrders] = useState<OrderWithId[] | null>(null);
  const [alerts, setAlerts] = useState<StaffAlert[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setTables(null);
    setSessions(null);
    setReadyOrders(null);
    setAlerts(null);
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

    const unsubReadyOrders = onSnapshot(
      query(
        collection(db, `${base}/orders`),
        where('status', '==', 'ready'),
        fsLimit(READY_ORDER_LIMIT),
      ),
      (snap) =>
        setReadyOrders(
          snap.docs
            .map(convertOrderSnapshot)
            .sort((a, b) => (a.readyAt ?? a.placedAt) - (b.readyAt ?? b.placedAt)),
        ),
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

    return () => {
      unsubTables();
      unsubSessions();
      unsubReadyOrders();
      unsubAlerts();
    };
  }, [tenantId, branchId]);

  if (error) {
    return { status: 'error', tables: [], sessions: [], readyOrders: [], alerts: [], error };
  }
  if (tables === null || sessions === null || readyOrders === null || alerts === null) {
    return { status: 'loading', tables: [], sessions: [], readyOrders: [], alerts: [], error: null };
  }
  return { status: 'ready', tables, sessions, readyOrders, alerts, error: null };
}
