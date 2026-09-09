'use server';

/**
 * src/server/actions/staff.actions.ts
 *
 * Manager Staff Management (ARCHITECTURE.md §1.6, DECISIONS.md ADR-10).
 * Two actions, both `tb_staff`-cookie-verified and `canManageStaff`-gated
 * (`manager` / `owner`), Admin SDK — `tenants/{t}/members/{uid}` is
 * `allow write: if false` for every client, so only this (and the local
 * `scripts/seed-staff-member.ts`) can create or change a staff account.
 *
 *   listStaff    -- the branch's roster as browser-safe summaries
 *                   (`array-contains` on `branchIds`). NEVER returns
 *                   `pinHash`.
 *   upsertStaff  -- create a member (derived uid `mbr_<tid>_<staffCode>`,
 *                   PIN argon2id-hashed here) or edit name / staffCode /
 *                   role / branches / override authority / status.
 *
 * REVOKING ACCESS. `status !== 'active'` blocks the NEXT `/lock` login
 * (`staff-login.service.ts` already checks it). For a member with a LIVE
 * session, `upsertStaff` additionally best-effort `revokeRefreshTokens` +
 * clears the Firebase custom claims, which breaks their console's live
 * Firestore listeners within ~1h (next ID-token refresh). The one
 * residual gap: the `tb_staff` COOKIE is a standalone 8-hour JWT with no
 * server-side denylist, so a revoked member's cookie still passes
 * Server-Action auth until it expires. Closing that fully needs a cookie
 * revocation list — a separate, larger piece (noted in ADR-10 / MEMORY).
 *
 * PRIVILEGE ESCALATION GUARDS: a `manager` may not create or edit an
 * `owner`, and may not grant `overrideAuth` (void / discount / refund /
 * ghost-ban authority). Only an `owner` can. A manager also cannot touch
 * a member whose branches don't overlap their own.
 *
 * ROLE IS SINGLE (ADR-10) — not a set. `manager` already subsumes
 * `cashier` / `server` front-of-house abilities; `kitchen` is the one
 * distinct capability. The UI is a single-select, deliberately.
 */

import { cookies } from 'next/headers';
import { FieldValue, type WithFieldValue } from 'firebase-admin/firestore';
import { adminDb, adminAuth } from '@/lib/firebase/admin';
import { verifyStaffSessionToken, STAFF_SESSION_COOKIE_NAME } from '@/server/auth/staff-session-cookie';
import { canManageStaff } from '@/lib/console/staff-permissions';
import { hashStaffPin } from '@/server/auth/staff-pin';
import type { StaffMember, StaffMemberSummary, StaffMemberStatus, StaffRole } from '@/types/firestore';

const STAFF_CODE_RE = /^[A-Za-z0-9]{1,10}$/;
const PIN_RE = /^\d{4,8}$/;
const UID_RE = /^[A-Za-z0-9][A-Za-z0-9_-]{1,80}$/;
const MIN_NAME = 2;
const MAX_NAME = 60;
const MAX_TITLE = 60;
const MAX_BRANCHES = 20;

const VALID_ROLES = new Set<StaffRole>(['owner', 'manager', 'cashier', 'server', 'kitchen']);
const VALID_STATUSES = new Set<StaffMemberStatus>(['active', 'inactive', 'suspended']);

const ROLE_TITLE: Record<StaffRole, string> = {
  owner: 'Owner',
  manager: 'Floor Manager',
  cashier: 'Cashier',
  server: 'Floor Server',
  kitchen: 'Kitchen',
};

function cleanText(value: unknown, max: number): string {
  if (typeof value !== 'string') return '';
  let out = '';
  for (const ch of value) {
    const code = ch.codePointAt(0) ?? 0;
    out += code < 0x20 || (code >= 0x7f && code <= 0x9f) ? ' ' : ch;
  }
  return out.replace(/\s+/g, ' ').trim().slice(0, max);
}

function toMillis(value: unknown): number | null {
  if (typeof value === 'number') return value;
  if (
    value !== null &&
    typeof value === 'object' &&
    'toMillis' in value &&
    typeof (value as { toMillis: unknown }).toMillis === 'function'
  ) {
    return (value as { toMillis: () => number }).toMillis();
  }
  return null;
}

interface StaffManagerAuth {
  ok: true;
  tenantId: string;
  uid: string;
  role: StaffRole;
  actorBids: string[];
  membersPath: string;
}

async function verifyStaffManager(
  branchId: string,
): Promise<StaffManagerAuth | { ok: false; reason: string }> {
  if (typeof branchId !== 'string' || branchId.length === 0 || branchId.length > 128) {
    return { ok: false, reason: 'INVALID_BRANCH' };
  }
  const cookieStore = await cookies();
  const token = cookieStore.get(STAFF_SESSION_COOKIE_NAME)?.value;
  const session = token ? await verifyStaffSessionToken(token) : null;
  if (!session) return { ok: false, reason: 'NOT_AUTHENTICATED' };
  if (!session.bids.includes(branchId)) return { ok: false, reason: 'BRANCH_NOT_AUTHORIZED' };
  if (!canManageStaff({ role: session.role, overrideAuth: session.overrideAuth })) {
    return { ok: false, reason: 'ROLE_NOT_PERMITTED' };
  }
  return {
    ok: true,
    tenantId: session.tid,
    uid: session.uid,
    role: session.role,
    actorBids: session.bids,
    membersPath: `tenants/${session.tid}/members`,
  };
}

// --- listStaff -----------------------------------------------------

export interface ListStaffInput {
  branchId: string;
}

export type ListStaffResult =
  | { outcome: 'ok'; members: StaffMemberSummary[] }
  | { outcome: 'rejected'; reason: string };

export async function listStaff(input: ListStaffInput): Promise<ListStaffResult> {
  const auth = await verifyStaffManager(input.branchId);
  if (!auth.ok) return { outcome: 'rejected', reason: auth.reason };

  const snap = await adminDb
    .collection(auth.membersPath)
    .where('branchIds', 'array-contains', input.branchId)
    .get();

  const members: StaffMemberSummary[] = snap.docs
    .map((d) => {
      const m = d.data() as Partial<StaffMember>;
      const role = VALID_ROLES.has(m.role as StaffRole) ? (m.role as StaffRole) : 'server';
      const status = VALID_STATUSES.has(m.status as StaffMemberStatus)
        ? (m.status as StaffMemberStatus)
        : 'active';
      return {
        uid: d.id,
        displayName: typeof m.displayName === 'string' && m.displayName ? m.displayName : '(unnamed)',
        staffCode: typeof m.staffCode === 'string' ? m.staffCode : '',
        role,
        jobTitle: typeof m.jobTitle === 'string' ? m.jobTitle : ROLE_TITLE[role],
        branchIds: Array.isArray(m.branchIds) ? m.branchIds.filter((b): b is string => typeof b === 'string') : [],
        overrideAuth: m.overrideAuth === true,
        status,
        lastActiveAt: toMillis(m.lastActiveAt),
        pinSetAt: toMillis(m.pinUpdatedAt),
        lockedUntil: toMillis(m.pinLockedUntil),
      } satisfies StaffMemberSummary;
    })
    .sort((a, b) => a.displayName.localeCompare(b.displayName));

  return { outcome: 'ok', members };
}

// --- upsertStaff --------------------------------------------------

export interface UpsertStaffInput {
  branchId: string;
  /** Omit to create; provide to edit. */
  uid?: string;
  displayName: string;
  staffCode: string;
  role: StaffRole;
  jobTitle?: string;
  branchIds: string[];
  overrideAuth: boolean;
  status: StaffMemberStatus;
  /** Required on create; blank / omitted on edit keeps the existing PIN. */
  pin?: string;
}

export type UpsertStaffResult =
  | { outcome: 'created'; uid: string }
  | { outcome: 'updated'; uid: string; reloginRequired: boolean }
  | { outcome: 'rejected'; reason: string };

export async function upsertStaff(input: UpsertStaffInput): Promise<UpsertStaffResult> {
  const auth = await verifyStaffManager(input.branchId);
  if (!auth.ok) return { outcome: 'rejected', reason: auth.reason };

  const displayName = cleanText(input.displayName, MAX_NAME);
  if (displayName.length < MIN_NAME) return { outcome: 'rejected', reason: 'DISPLAY_NAME_REQUIRED' };

  const staffCode = typeof input.staffCode === 'string' ? input.staffCode.trim() : '';
  if (!STAFF_CODE_RE.test(staffCode)) return { outcome: 'rejected', reason: 'INVALID_STAFF_CODE' };

  if (!VALID_ROLES.has(input.role)) return { outcome: 'rejected', reason: 'INVALID_ROLE' };
  if (!VALID_STATUSES.has(input.status)) return { outcome: 'rejected', reason: 'INVALID_STATUS' };

  const branchIds = Array.isArray(input.branchIds)
    ? Array.from(new Set(input.branchIds.filter((b) => typeof b === 'string' && b.length > 0)))
    : [];
  if (branchIds.length === 0 || branchIds.length > MAX_BRANCHES) {
    return { outcome: 'rejected', reason: 'BRANCHES_REQUIRED' };
  }
  // On CREATE every branch must be one the acting manager holds. On EDIT
  // the same is true only for branches being ADDED — a manager can keep
  // or drop a branch the member already had even if the manager isn't
  // scoped to it (needed so a branch-A manager can still revoke a member
  // who is also in branch B). Enforced in the EDIT transaction below.
  const isEdit = typeof input.uid === 'string' && input.uid.length > 0;
  if (!isEdit && !branchIds.every((b) => auth.actorBids.includes(b))) {
    return { outcome: 'rejected', reason: 'BRANCH_NOT_ASSIGNABLE' };
  }

  // Privilege-escalation guards — only an owner mints owners or grants
  // override authority.
  if (input.role === 'owner' && auth.role !== 'owner') {
    return { outcome: 'rejected', reason: 'OWNER_REQUIRES_OWNER' };
  }
  if (input.overrideAuth === true && auth.role !== 'owner') {
    return { outcome: 'rejected', reason: 'OVERRIDE_REQUIRES_OWNER' };
  }

  const wantsPin = typeof input.pin === 'string' && input.pin.length > 0;
  if (wantsPin && !PIN_RE.test(input.pin as string)) {
    return { outcome: 'rejected', reason: 'INVALID_PIN' };
  }
  const jobTitle = cleanText(input.jobTitle, MAX_TITLE) || ROLE_TITLE[input.role];
  const overrideAuth = input.overrideAuth === true;
  const role = input.role;
  const status = input.status;

  // argon2id is expensive and has no read-dependent branch — hash before
  // the transaction.
  const pinHash = wantsPin ? await hashStaffPin(input.pin as string) : null;

  // ---- CREATE ----
  if (!isEdit) {
    if (!pinHash) return { outcome: 'rejected', reason: 'PIN_REQUIRED' };
    const newUid = `mbr_${auth.tenantId}_${staffCode}`;
    const memberRef = adminDb.doc(`${auth.membersPath}/${newUid}`);
    const codeQuery = adminDb.collection(auth.membersPath).where('staffCode', '==', staffCode).limit(1);

    return adminDb.runTransaction(async (tx): Promise<UpsertStaffResult> => {
      const [existingSnap, codeSnap] = await Promise.all([tx.get(memberRef), tx.get(codeQuery)]);
      if (existingSnap.exists || !codeSnap.empty) {
        return { outcome: 'rejected', reason: 'STAFF_CODE_TAKEN' };
      }

      // `serverTimestamp()` is written into the `pinUpdatedAt` / `createdAt`
      // fields the canonical type declares as `number | null`; readers
      // normalise the `Timestamp` back to millis — the same convention the
      // seed script and `order.service.ts` already use.
      const doc: WithFieldValue<StaffMember> = {
        uid: newUid,
        displayName,
        staffCode,
        role,
        jobTitle,
        branchIds,
        zoneIds: [],
        stationIds: [],
        pinHash,
        pinUpdatedAt: FieldValue.serverTimestamp(),
        pinFailedAttempts: 0,
        pinLockedUntil: null,
        overrideAuth,
        status,
        lastActiveAt: null,
        createdAt: FieldValue.serverTimestamp(),
        createdBy: `manager:${auth.uid}`,
      };
      tx.set(memberRef, doc);
      return { outcome: 'created', uid: newUid };
    });
  }

  // ---- EDIT ----
  const uid = input.uid as string;
  if (!UID_RE.test(uid)) return { outcome: 'rejected', reason: 'INVALID_UID' };
  const memberRef = adminDb.doc(`${auth.membersPath}/${uid}`);
  const codeQuery = adminDb.collection(auth.membersPath).where('staffCode', '==', staffCode).limit(1);

  const txResult = await adminDb.runTransaction(async (tx): Promise<UpsertStaffResult> => {
    const [snap, codeSnap] = await Promise.all([tx.get(memberRef), tx.get(codeQuery)]);
    if (!snap.exists) return { outcome: 'rejected', reason: 'STAFF_NOT_FOUND' };
    const existing = snap.data() as Partial<StaffMember>;

    const existingBranches = Array.isArray(existing.branchIds) ? existing.branchIds : [];
    if (!existingBranches.some((b) => auth.actorBids.includes(b))) {
      return { outcome: 'rejected', reason: 'STAFF_NOT_IN_YOUR_BRANCH' };
    }
    if (existing.role === 'owner' && auth.role !== 'owner') {
      return { outcome: 'rejected', reason: 'CANNOT_EDIT_OWNER' };
    }
    // Only NEWLY-ADDED branches must be ones the acting manager holds.
    const addedBranches = branchIds.filter((b) => !existingBranches.includes(b));
    if (!addedBranches.every((b) => auth.actorBids.includes(b))) {
      return { outcome: 'rejected', reason: 'BRANCH_NOT_ASSIGNABLE' };
    }
    if (!codeSnap.empty && codeSnap.docs[0].id !== uid) {
      return { outcome: 'rejected', reason: 'STAFF_CODE_TAKEN' };
    }

    const patch: Record<string, unknown> = {
      displayName,
      staffCode,
      role,
      jobTitle,
      branchIds,
      overrideAuth,
      status,
    };
    if (pinHash) {
      patch.pinHash = pinHash;
      patch.pinUpdatedAt = FieldValue.serverTimestamp();
      patch.pinFailedAttempts = 0;
      patch.pinLockedUntil = null;
    }
    tx.update(memberRef, patch);

    const reloginRequired =
      existing.role !== role ||
      existing.overrideAuth !== overrideAuth ||
      existing.status !== status ||
      existingBranches.slice().sort().join(',') !== branchIds.slice().sort().join(',');

    return { outcome: 'updated', uid, reloginRequired };
  });

  // Best-effort auth-side acceleration of a role / branch / status change.
  // The Firestore write above is the source of truth for the next login;
  // these calls only shorten the window for an ALREADY-LIVE session.
  if (txResult.outcome === 'updated' && txResult.reloginRequired) {
    try {
      await adminAuth.revokeRefreshTokens(uid);
      if (status !== 'active') {
        await adminAuth.setCustomUserClaims(uid, { stf: false });
      }
    } catch (error) {
      const code = (error as { code?: string } | undefined)?.code;
      if (code !== 'auth/user-not-found') {
        console.warn(`[upsertStaff] auth revoke for ${uid} skipped: ${code ?? String(error)}`);
      }
    }
  }

  return txResult;
}
