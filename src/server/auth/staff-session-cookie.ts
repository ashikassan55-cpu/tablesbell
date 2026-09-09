/**
 * src/server/auth/staff-session-cookie.ts
 *
 * The staff-side counterpart to `device-cookie.ts`, same reason for
 * existing: `jose` (Web Crypto, Edge-compatible) so `middleware.ts` can
 * verify a console request's staff identity without pulling in
 * `firebase-admin` -- exactly the same Edge-compatibility argument
 * `device-cookie.ts`'s own header already makes, applied to the staff
 * side of the console instead of the guest side.
 *
 * WHY THIS EXISTS SEPARATELY FROM THE FIREBASE CUSTOM TOKEN
 * `mint-staff-session.ts` PRODUCES: the custom token is a ONE-TIME-USE
 * bootstrap the CLIENT exchanges via `signInWithCustomToken`, after
 * which the Firebase client SDK's own persisted auth state (IndexedDB,
 * survives page loads on its own) is what the BROWSER relies on for
 * Firestore access -- there is nothing for `middleware.ts` (which never
 * touches the client SDK at all) to check there. This cookie is the
 * SERVER-SIDE-READABLE artifact `middleware.ts` and `advanceTicket`
 * (the ONE Server Action wired to consume it this pass) actually verify.
 * Two different mechanisms answering two different questions -- "is this
 * browser's Firestore access authorized" (the custom token / client SDK)
 * vs. "does this specific server-side request come from a logged-in
 * staff member" (this cookie) -- deliberately not collapsed into one.
 *
 * "SHORT-LIVED," ARCHITECTURE.md §1.6's own phrase for this cookie,
 * taken as roughly one shift: 8 hours. Longer than a guest's device
 * cookie would ever need to be short for (guests get 400 days), much
 * shorter than it because a lost/stolen staff tablet is a materially
 * different risk than a lost/stolen guest phone.
 */

import { SignJWT, jwtVerify, errors as joseErrors } from 'jose';
import type { StaffRole } from '@/types/firestore';

export const STAFF_SESSION_COOKIE_NAME = 'tb_staff';

export const STAFF_SESSION_COOKIE_OPTIONS = {
  httpOnly: true,
  secure: true,
  sameSite: 'lax' as const,
  path: '/',
  maxAge: 60 * 60 * 8, // 8 hours
};

export interface StaffSessionPayload {
  uid: string;
  tid: string;
  role: StaffRole;
  bids: string[];
  overrideAuth: boolean;
  /**
   * The member's display name, carried in the cookie so every console
   * surface can render "who is logged in" (Cashier/Waiter headers, KDS
   * later) without a per-page-load `members/{uid}` read -- the cookie is
   * already known at mint time (`staff-login.service.ts` has it). It is a
   * low-sensitivity string in an httpOnly+secure signed cookie; a name
   * change won't reflect until the next login, which is fine for a
   * display label. NOT added to the Firebase custom claims
   * (`mint-staff-session.ts`) -- `firestore.rules` has no use for it.
   */
  displayName: string;
}

const VALID_ROLES: readonly StaffRole[] = ['cashier', 'server', 'kitchen', 'manager', 'owner'];

function getSecretKey(): Uint8Array {
  // A SEPARATE secret from DEVICE_COOKIE_SECRET, deliberately -- a staff
  // session cookie is a materially higher-value target than a bare
  // device identity, and rotating one must never force-invalidate the
  // other. See .env.local.example.
  const secret = process.env.STAFF_SESSION_SECRET;
  if (!secret) {
    throw new Error(
      'server/auth/staff-session-cookie.ts: STAFF_SESSION_SECRET is not set. ' +
        'Generate one (e.g. `openssl rand -base64 32`) and add it to .env.local -- see .env.local.example.',
    );
  }
  return new TextEncoder().encode(secret);
}

export async function signStaffSessionToken(payload: StaffSessionPayload): Promise<string> {
  return new SignJWT({
    uid: payload.uid,
    tid: payload.tid,
    role: payload.role,
    bids: payload.bids,
    overrideAuth: payload.overrideAuth,
    displayName: payload.displayName,
  })
    .setProtectedHeader({ alg: 'HS256' })
    .setIssuedAt()
    .setExpirationTime('8h')
    .sign(getSecretKey());
}

/**
 * Returns `null` on ANY failure -- expired, tampered, malformed, wrong
 * secret, or a structurally-invalid payload -- never throws, matching
 * `verifyDeviceToken`'s own contract exactly, for the same reason:
 * callers (`middleware.ts` primarily) should be able to treat "invalid"
 * and "absent" identically with one branch.
 */
export async function verifyStaffSessionToken(token: string): Promise<StaffSessionPayload | null> {
  try {
    const { payload } = await jwtVerify(token, getSecretKey());

    if (
      typeof payload.uid !== 'string' || payload.uid.length === 0 ||
      typeof payload.tid !== 'string' || payload.tid.length === 0 ||
      typeof payload.role !== 'string' || !VALID_ROLES.includes(payload.role as StaffRole) ||
      !Array.isArray(payload.bids) || !payload.bids.every((b) => typeof b === 'string') ||
      typeof payload.overrideAuth !== 'boolean' ||
      typeof payload.displayName !== 'string' || payload.displayName.length === 0
    ) {
      return null;
    }

    return {
      uid: payload.uid,
      tid: payload.tid,
      role: payload.role as StaffRole,
      bids: payload.bids as string[],
      overrideAuth: payload.overrideAuth,
      displayName: payload.displayName,
    };
  } catch (error) {
    if (error instanceof joseErrors.JOSEError) return null;
    throw error;
  }
}
