/**
 * src/server/services/staff-login.service.ts
 *
 * Orchestrates a real staff PIN login end to end: look up the member by
 * staff code, enforce the 5-strikes/15-minute lockout ARCHITECTURE.md
 * §1.6 specifies, verify the PIN via `staff-pin.ts`'s argon2id, and on
 * success mint a real Firebase Auth custom token
 * (`mint-staff-session.ts`). `app/api/auth/pin/route.ts` is the one
 * caller; this file holds none of the HTTP-specific concerns (cookies,
 * status codes) on purpose, matching the same service/route split
 * `priceOrderRequest`/its Cloud Functions trigger already use.
 *
 * WHY A STAFF CODE, NOT A BARE PIN, IS REQUIRED HERE -- a real, deliberate
 * departure from the deleted `pin-lock-screen.tsx` mock, which accepted
 * only a 4-digit PIN and did a direct dictionary lookup against
 * `MOCK_PIN_DIRECTORY`. That shortcut cannot survive real argon2id:
 * ARCHITECTURE.md §1.6 specifies a
 * PER-USER SALT, meaning the SAME PIN hashes to a DIFFERENT string for
 * every member -- there is no way to hash a candidate PIN once and find
 * a matching member by comparing hashes, only by hashing that candidate
 * against EVERY member's own hash and checking each one. Doing that on
 * every keystroke against an entire roster is both slow (argon2id is
 * deliberately expensive per call) and gets slower as the roster grows.
 * "Rate limiting is per-member," which the same section states as a
 * requirement, only makes sense if the member is already identified
 * before a PIN is checked -- strong evidence this was always the
 * intended real design, not a shortcut this file is introducing. A
 * staff code (already a field on `members/{uid}`, e.g. `"11"`) is the
 * natural identifier: cheap to look up (a single equality query, no
 * composite index needed), short enough to type on the same PIN pad.
 * The staff-code-then-PIN flow is now the ONLY staff login UI
 * (`components/console/staff-login-view.tsx`); the Cashier/Waiter
 * terminals consume the resulting `tb_staff` session directly and no
 * longer render a PIN pad of their own.
 *
 * UNIFORM FAILURE, applied to staff login the same way it already
 * applies to guest boot and order rejection: `'not_found'`,
 * `'invalid_pin'`, and `'suspended'` are three DIFFERENT internal
 * outcomes (useful for logging, and `'not_found'`/`'suspended'` cannot
 * have a failed-attempt counter incremented against them the way
 * `'invalid_pin'` can) but MUST render identically to whoever is
 * standing at the terminal -- revealing "that staff code doesn't exist"
 * vs. "that staff code exists but the PIN was wrong" vs. "that account
 * is suspended" would let an attacker enumerate valid, active staff
 * codes one PIN attempt at a time. `app/api/auth/pin/route.ts` collapses
 * all three into one generic message; `'locked_out'` is the deliberate
 * exception (see that route's own comment for why a lockout message is
 * safe to surface distinctly, mirroring `resolveGuestSession`'s
 * `'table_full'` precedent).
 */

import { Timestamp, FieldValue } from 'firebase-admin/firestore';
import { adminDb } from '@/lib/firebase/admin';
import { verifyStaffPin } from '@/server/auth/staff-pin';
import { mintStaffSessionToken } from '@/server/auth/mint-staff-session';
import type { StaffRole, StaffMemberStatus } from '@/types/firestore';

const MAX_FAILED_ATTEMPTS = 5;
const LOCKOUT_MS = 15 * 60 * 1000;

interface MemberDoc {
  displayName: string;
  staffCode: string;
  role: StaffRole;
  branchIds: string[];
  pinHash: string;
  pinFailedAttempts?: number;
  pinLockedUntil?: Timestamp | null;
  overrideAuth: boolean;
  // `!== 'active'` blocks login — `'inactive'` (on leave) and
  // `'suspended'` (access revoked) both do, set via `upsertStaff` (ADR-10).
  status: StaffMemberStatus;
}

interface StaffSummary {
  uid: string;
  displayName: string;
  role: StaffRole;
  branchIds: string[];
  overrideAuth: boolean;
}

export type StaffLoginResult =
  | { outcome: 'success'; customToken: string; member: StaffSummary }
  | { outcome: 'invalid_pin' }
  | { outcome: 'not_found' }
  | { outcome: 'suspended' }
  | { outcome: 'locked_out'; retryAfterMs: number };

type LoginCheckResult =
  | { outcome: 'verified'; ref: FirebaseFirestore.DocumentReference; summary: StaffSummary }
  | { outcome: 'invalid_pin' }
  | { outcome: 'not_found' }
  | { outcome: 'suspended' }
  | { outcome: 'locked_out'; retryAfterMs: number };

export async function attemptStaffLogin(input: {
  tenantId: string;
  staffCode: string;
  pin: string;
}): Promise<StaffLoginResult> {
  const { tenantId, staffCode, pin } = input;
  const membersQuery = adminDb
    .collection(`tenants/${tenantId}/members`)
    .where('staffCode', '==', staffCode)
    .limit(1);

  // Failed-attempt increment and lockout are read-check-write against a
  // counter -- exactly the kind of thing a transaction exists to make
  // race-safe, same discipline as `resolveGuestSession`'s party-count
  // check. The argon2id verification itself running inside the
  // transaction is a minor, accepted inefficiency (a retried transaction
  // would re-run it) -- member-document contention here is expected to
  // be rare (one staff member logging in at a time, in practice).
  const checkResult: LoginCheckResult = await adminDb.runTransaction(async (tx) => {
    const snap = await tx.get(membersQuery);
    if (snap.empty) {
      return { outcome: 'not_found' };
    }

    const doc = snap.docs[0];
    const member = doc.data() as MemberDoc;

    if (member.status !== 'active') {
      return { outcome: 'suspended' };
    }

    const now = Date.now();
    const lockedUntilMs = member.pinLockedUntil ? member.pinLockedUntil.toMillis() : null;
    if (lockedUntilMs !== null && lockedUntilMs > now) {
      return { outcome: 'locked_out', retryAfterMs: lockedUntilMs - now };
    }

    const valid = await verifyStaffPin(pin, member.pinHash);

    if (!valid) {
      const attempts = (member.pinFailedAttempts ?? 0) + 1;
      if (attempts >= MAX_FAILED_ATTEMPTS) {
        // Counter resets alongside the lockout being set, so the NEXT
        // 15-minute window starts counting from zero rather than
        // immediately re-triggering on the first attempt after it
        // expires -- a deliberate choice, not the only reasonable one.
        tx.update(doc.ref, { pinFailedAttempts: 0, pinLockedUntil: Timestamp.fromMillis(now + LOCKOUT_MS) });
      } else {
        tx.update(doc.ref, { pinFailedAttempts: attempts });
      }
      return { outcome: 'invalid_pin' };
    }

    tx.update(doc.ref, { pinFailedAttempts: 0, pinLockedUntil: null, lastActiveAt: FieldValue.serverTimestamp() });

    return {
      outcome: 'verified',
      ref: doc.ref,
      summary: {
        uid: doc.id, // the document ID IS the uid -- ARCHITECTURE.md §1.6's `members/{uid}` path
        displayName: member.displayName,
        role: member.role,
        branchIds: member.branchIds,
        overrideAuth: member.overrideAuth,
      },
    };
  });

  if (checkResult.outcome !== 'verified') {
    return checkResult;
  }

  const minted = await mintStaffSessionToken({
    uid: checkResult.summary.uid,
    tenantId,
    role: checkResult.summary.role,
    branchIds: checkResult.summary.branchIds,
    overrideAuth: checkResult.summary.overrideAuth,
  });

  return { outcome: 'success', customToken: minted.customToken, member: checkResult.summary };
}
