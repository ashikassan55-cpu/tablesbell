'use client';

/**
 * src/hooks/use-live-order.ts
 *
 * A live listener on ONE order document — `tenants/{t}/branches/{b}/
 * orders/{orderId}` — for the KDS ticket-detail screen. The last mock
 * read in the app (`lib/kds/mock-orders.ts`) is replaced by this.
 *
 * WHY A LISTENER, NOT A ONE-SHOT `getDoc`: a chef sitting on a ticket
 * detail wants it to stay honest while another station works the same
 * order — a `ready` bump from the pass, a line voided from the Cashier
 * terminal — should reflect here without a manual refresh. Cost is
 * trivial: 1 read on attach + 1 per change to that single doc.
 *
 * Reuses `convertOrderSnapshot` from `use-live-orders.ts` verbatim.
 * `DocumentSnapshot.exists()` narrows `snap` to `QueryDocumentSnapshot`
 * (a real type guard in the modular SDK), so the same converter the KDS
 * queue uses accepts it directly with no cast.
 *
 * `'not_found'` is a first-class state, not an error: the order id in the
 * URL may be stale (deep link to a served/purged ticket) or the document
 * may be deleted while open. The detail view renders a plain "ticket not
 * found" panel for it, distinct from a real listener error.
 */

import { useEffect, useState } from 'react';
import { doc, onSnapshot, type FirestoreError } from 'firebase/firestore';
import { db } from '@/lib/firebase/client';
import { convertOrderSnapshot } from '@/hooks/use-live-orders';
import type { OrderWithId } from '@/components/ops/ticket-card';

export type LiveOrderState =
  | { status: 'loading'; order: null; error: null }
  | { status: 'ready'; order: OrderWithId; error: null }
  | { status: 'not_found'; order: null; error: null }
  | { status: 'error'; order: null; error: string };

export function useLiveOrder(tenantId: string, branchId: string, orderId: string): LiveOrderState {
  const [state, setState] = useState<LiveOrderState>({ status: 'loading', order: null, error: null });

  useEffect(() => {
    setState({ status: 'loading', order: null, error: null });

    const ref = doc(db, `tenants/${tenantId}/branches/${branchId}/orders/${orderId}`);
    const unsubscribe = onSnapshot(
      ref,
      (snap) => {
        if (!snap.exists()) {
          setState({ status: 'not_found', order: null, error: null });
          return;
        }
        setState({ status: 'ready', order: convertOrderSnapshot(snap), error: null });
      },
      (err: FirestoreError) => setState({ status: 'error', order: null, error: err.message }),
    );

    return () => unsubscribe();
  }, [tenantId, branchId, orderId]);

  return state;
}
