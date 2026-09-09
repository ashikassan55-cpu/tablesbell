'use client';

/**
 * src/hooks/use-live-orders.ts
 *
 * ARCHITECTURE.md §2.3's ticket-queue listener, exactly as specified:
 * `orders where status in ['new','prep','ready'] orderBy placedAt
 * limit 100` — "8–30" typical results, "Open tickets" as the documented
 * bound. Replaces `kds-queue-view.tsx`'s mock `useState` seeded from
 * `MOCK_ORDERS`, the same live-listener swap `useLiveMenu` already did
 * for the guest menu.
 *
 * TIMESTAMP CONVERSION, THE ONE REAL THING THIS HOOK DOES BEYOND
 * SUBSCRIBING: `Order`'s own header in `types/firestore.ts` documents
 * this precisely — the canonical, client-consumed type represents
 * `placedAt`/`prepStartedAt`/`readyAt`/`servedAt`/`updatedAt` as plain
 * epoch-ms numbers, but a real Firestore document holds native
 * `Timestamp` objects, and "translating between the two is the job of
 * the eventual `server/firebase/converters.ts` ... never a UI
 * component's." That shared converters module doesn't exist yet — this
 * hook does the conversion itself, locally, exactly the kind of stand-in
 * `useLiveMenu` already set precedent for (its own `.name.en` mapping).
 * When `converters.ts` is eventually built, `convertOrderSnapshot` below
 * is what should move into it, not be duplicated by it.
 *
 * WHAT THIS DOES NOT CONVERT, a known gap rather than an oversight:
 * `items[].void.at` and `adjustments[].at` are ALSO `Timestamp` on a real
 * document but `number` in the canonical type — left unconverted here
 * because nothing in this codebase writes real `void`/`adjustments` data
 * yet (`voidTicketLine` isn't built; MEMORY.md tracks it as still open).
 * Converting a field no real writer populates would be speculative, not
 * useful — whoever builds `voidTicketLine` next should extend this
 * function's conversion at the same time they give it a real caller.
 */

import { useEffect, useState } from 'react';
import {
  collection,
  onSnapshot,
  orderBy,
  query,
  where,
  limit as fsLimit,
  type DocumentData,
  type FirestoreError,
  type QueryDocumentSnapshot,
  type Timestamp,
} from 'firebase/firestore';
import { db } from '@/lib/firebase/client';
import type { OrderWithId } from '@/components/ops/ticket-card';

const QUEUE_STATUSES = ['new', 'prep', 'ready'] as const;
const QUEUE_LIMIT = 100; // ARCHITECTURE.md §2.3's own stated bound

export type LiveOrdersState =
  | { status: 'loading'; orders: OrderWithId[]; error: null }
  | { status: 'ready'; orders: OrderWithId[]; error: null }
  | { status: 'error'; orders: OrderWithId[]; error: string };

function toMillisOrNull(value: Timestamp | null | undefined): number | null {
  return value ? value.toMillis() : null;
}

/**
 * Exported so `use-live-cashier-data.ts` reuses the exact same
 * Order-document conversion rather than growing a second copy — when
 * `server/firebase/converters.ts` is eventually built, this is the one
 * function that moves into it.
 */
export function convertOrderSnapshot(doc: QueryDocumentSnapshot<DocumentData>): OrderWithId {
  const data = doc.data();
  // A broad cast, not a field-by-field rebuild -- everything BUT the
  // timestamp fields below is already shaped correctly by the server
  // writer (`priceOrderRequest`/`advanceTicket`, both trusted, never
  // guest input at this point), matching `useLiveMenu`'s own precedent
  // for this exact kind of pragmatic client-side cast.
  return {
    ...(data as unknown as OrderWithId),
    id: doc.id,
    placedAt: (data.placedAt as Timestamp).toMillis(),
    prepStartedAt: toMillisOrNull(data.prepStartedAt),
    readyAt: toMillisOrNull(data.readyAt),
    servedAt: toMillisOrNull(data.servedAt),
    updatedAt: toMillisOrNull(data.updatedAt),
  };
}

export function useLiveOrders(tenantId: string, branchId: string): LiveOrdersState {
  const [orders, setOrders] = useState<OrderWithId[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setOrders(null);
    setError(null);

    const q = query(
      collection(db, `tenants/${tenantId}/branches/${branchId}/orders`),
      where('status', 'in', [...QUEUE_STATUSES]),
      orderBy('placedAt'),
      fsLimit(QUEUE_LIMIT),
    );

    const unsubscribe = onSnapshot(
      q,
      (snap) => setOrders(snap.docs.map(convertOrderSnapshot)),
      (err: FirestoreError) => setError(err.message),
    );

    return () => unsubscribe();
  }, [tenantId, branchId]);

  if (error) return { status: 'error', orders: [], error };
  if (!orders) return { status: 'loading', orders: [], error: null };
  return { status: 'ready', orders, error: null };
}
