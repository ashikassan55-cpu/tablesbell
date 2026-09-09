/**
 * src/server/auth/mint-staff-session.ts
 *
 * The staff-side counterpart to `mint-guest-session.ts` -- same job
 * (Firebase Auth custom token, real Admin SDK code), one structural
 * difference worth naming precisely: a guest's `uid` is freshly minted
 * PER PARTY (a new one every time a table is scanned and a session is
 * created); a staff member's `uid` is the DOCUMENT ID of their
 * `tenants/{t}/members/{uid}` record -- stable across every shift, every
 * login, forever. That single difference is why this file's `createUser`
 * call is idempotent-by-necessity from the very first version, not
 * something bolted on after a bug -- `mint-guest-session.ts` only needed
 * that fix once `resolveGuestSession`'s 'resumed' outcome started
 * reusing an existing uid too; every staff login hits the identical
 * "this uid already exists" case, unconditionally, every single time.
 *
 * CUSTOM CLAIMS SHAPE, matching `firestore.rules`' `isStaff()`/`inBranch()`
 * exactly: `{ stf: true, tid, role, bids, overrideAuth }`. `bids` (branch
 * ids) is an ARRAY -- a member can be scoped to more than one branch
 * (ARCHITECTURE.md §1.6's `branchIds: [...]`) -- matching rules'
 * `inBranch(b) { return b in request.auth.token.bids; }` precisely.
 */

import { adminAuth } from '@/lib/firebase/admin';
import type { StaffRole } from '@/types/firestore';

export interface StaffClaimInput {
  uid: string;
  tenantId: string;
  role: StaffRole;
  branchIds: string[];
  overrideAuth: boolean;
}

export interface MintedStaffSession {
  uid: string;
  customToken: string;
}

export async function mintStaffSessionToken(input: StaffClaimInput): Promise<MintedStaffSession> {
  const claims = {
    stf: true,
    tid: input.tenantId,
    role: input.role,
    bids: input.branchIds,
    overrideAuth: input.overrideAuth,
  };

  // Idempotent by necessity -- see file header. Every staff login after
  // the first hits `auth/uid-already-exists` here, unconditionally; that
  // is the expected, common case, not an error.
  try {
    await adminAuth.createUser({ uid: input.uid });
  } catch (error) {
    const code = (error as { code?: string } | undefined)?.code;
    if (code !== 'auth/uid-already-exists') {
      throw error;
    }
  }

  await adminAuth.setCustomUserClaims(input.uid, claims);
  const customToken = await adminAuth.createCustomToken(input.uid, claims);

  return { uid: input.uid, customToken };
}
