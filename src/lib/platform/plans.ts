/**
 * src/lib/platform/plans.ts
 *
 * The subscription plan catalogue — the three tiers from the marketing
 * landing page (`src/app/page.tsx`), as data the `/admin` founder console
 * uses for its plan dropdowns and default pricing. Client-importable
 * (`lib/`), no Firebase.
 *
 * `monthlyFeeAed` is only the DEFAULT list price. `createTenant` /
 * `setTenantPlan` copy it onto `tenants/{t}.subscription.monthlyFeeAed`,
 * which the founder can then override per restaurant (special deals,
 * annual discounts) without touching this file.
 */

import type { SubscriptionPlan } from '@/types/firestore';

export interface PlanMeta {
  id: SubscriptionPlan;
  name: string;
  blurb: string;
  monthlyFeeAed: number;
  /** Soft guidance shown in the console, not enforced anywhere yet. */
  tableGuidance: string;
}

export const PLANS: Record<SubscriptionPlan, PlanMeta> = {
  starter: {
    id: 'starter',
    name: 'Starter Café',
    blurb: 'Small coffee shops, tea bars and bakeries.',
    monthlyFeeAed: 199,
    tableGuidance: 'Up to 10 tables',
  },
  bistro: {
    id: 'bistro',
    name: 'Bistro & Eatery',
    blurb: 'Busy casual dining, burger joints, cafeterias.',
    monthlyFeeAed: 349,
    tableGuidance: 'Up to 25 tables',
  },
  busy: {
    id: 'busy',
    name: 'Busy Restaurant',
    blurb: 'High-volume dining, terraces, restobars.',
    monthlyFeeAed: 549,
    tableGuidance: 'Unlimited tables',
  },
};

export const PLAN_IDS = Object.keys(PLANS) as SubscriptionPlan[];

export function planMeta(plan: string | null | undefined): PlanMeta {
  return (plan && PLANS[plan as SubscriptionPlan]) || PLANS.starter;
}

export function isPlan(value: unknown): value is SubscriptionPlan {
  return typeof value === 'string' && value in PLANS;
}
