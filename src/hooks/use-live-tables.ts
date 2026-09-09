'use client';

/**
 * src/hooks/use-live-tables.ts
 *
 * A single-collection live listener on `branches/{b}/tables` for the
 * Manager Table Management view — the same `orderBy('sortIndex')` query
 * and shared `convertTableSnapshot` the Cashier / Waiter hooks use, minus
 * the sessions / orders / alerts listeners those carry. `firestore.rules`
 * already lets any `isStaff(t) && inBranch(b)` member read this
 * collection, so no extra gate here (the manager page enforces the ROLE).
 */

import { useEffect, useState } from 'react';
import { collection, onSnapshot, orderBy, query, type FirestoreError } from 'firebase/firestore';
import { db } from '@/lib/firebase/client';
import { convertTableSnapshot } from '@/hooks/live-snapshots';
import type { TableWithId } from '@/components/cashier/table-card';

export type LiveTablesState =
  | { status: 'loading'; tables: TableWithId[]; error: null }
  | { status: 'ready'; tables: TableWithId[]; error: null }
  | { status: 'error'; tables: TableWithId[]; error: string };

export function useLiveTables(tenantId: string, branchId: string): LiveTablesState {
  const [state, setState] = useState<LiveTablesState>({ status: 'loading', tables: [], error: null });

  useEffect(() => {
    setState({ status: 'loading', tables: [], error: null });

    const unsub = onSnapshot(
      query(collection(db, `tenants/${tenantId}/branches/${branchId}/tables`), orderBy('sortIndex')),
      (snap) => setState({ status: 'ready', tables: snap.docs.map(convertTableSnapshot), error: null }),
      (err: FirestoreError) => setState({ status: 'error', tables: [], error: err.message }),
    );

    return unsub;
  }, [tenantId, branchId]);

  return state;
}
