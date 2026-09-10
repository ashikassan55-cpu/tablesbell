/**
 * src/app/api/admin/session/route.ts
 *
 * Exchanges a Firebase Auth ID token (from the founder's Google sign-in
 * on `/admin/login`) for the `tb_platform` session cookie that
 * `middleware.ts` gates `/admin/*` on.
 *
 * THE GATE IS AN EMAIL ALLOWLIST (DECISIONS.md ADR-12, revised): the
 * token must be a verified identity whose email equals `ADMIN_EMAIL`
 * (env var; an unset OR empty value falls back to the founder's
 * address). No password, no `plat` custom claim, no CLI grant script.
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

// `||` not `??` on purpose: an empty-string env var (a blank field in
// the Vercel dashboard) must fall back too, not become an allowlist of "".
const ADMIN_EMAIL = ((process.env.ADMIN_EMAIL ?? '').trim().toLowerCase() || 'ashikassan55@gmail.com');

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
    // No `checkRevoked` — this token was minted seconds ago by the popup,
    // and nothing in this codebase revokes founder tokens. Keeps the
    // verify to a single offline signature check, no extra network hop.
    decoded = await adminAuth.verifyIdToken(idToken);
  } catch (error) {
    console.warn('[admin/session] verifyIdToken failed:', error instanceof Error ? error.message : error);
    return NextResponse.json({ outcome: 'denied', message: 'Could not verify the sign-in.' }, { status: 401 });
  }

  const email = typeof decoded.email === 'string' ? decoded.email.trim().toLowerCase() : '';
  const emailVerified = decoded.email_verified === true;

  if (!email || !emailVerified || email !== ADMIN_EMAIL) {
    console.warn(
      `[admin/session] denied: signedInAs="${email || '(no email on token)'}" verified=${emailVerified} ` +
        `allowlist="${ADMIN_EMAIL}" provider="${decoded.firebase?.sign_in_provider ?? '?'}"`,
    );
    return NextResponse.json(
      {
        outcome: 'denied',
        message: 'This account is not on the founder allowlist.',
        // The caller just authenticated as this address — echoing it back
        // to them is not a disclosure, and it makes "Google picked the
        // wrong account" instantly obvious.
        signedInAs: email || null,
      },
      { status: 401 },
    );
  }

  let token: string;
  try {
    token = await signPlatformSessionToken({
      uid: decoded.uid,
      email: typeof decoded.email === 'string' ? decoded.email : decoded.uid,
    });
  } catch (error) {
    // Almost always: PLATFORM_SESSION_SECRET is not set in this
    // environment. Say so plainly instead of a bare 500.
    console.error('[admin/session] could not sign the platform cookie:', error);
    return NextResponse.json(
      {
        outcome: 'error',
        message:
          'The founder session secret is not configured on the server (PLATFORM_SESSION_SECRET). Add it and redeploy.',
      },
      { status: 500 },
    );
  }

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
