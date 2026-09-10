'use server';

/**
 * src/server/actions/platform.actions.ts
 *
 * The founder (`/admin`) write surface: onboard a restaurant, change its
 * plan, suspend / reactivate it. Every action re-verifies the
 * `tb_platform` cookie itself (zero-trust — never trusts that middleware
 * ran) and writes only through the Admin SDK, so `firestore.rules`'
 * `allow write: if false` on `tenants/*` is never in the way.
 *
 * BILLING IS MANUAL (DECISIONS.md ADR-12). Nothing here talks to a
 * payment gateway. `setTenantPlan` records what the founder decided to
 * charge; `setTenantStatus('suspended', …)` is the "they didn't pay"
 * lever — it flips `tenants/{t}.status`, which `checkGuestBoot` (guest
 * QR) and `attemptStaffLogin` (staff PIN) both refuse to serve.
 */

import { randomBytes } from 'node:crypto';
import { cookies } from 'next/headers';
import { FieldValue, type WithFieldValue } from 'firebase-admin/firestore';
import { adminDb } from '@/lib/firebase/admin';
import { hashStaffPin } from '@/server/auth/staff-pin';
import {
  verifyPlatformSessionToken,
  PLATFORM_SESSION_COOKIE_NAME,
} from '@/server/auth/platform-session-cookie';
import { slugExists } from '@/server/services/tenant.service';
import { planMeta, isPlan } from '@/lib/platform/plans';
import type {
  Tenant,
  TenantStatus,
  SubscriptionPlan,
  BillingStatus,
  StaffMember,
} from '@/types/firestore';

// --- auth ------------------------------------------------------------

interface PlatformActor {
  ok: true;
  uid: string;
  email: string;
}
type PlatformAuthResult = PlatformActor | { ok: false };

async function verifyPlatformActor(): Promise<PlatformAuthResult> {
  const store = await cookies();
  const token = store.get(PLATFORM_SESSION_COOKIE_NAME)?.value;
  const session = token ? await verifyPlatformSessionToken(token) : null;
  if (!session) return { ok: false };
  return { ok: true, uid: session.uid, email: session.email };
}

// --- helpers -------------------------------------------------------

function cleanText(value: unknown, max: number): string {
  if (typeof value !== 'string') return '';
  let out = '';
  for (const ch of value.trim()) {
    const code = ch.codePointAt(0) ?? 0;
    out += code < 0x20 || (code >= 0x7f && code <= 0x9f) ? ' ' : ch;
  }
  return out.slice(0, max);
}

const SLUG_RE = /^[a-z0-9](?:[a-z0-9-]{0,38}[a-z0-9])?$/;
const STAFF_CODE_RE = /^[A-Za-z0-9]{1,10}$/;
const PIN_RE = /^\d{4,8}$/;
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function shortId(prefix: string): string {
  return `${prefix}_${randomBytes(5).toString('hex')}`;
}

const VALID_STATUSES: readonly TenantStatus[] = ['trial', 'active', 'past_due', 'suspended', 'churned'];
const VALID_BILLING: readonly BillingStatus[] = ['trialing', 'paid', 'past_due', 'suspended'];

// --- createTenant --------------------------------------------------

export interface CreateTenantInput {
  name: string;
  slug: string;
  city: string;
  legalEntity: string;
  trn: string;
  ownerName: string;
  ownerEmail: string;
  ownerStaffCode: string;
  ownerPin: string;
  plan: SubscriptionPlan;
}

export type CreateTenantResult =
  | { outcome: 'created'; tenantId: string; slug: string; branchId: string; ownerStaffCode: string }
  | { outcome: 'error'; code: 'UNAUTHORIZED' | 'INVALID_SLUG' | 'SLUG_TAKEN' | 'INVALID_INPUT' | 'FAILED'; message: string };

export async function createTenant(input: CreateTenantInput): Promise<CreateTenantResult> {
  const auth = await verifyPlatformActor();
  if (!auth.ok) return { outcome: 'error', code: 'UNAUTHORIZED', message: 'Sign in to the founder console first.' };

  const name = cleanText(input.name, 120);
  const slug = cleanText(input.slug, 40).toLowerCase();
  const city = cleanText(input.city, 60);
  const legalEntity = cleanText(input.legalEntity, 160);
  const trn = cleanText(input.trn, 40);
  const ownerName = cleanText(input.ownerName, 120);
  const ownerEmail = cleanText(input.ownerEmail, 160).toLowerCase();
  const ownerStaffCode = cleanText(input.ownerStaffCode, 10) || '01';
  const ownerPin = typeof input.ownerPin === 'string' ? input.ownerPin.trim() : '';
  const plan = isPlan(input.plan) ? input.plan : 'starter';

  if (name.length < 2) return { outcome: 'error', code: 'INVALID_INPUT', message: 'Restaurant name is required.' };
  if (!SLUG_RE.test(slug)) {
    return {
      outcome: 'error',
      code: 'INVALID_SLUG',
      message: 'Slug must be 2–40 chars: lowercase letters, digits and hyphens.',
    };
  }
  if (!STAFF_CODE_RE.test(ownerStaffCode)) {
    return { outcome: 'error', code: 'INVALID_INPUT', message: 'Owner staff code must be 1–10 letters/digits.' };
  }
  if (!PIN_RE.test(ownerPin)) {
    return { outcome: 'error', code: 'INVALID_INPUT', message: 'Owner PIN must be 4–8 digits.' };
  }
  if (ownerName.length < 2 || !EMAIL_RE.test(ownerEmail)) {
    return { outcome: 'error', code: 'INVALID_INPUT', message: 'A valid owner name and email are required.' };
  }
  if (await slugExists(slug)) {
    return { outcome: 'error', code: 'SLUG_TAKEN', message: `The slug “${slug}” is already in use.` };
  }

  const tenantId = shortId('tb');
  const branchId = shortId('br');
  const ownerUid = `mbr_${tenantId}_${ownerStaffCode}`;
  const now = Date.now();
  const meta = planMeta(plan);
  const pinHash = await hashStaffPin(ownerPin);

  const tenantDoc: Tenant = {
    name,
    displayName: name,
    slug,
    status: 'trial',
    legalEntity,
    trn,
    city,
    ownerName,
    ownerEmail,
    primaryBranchId: branchId,
    subscription: {
      plan,
      billingStatus: 'trialing',
      monthlyFeeAed: meta.monthlyFeeAed,
      currentPeriodEnd: null,
      notes: '',
    },
    createdAt: now,
    createdByPlatformUid: auth.uid,
    suspendedAt: null,
    suspendReason: '',
  };

  const branchDoc = {
    name,
    displayName: name,
    status: 'active',
    menuVersion: 1,
    settings: { currency: 'AED', vatPpm: 50_000, receiptFooter: '' },
    session: { maxPartiesPerTable: 6 },
    sla: { ticketPrepSec: 900 },
    createdAt: now,
  };

  const ownerMember: WithFieldValue<StaffMember> = {
    uid: ownerUid,
    displayName: ownerName,
    staffCode: ownerStaffCode,
    role: 'owner',
    jobTitle: 'Owner',
    branchIds: [branchId],
    zoneIds: [],
    stationIds: [],
    pinHash,
    pinUpdatedAt: FieldValue.serverTimestamp(),
    pinFailedAttempts: 0,
    pinLockedUntil: null,
    overrideAuth: true,
    status: 'active',
    lastActiveAt: null,
    createdAt: FieldValue.serverTimestamp(),
    createdBy: `platform:${auth.uid}`,
  };

  try {
    const batch = adminDb.batch();
    batch.set(adminDb.doc(`tenants/${tenantId}`), tenantDoc);
    batch.set(adminDb.doc(`tenants/${tenantId}/branches/${branchId}`), branchDoc);
    batch.set(adminDb.doc(`tenants/${tenantId}/branches/${branchId}/menuPublished/v1`), {
      version: 1,
      publishedAt: now,
      publishedByUid: `platform:${auth.uid}`,
      categories: [],
    });
    batch.set(adminDb.doc(`tenants/${tenantId}/branches/${branchId}/menuDraft/current`), {
      updatedAt: now,
      updatedByUid: `platform:${auth.uid}`,
      lastPublishedVersion: 1,
      categories: [],
    });
    batch.set(adminDb.doc(`tenants/${tenantId}/branches/${branchId}/live/availability`), {
      updatedAt: now,
      unavailableItems: {},
      unavailableModifierOptions: {},
    });
    batch.set(adminDb.doc(`tenants/${tenantId}/members/${ownerUid}`), ownerMember);
    await batch.commit();
  } catch (error) {
    return {
      outcome: 'error',
      code: 'FAILED',
      message: error instanceof Error ? error.message : 'Could not create the tenant.',
    };
  }

  return { outcome: 'created', tenantId, slug, branchId, ownerStaffCode };
}

// --- setTenantPlan ----------------------------------------------

export interface SetTenantPlanInput {
  tenantId: string;
  plan: SubscriptionPlan;
  monthlyFeeAed: number;
  billingStatus: BillingStatus;
  currentPeriodEnd: number | null;
  notes: string;
}

export type SetTenantPlanResult =
  | { outcome: 'updated' }
  | { outcome: 'error'; code: 'UNAUTHORIZED' | 'NOT_FOUND' | 'INVALID_INPUT' | 'FAILED'; message: string };

export async function setTenantPlan(input: SetTenantPlanInput): Promise<SetTenantPlanResult> {
  const auth = await verifyPlatformActor();
  if (!auth.ok) return { outcome: 'error', code: 'UNAUTHORIZED', message: 'Sign in first.' };

  if (!isPlan(input.plan)) return { outcome: 'error', code: 'INVALID_INPUT', message: 'Unknown plan.' };
  if (!VALID_BILLING.includes(input.billingStatus)) {
    return { outcome: 'error', code: 'INVALID_INPUT', message: 'Unknown billing status.' };
  }
  const fee = Math.round(Number(input.monthlyFeeAed));
  if (!Number.isFinite(fee) || fee < 0 || fee > 100_000) {
    return { outcome: 'error', code: 'INVALID_INPUT', message: 'Monthly fee must be 0–100000 AED.' };
  }
  const period =
    input.currentPeriodEnd === null || input.currentPeriodEnd === undefined
      ? null
      : Number(input.currentPeriodEnd);
  if (period !== null && !Number.isFinite(period)) {
    return { outcome: 'error', code: 'INVALID_INPUT', message: 'Invalid renewal date.' };
  }

  const ref = adminDb.doc(`tenants/${input.tenantId}`);
  const snap = await ref.get();
  if (!snap.exists) return { outcome: 'error', code: 'NOT_FOUND', message: 'Tenant not found.' };

  try {
    await ref.set(
      {
        subscription: {
          plan: input.plan,
          billingStatus: input.billingStatus,
          monthlyFeeAed: fee,
          currentPeriodEnd: period,
          notes: cleanText(input.notes, 500),
        },
        subscriptionUpdatedAt: Date.now(),
        subscriptionUpdatedByUid: auth.uid,
      },
      { merge: true },
    );
  } catch (error) {
    return { outcome: 'error', code: 'FAILED', message: error instanceof Error ? error.message : 'Update failed.' };
  }
  return { outcome: 'updated' };
}

// --- setTenantStatus ------------------------------------------

export interface SetTenantStatusInput {
  tenantId: string;
  status: TenantStatus;
  reason: string;
}

export type SetTenantStatusResult =
  | { outcome: 'updated'; status: TenantStatus }
  | { outcome: 'error'; code: 'UNAUTHORIZED' | 'NOT_FOUND' | 'INVALID_INPUT' | 'FAILED'; message: string };

export async function setTenantStatus(input: SetTenantStatusInput): Promise<SetTenantStatusResult> {
  const auth = await verifyPlatformActor();
  if (!auth.ok) return { outcome: 'error', code: 'UNAUTHORIZED', message: 'Sign in first.' };
  if (!VALID_STATUSES.includes(input.status)) {
    return { outcome: 'error', code: 'INVALID_INPUT', message: 'Unknown status.' };
  }

  const ref = adminDb.doc(`tenants/${input.tenantId}`);
  const snap = await ref.get();
  if (!snap.exists) return { outcome: 'error', code: 'NOT_FOUND', message: 'Tenant not found.' };

  const blocking = input.status === 'suspended' || input.status === 'churned';
  try {
    await ref.set(
      {
        status: input.status,
        suspendedAt: blocking ? Date.now() : null,
        suspendReason: blocking ? cleanText(input.reason, 300) : '',
        statusUpdatedAt: Date.now(),
        statusUpdatedByUid: auth.uid,
      },
      { merge: true },
    );
  } catch (error) {
    return { outcome: 'error', code: 'FAILED', message: error instanceof Error ? error.message : 'Update failed.' };
  }
  return { outcome: 'updated', status: input.status };
}

// --- signOut --------------------------------------------------

export async function platformSignOut(): Promise<{ outcome: 'signed_out' }> {
  const store = await cookies();
  store.delete(PLATFORM_SESSION_COOKIE_NAME);
  return { outcome: 'signed_out' };
}
