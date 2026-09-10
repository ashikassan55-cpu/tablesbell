/**
 * src/server/auth/platform-session-cookie.ts
 *
 * The founder / super-admin counterpart to `staff-session-cookie.ts`.
 * Same shape, same reasoning: a `jose` HS256 JWT (Edge-verifiable, so
 * `middleware.ts` can gate `/admin/*` without pulling in `firebase-admin`),
 * set as an httpOnly cookie after the founder proves a verified Google
 * identity whose email is on the `ADMIN_EMAIL` allowlist
 * (`/api/admin/session`, which does the one Admin-SDK check —
 * `verifyIdToken` + email match — that can't run on Edge).
 *
 * SHORTER-LIVED than a staff shift: 4 hours. A founder console can revoke
 * a whole platform's access; a stale cookie on a walked-away-from laptop
 * is a bigger deal than a stale cashier session.
 */

import { SignJWT, jwtVerify, errors as joseErrors } from 'jose';

export const PLATFORM_SESSION_COOKIE_NAME = 'tb_platform';

export const PLATFORM_SESSION_COOKIE_OPTIONS = {
  httpOnly: true,
  secure: true,
  sameSite: 'lax' as const,
  path: '/',
  maxAge: 60 * 60 * 4, // 4 hours
};

export interface PlatformSessionPayload {
  uid: string;
  email: string;
}

function getSecretKey(): Uint8Array {
  const secret = process.env.PLATFORM_SESSION_SECRET;
  if (!secret) {
    throw new Error(
      'server/auth/platform-session-cookie.ts: PLATFORM_SESSION_SECRET is not set. ' +
        'Generate one (`openssl rand -base64 32`) and add it to .env.local / Vercel — see .env.local.example.',
    );
  }
  return new TextEncoder().encode(secret);
}

export async function signPlatformSessionToken(payload: PlatformSessionPayload): Promise<string> {
  return new SignJWT({ uid: payload.uid, email: payload.email })
    .setProtectedHeader({ alg: 'HS256' })
    .setIssuedAt()
    .setExpirationTime('4h')
    .sign(getSecretKey());
}

/** Returns `null` on any failure — expired, tampered, malformed, wrong
 *  secret — never throws (matches `verifyStaffSessionToken`). */
export async function verifyPlatformSessionToken(token: string): Promise<PlatformSessionPayload | null> {
  try {
    const { payload } = await jwtVerify(token, getSecretKey());
    if (
      typeof payload.uid !== 'string' ||
      payload.uid.length === 0 ||
      typeof payload.email !== 'string' ||
      payload.email.length === 0
    ) {
      return null;
    }
    return { uid: payload.uid, email: payload.email };
  } catch (error) {
    if (error instanceof joseErrors.JOSEError) return null;
    throw error;
  }
}
