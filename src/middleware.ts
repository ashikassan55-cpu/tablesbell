import { NextResponse, type NextRequest } from 'next/server';
import { verifyDeviceToken, DEVICE_COOKIE_NAME, DEVICE_COOKIE_OPTIONS } from './server/auth/device-cookie';
import { mintDeviceToken } from './server/auth/mint';
import { verifyStaffSessionToken, STAFF_SESSION_COOKIE_NAME } from './server/auth/staff-session-cookie';
import {
  verifyPlatformSessionToken,
  PLATFORM_SESSION_COOKIE_NAME,
} from './server/auth/platform-session-cookie';

/**
 * src/middleware.ts
 *
 * Edge runtime -- no `export const config = { runtime: 'nodejs' }` here,
 * and no `experimental.nodeMiddleware` in next.config, so Edge is the
 * implicit default, not something explicitly declared. This is the
 * correct runtime for exactly what this file does and nothing more: it
 * never imports `firebase-admin`, never touches Firestore, and never
 * resolves a slug to a tenant. That fuller algorithm (ARCHITECTURE.md
 * §3.3 -- ban checks, session wake, party creation) is explicitly NOT
 * built here; it needs the Admin SDK and therefore Node, and remains a
 * separate, later piece.
 *
 * WHAT THIS FILE DOES, exactly:
 *   1. On guest routes (`/t/*`, `/j/*`): ensures a valid, signed `tb_did`
 *      cookie exists on every request, minting one if it's missing or
 *      fails verification.
 *   2. On console routes (`/:tenantSlug/(kds|cashier|floor|lock|manager)/*`):
 *      actively clears any `tb_did` cookie present (guest and console
 *      cookies must never cross, and everything still runs on one
 *      origin in this scaffold -- see the historical note this section
 *      used to carry, now folded into this one), AND -- new this pass --
 *      verifies the real staff session cookie (`tb_staff`,
 *      `server/auth/staff-session-cookie.ts`), redirecting to
 *      `/{tenantSlug}/lock` with a `next` param when it's missing or
 *      invalid. `/lock` itself is exempt from that redirect (an
 *      unconditional redirect there would loop forever) but still gets
 *      the same `tb_did` hygiene.
 *
 * STAFF AUTHORIZATION ITSELF, restated precisely now that it's real:
 * this file only checks that a valid, signed staff session cookie
 * exists -- it is the SAME "is there a plausible identity here at all"
 * gate `handleGuestRoute` already performs for guests, not a role check.
 * Legality for a SPECIFIC action (can THIS role advance THIS ticket) is
 * decided elsewhere, close to the write it gates -- `advanceTicket`
 * itself, which re-verifies this same cookie independently rather than
 * trusting that middleware already ran (RULES.md's zero-trust discipline
 * applied at a Server Action boundary, not just a page boundary).
 */

export const config = {
  matcher: [
    '/t/:path*',
    '/j/:path*',
    '/admin/:path*',
    '/:tenantSlug/(kds|cashier|floor|lock|manager)/:path*',
  ],
};

export async function middleware(request: NextRequest) {
  const { pathname } = request.nextUrl;

  if (pathname.startsWith('/t/') || pathname.startsWith('/j/')) {
    return handleGuestRoute(request);
  }

  if (pathname === '/admin' || pathname.startsWith('/admin/')) {
    return handleAdminRoute(request);
  }

  return handleConsoleRoute(request);
}

/**
 * `/admin/*` is the founder super-admin console. Gated on the
 * `tb_platform` cookie (`/api/admin/session` sets it after a Google
 * sign-in whose verified email matches `ADMIN_EMAIL`). `/admin/login` is
 * exempt from the redirect for the same anti-loop reason `/lock` is on
 * the console side. Guest device cookies are cleared here too — a founder
 * laptop must never carry a `tb_did`.
 */
async function handleAdminRoute(request: NextRequest): Promise<NextResponse> {
  const { pathname, search } = request.nextUrl;
  const isLogin = pathname === '/admin/login';

  function cleared(response: NextResponse): NextResponse {
    if (request.cookies.has(DEVICE_COOKIE_NAME)) response.cookies.delete(DEVICE_COOKIE_NAME);
    return response;
  }

  if (isLogin) return cleared(NextResponse.next());

  const token = request.cookies.get(PLATFORM_SESSION_COOKIE_NAME)?.value;
  const session = token ? await verifyPlatformSessionToken(token) : null;
  if (!session) {
    const loginUrl = new URL('/admin/login', request.url);
    loginUrl.searchParams.set('next', pathname + search);
    return cleared(NextResponse.redirect(loginUrl));
  }
  return cleared(NextResponse.next());
}

async function handleGuestRoute(request: NextRequest): Promise<NextResponse> {
  const response = NextResponse.next();

  const existingToken = request.cookies.get(DEVICE_COOKIE_NAME)?.value;
  const existingPayload = existingToken ? await verifyDeviceToken(existingToken) : null;

  if (existingPayload) {
    // Already valid -- deliberately NOT re-issued or expiry-extended on
    // every visit. A sliding-window renewal policy was a real option but
    // is a separate decision ARCHITECTURE.md §3.2 never specified; a
    // fixed 400-day window from first mint is the conservative default,
    // not a decision this file should make silently on its own.
    return response;
  }

  // Missing, expired, tampered, or the pre-this-pass unsigned UUID
  // format (which fails signature verification identically to any other
  // invalid token) -- all treated the same way: mint fresh.
  const { token } = await mintDeviceToken();
  response.cookies.set(DEVICE_COOKIE_NAME, token, DEVICE_COOKIE_OPTIONS);
  return response;
}

async function handleConsoleRoute(request: NextRequest): Promise<NextResponse> {
  const { pathname, search } = request.nextUrl;
  const segments = pathname.split('/').filter(Boolean); // ['tenantSlug', 'kds'|'cashier'|'floor'|'lock'|'manager', ...]
  const tenantSlug = segments[0] ?? '';
  const isLockRoute = segments[1] === 'lock';

  function withGuestCookieCleared(response: NextResponse): NextResponse {
    if (request.cookies.has(DEVICE_COOKIE_NAME)) {
      response.cookies.delete(DEVICE_COOKIE_NAME);
    }
    return response;
  }

  if (isLockRoute) {
    // Never gate the login route behind itself -- that's an infinite
    // redirect, not a security boundary.
    return withGuestCookieCleared(NextResponse.next());
  }

  const staffToken = request.cookies.get(STAFF_SESSION_COOKIE_NAME)?.value;
  const staffPayload = staffToken ? await verifyStaffSessionToken(staffToken) : null;

  if (!staffPayload) {
    const lockUrl = new URL(`/${tenantSlug}/lock`, request.url);
    lockUrl.searchParams.set('next', pathname + search);
    return withGuestCookieCleared(NextResponse.redirect(lockUrl));
  }

  return withGuestCookieCleared(NextResponse.next());
}
