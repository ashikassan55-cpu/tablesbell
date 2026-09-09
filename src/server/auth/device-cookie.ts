/**
 * src/server/auth/device-cookie.ts
 *
 * Signs and verifies the `tb_did` device-identity cookie -- the upgrade
 * from the bare, unsigned UUID every earlier pass (`layout.tsx`'s
 * temporary inline Server Action, MEMORY.md §4) explicitly flagged as
 * "must be replaced before real traffic." This is that replacement.
 *
 * EDGE-COMPATIBLE BY DESIGN, and that constrains the library choice, not
 * just a preference: `jose` implements JWT signing/verification on the
 * Web Crypto API, which both the Edge runtime and Node implement --
 * `jsonwebtoken` and most other popular JWT libraries assume Node's
 * `crypto` module, which does not exist on Edge. This file is imported
 * by `middleware.ts`, which runs on Edge specifically because it never
 * needs `firebase-admin` -- pulling in a Node-only crypto dependency
 * here would break that runtime choice for the whole file.
 *
 * PAYLOAD CHANGE FROM THE ORIGINAL DESIGN: ARCHITECTURE.md §3.2
 * specified `{ did, tid, iat }`. `tid` is dropped here, deliberately,
 * not as an Edge-compatibility shortcut but because it was the wrong
 * design: this cookie identifies a DEVICE, and a device is not
 * tenant-scoped -- the same phone visiting two different restaurants
 * should be recognized by each independently, which already happens
 * correctly at the Firestore lookup layer
 * (`tenants/{t}/guestDevices/{deviceId}`, keyed by tenant path, not by
 * anything baked into the cookie). Locking the cookie itself to one
 * tenant would have made "recognize this device" stop working the
 * moment a guest scanned a second restaurant's QR code -- exactly the
 * kind of silent regression a two-line payload change can cause if the
 * original reasoning isn't restated here.
 *
 * ROTATION, a known and stated limitation, not an oversight:
 * DECISIONS.md ADR-4 anticipates `DEVICE_COOKIE_SECRET` being rotated
 * quarterly. This file verifies against exactly one secret -- rotating
 * it invalidates every outstanding device cookie at once, forcing every
 * returning guest to be treated as new. A grace-period design (trying a
 * current AND a previous secret during verification) was left out here
 * because this task asked for sign/verify against "a secure secret,"
 * singular -- building silent, uninstructed complexity on top of that
 * would be its own kind of scope creep. Worth a follow-up before this
 * ever actually rotates in production.
 */

import { SignJWT, jwtVerify, errors as joseErrors } from 'jose';

export const DEVICE_COOKIE_NAME = 'tb_did';

/**
 * `Secure` cookies require HTTPS -- except modern browsers special-case
 * `http://localhost` as a "potentially trustworthy origin" (W3C Secure
 * Contexts), so this still works in plain `next dev`. It will NOT set
 * over a non-HTTPS tunnel/IP during testing; that's expected, not a bug
 * to work around by weakening this for every environment.
 */
export const DEVICE_COOKIE_OPTIONS = {
  httpOnly: true,
  secure: true,
  sameSite: 'lax' as const,
  path: '/',
  maxAge: 60 * 60 * 24 * 400, // 400 days -- ARCHITECTURE.md §3.2
};

export interface DeviceTokenPayload {
  did: string;
}

function getSecretKey(): Uint8Array {
  const secret = process.env.DEVICE_COOKIE_SECRET;
  if (!secret) {
    throw new Error(
      'server/auth/device-cookie.ts: DEVICE_COOKIE_SECRET is not set. ' +
        'Generate one (e.g. `openssl rand -base64 32`) and add it to .env.local -- see .env.local.example.',
    );
  }
  return new TextEncoder().encode(secret);
}

/** Signs a new device JWT. The cookie's own `maxAge` and this token's `exp` claim enforce expiry independently -- deliberate defense in depth, not redundancy to trim. */
export async function signDeviceToken(payload: DeviceTokenPayload): Promise<string> {
  return new SignJWT({ did: payload.did })
    .setProtectedHeader({ alg: 'HS256' })
    .setIssuedAt()
    .setExpirationTime('400d')
    .sign(getSecretKey());
}

/**
 * Verifies a device JWT. Returns `null` on ANY failure -- expired,
 * tampered, malformed, wrong secret -- rather than throwing, so callers
 * (middleware, primarily) can treat "invalid" and "absent" identically
 * with a single branch instead of scattering try/catch around every
 * call site.
 */
export async function verifyDeviceToken(token: string): Promise<DeviceTokenPayload | null> {
  try {
    const { payload } = await jwtVerify(token, getSecretKey());
    if (typeof payload.did !== 'string' || payload.did.length === 0) return null;
    return { did: payload.did };
  } catch (error) {
    // jose throws typed errors (JWTExpired, JWSSignatureVerificationFailed,
    // JWTInvalid, ...) for every failure mode this function is meant to
    // absorb. Re-throwing anything NOT from jose would hide a genuine bug
    // (e.g. a misconfigured secret) behind a silent "treat as logged out"
    // — so only jose's own error family is swallowed here.
    if (error instanceof joseErrors.JOSEError) return null;
    throw error;
  }
}
