/**
 * src/server/services/manager-reports.service.ts
 *
 * The "Executive Reports & Daily Performance" numbers for the Manager
 * Console landing page (`/{tenantSlug}/manager`). Admin-SDK reads over
 * one branch's `orders` (+ a peek at `sessions` / `staffAlerts`),
 * aggregated in memory.
 *
 * SCALE NOTE, stated plainly: this pulls the branch's most recent
 * `ORDER_SCAN_LIMIT` order documents and buckets them in JS. That is
 * fine for a single café/restaurant's daily volume and for the demo;
 * a high-street chain doing thousands of tickets a day needs a real
 * rolled-up `analyticsDaily` document written by a scheduled job
 * (ARCHITECTURE.md names the collection; the job isn't built). Flagged,
 * not silently assumed away.
 *
 * TIMESTAMP TOLERANCE: `placedAt` / `readyAt` are `serverTimestamp()`
 * (Firestore `Timestamp`) on a real priced order but plain epoch-ms
 * numbers on demo-seeded ones — `toMs` accepts both, matching the same
 * fix already made in `use-live-orders.ts`'s converter.
 */

import { adminDb } from '@/lib/firebase/admin';
import { resolveBranchSettingsFor } from '@/server/services/menu-version';

const ORDER_SCAN_LIMIT = 1500;
const UAE_OFFSET_MS = 4 * 60 * 60 * 1000; // Asia/Dubai, no DST
const DAY_MS = 24 * 60 * 60 * 1000;

function toMs(value: unknown): number {
  if (typeof value === 'number') return value;
  if (value && typeof value === 'object' && typeof (value as { toMillis?: unknown }).toMillis === 'function') {
    return (value as { toMillis: () => number }).toMillis();
  }
  if (value instanceof Date) return value.getTime();
  return 0;
}

/** UTC ms of the most recent Asia/Dubai midnight. */
function uaeStartOfToday(nowMs: number): number {
  return Math.floor((nowMs + UAE_OFFSET_MS) / DAY_MS) * DAY_MS - UAE_OFFSET_MS;
}

const WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'] as const;

export interface ManagerOverview {
  currency: string;
  vatPpm: number;
  generatedAt: number;
  today: {
    orderCount: number;
    grossFils: number;
    netFils: number;
    vatFils: number;
    covers: number;
    aovFils: number;
    avgPrepSeconds: number | null;
  };
  /** Same shape for yesterday, so the KPI cards can show a delta. */
  yesterday: {
    orderCount: number;
    grossFils: number;
    aovFils: number;
    covers: number;
  };
  week: {
    label: string;
    date: string;
    count: number;
    revenueFils: number;
    isToday: boolean;
  }[];
  topItems: { name: string; qty: number; revenueFils: number }[];
  openTables: number;
  openAlerts: number;
  hasAnyOrders: boolean;
}

interface OrderDoc {
  status?: string;
  grossFils?: number;
  netFils?: number;
  vatFils?: number;
  covers?: number;
  placedAt?: unknown;
  readyAt?: unknown;
  items?: { menuItemId?: string; nameSnapshot?: { en?: string }; qty?: number; lineTotalFils?: number; status?: string }[];
}

export async function getManagerOverview(tenantId: string, branchId: string): Promise<ManagerOverview> {
  const base = `tenants/${tenantId}/branches/${branchId}`;
  const now = Date.now();
  const startToday = uaeStartOfToday(now);
  const weekStart = startToday - 6 * DAY_MS;

  const [ordersSnap, sessionsSnap, alertsSnap, settings] = await Promise.all([
    adminDb.collection(`${base}/orders`).limit(ORDER_SCAN_LIMIT).get(),
    adminDb
      .collection(`${base}/sessions`)
      .where('status', 'in', ['active', 'idle', 'billing'])
      .limit(200)
      .get()
      .catch(() => null),
    adminDb.collection(`${base}/staffAlerts`).where('status', '==', 'open').limit(200).get().catch(() => null),
    resolveBranchSettingsFor(tenantId, branchId),
  ]);

  const orders = ordersSnap.docs.map((d) => d.data() as OrderDoc);

  // ---- today ----
  const todayOrders = orders.filter(
    (o) => o.status !== 'voided' && toMs(o.placedAt) >= startToday,
  );
  let grossFils = 0;
  let netFils = 0;
  let vatFils = 0;
  let covers = 0;
  let prepTotal = 0;
  let prepN = 0;
  const itemMap = new Map<string, { name: string; qty: number; revenueFils: number }>();

  for (const o of todayOrders) {
    grossFils += o.grossFils ?? 0;
    netFils += o.netFils ?? 0;
    vatFils += o.vatFils ?? 0;
    covers += o.covers ?? 0;
    const placed = toMs(o.placedAt);
    const ready = toMs(o.readyAt);
    if (placed > 0 && ready > placed) {
      prepTotal += ready - placed;
      prepN += 1;
    }
    for (const line of o.items ?? []) {
      if (line.status === 'voided') continue;
      const key = line.menuItemId || line.nameSnapshot?.en || 'item';
      const cur = itemMap.get(key) ?? { name: line.nameSnapshot?.en || 'Item', qty: 0, revenueFils: 0 };
      cur.qty += line.qty ?? 0;
      cur.revenueFils += line.lineTotalFils ?? 0;
      itemMap.set(key, cur);
    }
  }

  const orderCount = todayOrders.length;
  const topItems = [...itemMap.values()].sort((a, b) => b.revenueFils - a.revenueFils).slice(0, 5);

  // ---- yesterday (for KPI deltas) ----
  const yStart = startToday - DAY_MS;
  const yOrders = orders.filter((o) => o.status !== 'voided' && toMs(o.placedAt) >= yStart && toMs(o.placedAt) < startToday);
  const yGross = yOrders.reduce((s, o) => s + (o.grossFils ?? 0), 0);
  const yCovers = yOrders.reduce((s, o) => s + (o.covers ?? 0), 0);

  // ---- last 7 days (count + revenue per day) ----
  const week = Array.from({ length: 7 }, (_, i) => {
    const dayStart = weekStart + i * DAY_MS;
    const d = new Date(dayStart + UAE_OFFSET_MS);
    return {
      label: WEEKDAYS[d.getUTCDay()],
      date: d.toISOString().slice(0, 10),
      count: 0,
      revenueFils: 0,
      isToday: dayStart === startToday,
    };
  });
  for (const o of orders) {
    if (o.status === 'voided') continue;
    const t = toMs(o.placedAt);
    if (t < weekStart || t >= startToday + DAY_MS) continue;
    const idx = Math.floor((t - weekStart) / DAY_MS);
    if (idx >= 0 && idx < 7) {
      week[idx].count += 1;
      week[idx].revenueFils += o.grossFils ?? 0;
    }
  }

  return {
    currency: settings.currency,
    vatPpm: settings.vatPpm,
    generatedAt: now,
    today: {
      orderCount,
      grossFils,
      netFils,
      vatFils,
      covers,
      aovFils: orderCount > 0 ? Math.round(grossFils / orderCount) : 0,
      avgPrepSeconds: prepN > 0 ? Math.round(prepTotal / prepN / 1000) : null,
    },
    yesterday: {
      orderCount: yOrders.length,
      grossFils: yGross,
      aovFils: yOrders.length > 0 ? Math.round(yGross / yOrders.length) : 0,
      covers: yCovers,
    },
    week,
    topItems,
    openTables: sessionsSnap?.size ?? 0,
    openAlerts: alertsSnap?.size ?? 0,
    hasAnyOrders: orders.length > 0,
  };
}

/**
 * Per-menu-item units sold + gross for TODAY (Dubai day), keyed by
 * `menuItemId`. Used by the Menu Management catalog table's "Today's
 * velocity" column. Same tolerant scan as `getManagerOverview`.
 */
export async function getMenuItemVelocityToday(
  tenantId: string,
  branchId: string,
): Promise<Record<string, { qty: number; revenueFils: number }>> {
  const now = Date.now();
  const startToday = uaeStartOfToday(now);
  const snap = await adminDb
    .collection(`tenants/${tenantId}/branches/${branchId}/orders`)
    .limit(ORDER_SCAN_LIMIT)
    .get();

  const out: Record<string, { qty: number; revenueFils: number }> = {};
  for (const doc of snap.docs) {
    const o = doc.data() as OrderDoc;
    if (o.status === 'voided' || toMs(o.placedAt) < startToday) continue;
    for (const line of o.items ?? []) {
      if (line.status === 'voided' || !line.menuItemId) continue;
      const cur = out[line.menuItemId] ?? { qty: 0, revenueFils: 0 };
      cur.qty += line.qty ?? 0;
      cur.revenueFils += line.lineTotalFils ?? 0;
      out[line.menuItemId] = cur;
    }
  }
  return out;
}
