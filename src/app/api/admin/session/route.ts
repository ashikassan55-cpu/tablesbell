/**
 * src/app/api/admin/session/route.ts
 *
 * Exchanges a Firebase Auth ID token (from the founder's email/password
 * sign-in on `/admin/login`) for the `tb_platform` session cookie
 * `middleware.ts` gates `/admin/*` on. This is the one place the Admin
 * SDK check that can't run on Edge happens: `verifyIdToken` + assert the
 * `plat: true` custom claim (granted once by
 * `scripts/grant-platform-admin.ts`). A valid Firebase user WITHOUT that
 * claim is rejected exactly like a bad password — this endpoint is the
 * whole gate between "has a Google/Firebase account" and "is the founder".
 *
 * Node runtime (Route Handlers default to Node) — `firebase-admin` is
 * fine here.
 */

import { NextResponse, type NextRequest } from 'next/server';
import { adminAuth } from '@/lib/firebase/admin';
import {
  signPlatformSessionToken,
  PLATFORM_SESSION_COOKIE_NAME,
  PLATFORM_SESSION_COOKIE_OPTIONS,
} from '@/server/auth/platform-session-cookie';

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

  if (decoded.plat !== true || decoded.firebase?.sign_in_provider === 'anonymous') {
    // Uniform failure — don't tell a probing account that it exists but
    // lacks the claim vs. that the password was wrong.
    return NextResponse.json({ outcome: 'denied' }, { status: 401 });
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
