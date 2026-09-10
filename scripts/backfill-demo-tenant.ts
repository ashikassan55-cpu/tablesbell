/**
 * scripts/backfill-demo-tenant.ts
 *
 * One-off: bring the existing seeded demo tenant (`tenants/tb_0492`) up to
 * the DECISIONS.md ADR-12 `Tenant` shape — it predates the `slug` /
 * `subscription` fields the founder console and multi-tenant staff login
 * now need. Without a `slug`, `/demo/lock` can no longer resolve to a
 * tenant (the PIN route switched from a hardcoded id to slug lookup).
 *
 * Firebase Web SDK + Firestore Test Mode, same as seed-demo.ts — no
 * Admin credentials needed. Idempotent (merge write).
 *
 *   npm run backfill:demo
 */

import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { initializeApp } from 'firebase/app';
import { initializeFirestore, doc, getDoc, setDoc } from 'firebase/firestore';

for (const line of readFileSync(resolve(process.cwd(), '.env.local'), 'utf8').split(/\r?\n/)) {
  const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
  if (m) process.env[m[1]] = m[2].replace(/^["']|["']$/g, '');
}

const app = initializeApp({
  apiKey: process.env.NEXT_PUBLIC_FIREBASE_API_KEY,
  authDomain: process.env.NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN,
  projectId: process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID,
  appId: process.env.NEXT_PUBLIC_FIREBASE_APP_ID,
});
const db = initializeFirestore(app, { experimentalForceLongPolling: true });

async function main(): Promise<void> {
  const ref = doc(db, 'tenants/tb_0492');
  const snap = await getDoc(ref);
  if (!snap.exists()) throw new Error('tenants/tb_0492 not found — run `npm run seed:demo` first.');
  const cur = snap.data() as Record<string, unknown>;

  const patch = {
    name: cur.name ?? 'TableBells Demo',
    displayName: cur.displayName ?? 'TableBells Demo Bistro',
    slug: 'demo',
    status: (cur.status as string) ?? 'active',
    legalEntity: cur.legalEntity ?? 'TableBells Demo LLC',
    trn: cur.trn ?? '100000000000003',
    city: cur.city ?? 'Dubai',
    ownerName: cur.ownerName ?? 'Sam Rivera',
    ownerEmail: cur.ownerEmail ?? 'owner@demo.tablebells.ae',
    primaryBranchId: cur.primaryBranchId ?? 'br_demo',
    subscription: cur.subscription ?? {
      plan: 'bistro',
      billingStatus: 'paid',
      monthlyFeeAed: 349,
      currentPeriodEnd: null,
      notes: 'Internal demo account',
    },
    createdAt: typeof cur.createdAt === 'number' ? cur.createdAt : Date.now(),
    createdByPlatformUid: cur.createdByPlatformUid ?? 'seed-demo',
    suspendedAt: cur.suspendedAt ?? null,
    suspendReason: cur.suspendReason ?? '',
  };

  await setDoc(ref, patch, { merge: true });
  console.log('Backfilled tenants/tb_0492 → slug "demo", plan "bistro". /demo/lock resolves again.');
}

main()
  .then(() => process.exit(0))
  .catch((e: unknown) => {
    console.error(`backfill-demo-tenant failed: ${e instanceof Error ? e.message : String(e)}`);
    process.exit(1);
  });
