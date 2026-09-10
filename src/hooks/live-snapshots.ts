'use client';

/**
 * src/hooks/live-snapshots.ts
 *
 * Shared client-side Firestore-snapshot → canonical-type converters for
 * the staff-console live hooks. Extracted from `use-live-cashier-data.ts`
 * once the Waiter Floor needed the exact same `tables` / `sessions`
 * conversion (`use-live-waiter-data.ts`) — a second hand-copy of this is
 * the kind of drift RULES.md §4.9 exists to prevent, and it matters more
 * here because `firestore.rules` never touches these reads, so a
 * conversion bug fails silently as a mis-rendered tab total.
 *
 * `convertOrderSnapshot` deliberately still lives in `use-live-orders.ts`
 * (its original home, KDS) and is imported from there by both hooks —
 * moving it would churn the KDS surface for no benefit. When the eventual
 * server-side `server/firebase/converters.ts` lands, all of these are
 * what it absorbs.
 *
 * TIMESTAMP NOTE, unchanged from `use-live-orders.ts`'s own: the canonical
 * types in `types/firestore.ts` represent time as epoch-ms `number`. The
 * one real writer today (`session.service.ts`'s `resolveGuestSession`)
 * already writes plain numbers into `sessions` and `tables.parties[]`, so
 * `toMillisMaybe` is mostly a pass-through — it also handles a real
 * Firestore `Timestamp` for whenever a converter/trigger starts writing
 * them. Only fields a console UI actually renders are normalised; the
 * rest pass through untouched (same "don't convert what nothing reads"
 * line drawn for `void.at`).
 */

import type { DocumentData, QueryDocumentSnapshot } from 'firebase/firestore';
import type { TableWithId } from '@/components/cashier/table-card';
import type { GuestSession, ServiceCall, StaffAlert, Table } from '@/types/firestore';

export interface SessionWithId extends GuestSession {
  id: string;
}

export function toMillisMaybe(value: unknown): number | null {
  if (value === null || value === undefined) return null;
  if (typeof value === 'number') return value;
  if (
    typeof value === 'object' &&
    'toMillis' in value &&
    typeof (value as { toMillis: unknown }).toMillis === 'function'
  ) {
    return (value as { toMillis: () => number }).toMillis();
  }
  return null;
}

export function convertTableSnapshot(doc: QueryDocumentSnapshot<DocumentData>): TableWithId {
  const data = doc.data() as unknown as Table;
  return {
    ...data,
    id: doc.id,
    parties: (data.parties ?? []).map((party) => ({
      ...party,
      openedAt: toMillisMaybe(party.openedAt) ?? 0,
    })),
  };
}

export function convertSessionSnapshot(doc: QueryDocumentSnapshot<DocumentData>): SessionWithId {
  const data = doc.data() as unknown as GuestSession;
  return {
    ...data,
    id: doc.id,
    openedAt: toMillisMaybe(data.openedAt) ?? 0,
    lastActivityAt: toMillisMaybe(data.lastActivityAt) ?? 0,
  };
}

export function convertAlertSnapshot(doc: QueryDocumentSnapshot<DocumentData>): StaffAlert {
  const data = doc.data() as unknown as StaffAlert;
  return { ...data, id: doc.id, createdAt: toMillisMaybe(data.createdAt) ?? 0 };
}

export function convertServiceCallSnapshot(doc: QueryDocumentSnapshot<DocumentData>): ServiceCall {
  const data = doc.data() as unknown as ServiceCall;
  return { ...data, id: doc.id, createdAt: toMillisMaybe(data.createdAt) ?? 0 };
}
