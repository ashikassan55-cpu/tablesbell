/**
 * src/app/api/admin/session/route.ts
 *
 * Exchanges a Firebase Auth ID token (from the founder's Google sign-in
 * on `/admin/login`) for the `tb_platform` session cookie that
 * `middleware.ts` gates `/admin/*` on.
 *
 * THE GATE IS AN EMAIL ALLOWLIST (DECISIONS.md ADR-12, revised): the
 * token must be a verified Google identity whose email equals
 * `ADMIN_EMAIL` (falling back to the founder's address if the env var is
 * unset). No password, no `plat` custom claim, no CLI grant script — a
 * valid Firebase user whose email isn't on the list is rejected exactly
 * like a bad token.
 *
 * Node runtime (Route Handlers default to Node) — `firebase-admin` fine.
 */

import { NextResponse, type NextRequest } from 'next/server';
import { adminAuth } from '@/lib/firebase/admin';
import {
  signPlatformSessionToken,
  PLATFORM_SESSION_COOKIE_NAME,
  PLATFORM_SESSION_COOKIE_OPTIONS,
} from '@/server/auth/platform-session-cookie';

const ADMIN_EMAIL = (process.env.ADMIN_EMAIL ?? 'ashikassan55@gmail.com').trim().toLowerCase();

export async function POST(request: NextRequest) {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ outcome: 'invalid_request' }, { status: 400 });
  }
  const idToken = (body as { idToken?: unknown } | null)?.idToken;
  if (typeof idToken !== 'string' || idToken.length === 0) {
    return NextResponse.json({ outcome: 'invalid_request' }, { status: 400 });
  }

  let decoded;
  try {
    decoded = await adminAuth.verifyIdToken(idToken, true);
  } catch {
    return NextResponse.json({ outcome: 'denied' }, { status: 401 });
  }

  const email = typeof decoded.email === 'string' ? decoded.email.trim().toLowerCase() : '';
  const emailVerified = decoded.email_verified === true;
  const provider = decoded.firebase?.sign_in_provider;

  // Verified Google identity, on the allowlist. Uniform 401 for every
  // other case — no oracle for "account exists but isn't the founder".
  if (provider !== 'google.com' || !emailVerified || !email || email !== ADMIN_EMAIL) {
    return NextResponse.json({ outcome: 'denied', message: 'Unauthorized.' }, { status: 401 });
  }

  const token = await signPlatformSessionToken({
    uid: decoded.uid,
    email: typeof decoded.email === 'string' ? decoded.email : decoded.uid,
  });

  const response = NextResponse.json({ outcome: 'ok' });
  response.cookies.set(PLATFORM_SESSION_COOKIE_NAME, token, PLATFORM_SESSION_COOKIE_OPTIONS);
  return response;
}

export async function DELETE() {
  const response = NextResponse.json({ outcome: 'signed_out' });
  response.cookies.set(PLATFORM_SESSION_COOKIE_NAME, '', {
    ...PLATFORM_SESSION_COOKIE_OPTIONS,
    maxAge: 0,
  });
  return response;
}
