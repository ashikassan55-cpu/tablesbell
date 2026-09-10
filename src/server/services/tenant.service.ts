/**
 * src/server/services/tenant.service.ts
 *
 * Admin-SDK reads over `tenants/*` for the `/admin` founder console and
 * for multi-tenant staff login. `tenants/{t}` is `allow write: if false`
 * for every client and only platform/staff can READ a single doc — but
 * these functions all run server-side through the Admin SDK, which
 * bypasses `firestore.rules` entirely.
 *
 * `resolveTenantIdBySlug` is what finally closes the "TENANT RESOLUTION"
 * gap flagged in `app/api/auth/pin/route.ts`: a `where('slug','==',…)`
 * equality query (single-field, auto-indexed — no composite) turns the
 * `/{slug}/lock` URL segment into a real `tenantId`.
 */

import { adminDb } from '@/lib/firebase/admin';
import { planMeta } from '@/lib/platform/plans';
import type { Tenant, TenantSummary, TenantStatus } from '@/types/firestore';

const BLOCKED_LOGIN_STATUSES: readonly TenantStatus[] = ['suspended', 'churned'];

/** `true` when a tenant in this status must NOT accept staff logins or
 *  guest sessions (the founder pressed Suspend, or it churned). */
export function isTenantLoginBlocked(status: TenantStatus | undefined): boolean {
  return status !== undefined && BLOCKED_LOGIN_STATUSES.includes(status);
}

export async function resolveTenantIdBySlug(slug: string): Promise<string | null> {
  const clean = slug.trim().toLowerCase();
  if (!/^[a-z0-9-]{2,40}$/.test(clean)) return null;
  const snap = await adminDb.collection('tenants').where('slug', '==', clean).limit(1).get();
  return snap.empty ? null : snap.docs[0].id;
}

export async function getTenant(tenantId: string): Promise<(Tenant & { id: string }) | null> {
  const snap = await adminDb.doc(`tenants/${tenantId}`).get();
  if (!snap.exists) return null;
  return { id: snap.id, ...(snap.data() as Tenant) };
}

export async function slugExists(slug: string): Promise<boolean> {
  const snap = await adminDb.collection('tenants').where('slug', '==', slug).limit(1).get();
  return !snap.empty;
}

/** Every tenant, newest first, projected to the browser-safe summary the
 *  directory table renders. `branchCount` is one extra read per tenant —
 *  acceptable for a founder console with tens of tenants, not thousands. */
export async function listTenants(): Promise<TenantSummary[]> {
  const snap = await adminDb.collection('tenants').get();

  const rows = await Promise.all(
    snap.docs.map(async (doc) => {
      const t = doc.data() as Partial<Tenant>;
      let branchCount = 0;
      try {
        const branches = await adminDb.collection(`tenants/${doc.id}/branches`).get();
        branchCount = branches.size;
      } catch {
        branchCount = 0;
      }
      const sub = t.subscription;
      const meta = planMeta(sub?.plan);
      const summary: TenantSummary = {
        id: doc.id,
        name: t.name ?? t.displayName ?? doc.id,
        slug: t.slug ?? '',
        status: (t.status as TenantStatus) ?? 'trial',
        plan: meta.id,
        billingStatus: sub?.billingStatus ?? 'trialing',
        monthlyFeeAed: typeof sub?.monthlyFeeAed === 'number' ? sub.monthlyFeeAed : meta.monthlyFeeAed,
        ownerName: t.ownerName ?? '',
        ownerEmail: t.ownerEmail ?? '',
        city: t.city ?? '',
        branchCount,
        createdAt: typeof t.createdAt === 'number' ? t.createdAt : 0,
      };
      return summary;
    }),
  );

  return rows.sort((a, b) => b.createdAt - a.createdAt);
}
