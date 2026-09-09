/**
 * src/server/auth/mint-guest-session.ts
 *
 * The Node-runtime home for the responsibility `server/auth/mint.ts`'s
 * header explicitly named as still needing a place to live: minting the
 * real Firebase Auth custom token carrying a guest's `gst`/`tid`/`bid`/
 * `ses`/`did` claims (ARCHITECTURE.md §1.4), via the Admin SDK. This is
 * exactly why `mint.ts` runs on Edge and this file does not -- this one
 * imports `lib/firebase/admin.ts`, which pulls in `firebase-admin` and
 * cannot be bundled for Edge at all.
 *
 * NOT A THROWING STUB. The function below is real, working code against
 * the real Admin SDK -- it will mint a genuine, valid custom token today
 * if called with real values.
 *
 * UPDATED: `session.service.ts`'s `resolveGuestSession` now exists, and
 * its 'created' outcome generates a `hostUid` of its own -- written
 * straight into the new `sessions/{sessionId}` document's `hostUid`
 * field before this file is ever called. That created a real
 * consistency requirement this file's original signature could not
 * satisfy: `mintGuestSessionToken` used to generate its OWN `uid`
 * internally, which meant the Firebase Auth identity it minted and the
 * `hostUid` already committed to Firestore were two different, unrelated
 * uids. `firestore.rules`' `inParty()` check compares
 * `request.auth.uid` against exactly `session.hostUid` -- with the two
 * uids diverging, every rule relying on `inParty()` would silently fail
 * for that guest, for the entire life of their session. `uid` is now an
 * optional input specifically to close that gap: a caller that already
 * has an authoritative uid (`session.service.ts`, on both the 'created'
 * and 'resumed' paths) supplies it directly, and this function mints
 * against exactly that identity instead of inventing a new one. The
 * self-generating fallback below still exists for a caller with no
 * uid of its own yet -- there was none in this codebase before this
 * change; there still isn't one today, but removing a working fallback
 * no current caller happens to need would be speculative narrowing, not
 * a real simplification.
 *
 * THE ONE NON-OBVIOUS CORRECTNESS DETAIL, worth understanding before
 * touching this file -- and the thing that made an earlier draft of it
 * broken: `createCustomToken(uid, claims)`'s second argument embeds
 * `claims` into the FIRST ID token minted from that custom token, but a
 * client SDK's SILENT background refresh (roughly hourly) does not go
 * through `createCustomToken` again and does not reliably carry those
 * inline claims forward on its own. What DOES survive every refresh, for
 * the life of the user record, is a claim set written via
 * `setCustomUserClaims(uid, claims)` directly onto that user -- BUT
 * `setCustomUserClaims` requires the user record to already exist, and
 * throws if it doesn't. A brand-new `uid` this function just generated
 * has no such record yet -- it's only created when a client actually
 * exchanges the custom token via `signInWithCustomToken`, which hasn't
 * happened at the point this server-side function runs. Calling
 * `setCustomUserClaims` before that would fail on every single
 * invocation, unconditionally -- not an edge case, the only case.
 *
 * The fix is to create the bare user record here, server-side, first:
 * `adminAuth.createUser({ uid })` with no email/phone/password produces
 * exactly the kind of anonymous-equivalent record a client-side
 * anonymous sign-in would also produce. Only once that exists can
 * `setCustomUserClaims` succeed -- so the order below is create, then
 * persist claims, then mint the token, all server-side, with no
 * additional round-trip back from the client required.
 *
 * WHAT THIS DOES NOT RESOLVE, flagged rather than guessed at: exactly
 * how a ~6-hour guest session lifetime (ARCHITECTURE.md §1.4's
 * `"exp": "<6h>"`) gets enforced is still an open question this file
 * does not answer. `setCustomUserClaims` claims don't expire on their
 * own, and a Firebase ID token's own lifetime is a fixed ~1 hour,
 * auto-refreshed -- neither of those, by itself, is "this session stops
 * being valid after 6 hours." The likely real mechanism is the SESSION
 * DOCUMENT's own `expiresAt` field being checked (by firestore.rules'
 * `partyOpen()`, or client-side logic) rather than anything living in the
 * JWT -- but that's a decision for whoever builds session expiry, not
 * something this file should quietly assume its way into.
 */

import { adminAuth } from '@/lib/firebase/admin';

export interface GuestSessionClaimInput {
  tenantId: string;
  branchId: string;
  sessionId: string;
  deviceId: string;
  /**
   * The uid this token must assert. Required in practice by every real
   * caller today (`session.service.ts` always has one -- either
   * `resolveGuestSession`'s freshly-generated `hostUid` on a 'created'
   * outcome, or the existing session's `hostUid` on a 'resumed' one).
   * Left optional, not required, because narrowing this to mandatory
   * would be asserting a constraint on every possible future caller that
   * only today's one caller actually has -- see the self-generating
   * fallback below for what happens when it's omitted.
   */
  uid?: string;
}

export interface MintedGuestSession {
  uid: string;
  customToken: string;
}

/**
 * Mints a Firebase Auth custom token for a guest party. When `input.uid`
 * is supplied, mints against exactly that identity -- the only correct
 * choice once a `sessions/{sessionId}` document already exists with a
 * `hostUid` committed to it, since that field and the uid this function
 * mints against MUST be the same value (see file header). When omitted,
 * falls back to generating a fresh anonymous identity itself, exactly as
 * this function's first version always did -- for a hypothetical caller
 * that doesn't yet have an authoritative uid to hand in. Every real
 * caller in this codebase today takes the first path.
 *
 * `createCustomToken` does not require this uid to already exist as a
 * Firebase Auth user -- the client's `signInWithCustomToken` call
 * auto-provisions the user record the first time it's exchanged (see
 * `adminAuth.createUser` below, which this function still does itself,
 * regardless of which branch generated the uid).
 *
 * A REAL RACE THE `uid` INPUT INTRODUCED, caught and fixed while wiring
 * this up rather than left for a confusing production error: with `uid`
 * always self-generated, `adminAuth.createUser({ uid })` could never
 * collide -- a freshly-minted `crypto.randomUUID()` is not, in practice,
 * already in use. That guarantee disappears the moment a caller can
 * supply its own uid. `resolveGuestSession`'s 'resumed' outcome hands
 * back the SAME `hostUid` an earlier 'created' call already used to
 * provision a real Firebase Auth user -- calling `createUser` again for
 * that uid throws `auth/uid-already-exists` unconditionally, on every
 * single session wake. `createUser` below is now wrapped to treat
 * exactly that one error code as success (the user already exists,
 * which is exactly what was wanted) and re-throw anything else --
 * `setCustomUserClaims` requires only that the user record exist, not
 * that this call was the one that created it.
 */
export async function mintGuestSessionToken(input: GuestSessionClaimInput): Promise<MintedGuestSession> {
  const uid = input.uid ?? `anon_${crypto.randomUUID()}`;

  const claims = {
    gst: true,
    tid: input.tenantId,
    bid: input.branchId,
    ses: input.sessionId,
    did: input.deviceId,
  };

  // Order matters here, and is not interchangeable -- see file header.
  // 1. The user record must exist before any claims can be persisted
  //    onto it. Idempotent by design (see the header note above) -- an
  //    already-existing uid is the expected, common case on a session
  //    wake, not an error.
  try {
    await adminAuth.createUser({ uid });
  } catch (error) {
    const code = (error as { code?: string } | undefined)?.code;
    if (code !== 'auth/uid-already-exists') {
      throw error;
    }
  }
  // 2. Persisted so the claims survive every subsequent silent token
  //    refresh, not just the first one.
  await adminAuth.setCustomUserClaims(uid, claims);
  // 3. The same claims are also passed inline here -- redundant with
  //    step 2 by design, ensuring the very first token is correct even
  //    in the unlikely case of read-after-write lag on the claims write.
  const customToken = await adminAuth.createCustomToken(uid, claims);

  return { uid, customToken };
}
