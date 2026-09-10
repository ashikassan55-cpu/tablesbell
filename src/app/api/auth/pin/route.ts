/**
 * src/app/api/auth/pin/route.ts
 *
 * ARCHITECTURE.md §1.6, real: `POST /api/auth/pin` — staff code + PIN in,
 * a minted Firebase custom token + a short-lived staff session cookie
 * out. Composes `staff-login.service.ts` (lookup/lockout/argon2id
 * verify/claims mint) with the one thing that genuinely belongs at the
 * HTTP layer instead of in that service: turning its typed result into
 * a response and a `Set-Cookie` header.
 *
 * RUNTIME -- answering the question directly, since it shaped this
 * file's design: this is a Route Handler, and Next.js Route Handlers run
 * on the NODE runtime by DEFAULT (no `export const runtime = 'edge'`
 * anywhere below). Argon2id here never needs an Edge-compatible
 * equivalent, because it never runs on Edge at all -- that concern only
 * applies to `middleware.ts`, which verifies an ALREADY-MINTED cookie's
 * signature (pure `jose`, no hashing) on every SUBSEQUENT console
 * request. Hashing happens once, here, at login; verifying the resulting
 * cookie happens on Edge, cheaply, on every request after.
 *
 * TENANT RESOLUTION (DECISIONS.md ADR-12): the `/{tenantSlug}/lock`
 * screen POSTs its URL slug alongside the code + PIN;
 * `resolveTenantIdBySlug` turns it into a real `tenantId` via a
 * `tenants where slug == …` equality query (single-field auto-index).
 * `tenants/{t}.slug` is written by the founder onboarding flow
 * (`platform.actions.ts` `createTenant`). A missing / unknown slug, and
 * a slug pointing at a SUSPENDED or CHURNED tenant, both collapse into
 * the same generic `invalid_pin` — no oracle for "which restaurant
 * exists" or "which stopped paying".
 *
 * UNIFORM FAILURE: `not_found` / `invalid_pin` / `suspended` all collapse
 * into ONE generic response below -- see `staff-login.service.ts`'s own
 * header for why. `locked_out` is the deliberate exception, matching
 * `resolveGuestSession`'s `'table_full'` precedent: telling a locked-out
 * terminal how long to wait is operationally useful and reveals nothing
 * an attacker could use as an oracle.
 *
 * WHAT THIS DOES NOT RATE-LIMIT: ARCHITECTURE.md §1.6 specifies limiting
 * "per-device AND per-member." `staff-login.service.ts` implements the
 * per-member half (5 strikes → 15-minute lockout, keyed to the matched
 * staff code). The per-DEVICE half needs a registered terminal identity
 * this codebase does not have yet (no `devices/{deviceId}` registration
 * flow exists) -- an attacker who ROTATES staff codes rather than
 * repeatedly guessing PINs against ONE code is not rate-limited by
 * anything in this route today. Named plainly, not silently accepted.
 */

import { NextRequest, NextResponse } from 'next/server';
import { attemptStaffLogin } from '@/server/services/staff-login.service';
import { resolveTenantIdBySlug, getTenant, isTenantLoginBlocked } from '@/server/services/tenant.service';
import {
  signStaffSessionToken,
  STAFF_SESSION_COOKIE_NAME,
  STAFF_SESSION_COOKIE_OPTIONS,
} from '@/server/auth/staff-session-cookie';

const STAFF_CODE_PATTERN = /^[A-Za-z0-9]{1,10}$/;
const PIN_PATTERN = /^\d{4,8}$/;
const TENANT_SLUG_PATTERN = /^[a-z0-9-]{2,40}$/;

/** Legacy fallback: the seed/demo dataset predates per-tenant slugs.
 *  Only used when the request omits `tenantSlug` entirely. */
const FALLBACK_TENANT_ID = 'tb_0492';

export async function POST(request: NextRequest) {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ outcome: 'invalid_request' }, { status: 400 });
  }

  if (typeof body !== 'object' || body === null) {
    return NextResponse.json({ outcome: 'invalid_request' }, { status: 400 });
  }
  const { staffCode, pin, tenantSlug } = body as {
    staffCode?: unknown;
    pin?: unknown;
    tenantSlug?: unknown;
  };

  // Zero-trust on the request body -- this is a public HTTP endpoint,
  // not something only a well-behaved UI can reach.
  if (typeof staffCode !== 'string' || !STAFF_CODE_PATTERN.test(staffCode)) {
    return NextResponse.json({ outcome: 'invalid_request' }, { status: 400 });
  }
  if (typeof pin !== 'string' || !PIN_PATTERN.test(pin)) {
    return NextResponse.json({ outcome: 'invalid_request' }, { status: 400 });
  }

  // Resolve which restaurant this terminal belongs to. Absent slug ->
  // legacy demo tenant; present but unknown/invalid -> uniform failure.
  let tenantId: string;
  if (typeof tenantSlug === 'string' && tenantSlug.length > 0) {
    if (!TENANT_SLUG_PATTERN.test(tenantSlug)) {
      return NextResponse.json({ outcome: 'invalid_pin' }, { status: 401 });
    }
    const resolved = await resolveTenantIdBySlug(tenantSlug);
    if (!resolved) {
      return NextResponse.json({ outcome: 'invalid_pin' }, { status: 401 });
    }
    tenantId = resolved;
  } else {
    tenantId = FALLBACK_TENANT_ID;
  }

  // A suspended / churned restaurant accepts no logins -- same generic
  // response as a wrong PIN.
  const tenant = await getTenant(tenantId);
  if (tenant && isTenantLoginBlocked(tenant.status)) {
    return NextResponse.json({ outcome: 'invalid_pin' }, { status: 401 });
  }

  const result = await attemptStaffLogin({ tenantId, staffCode, pin });

  if (result.outcome === 'locked_out') {
    return NextResponse.json({ outcome: 'locked_out', retryAfterMs: result.retryAfterMs }, { status: 429 });
  }
  if (result.outcome !== 'success') {
    // 'not_found' | 'invalid_pin' | 'suspended' -- uniform failure, see
    // file header.
    return NextResponse.json({ outcome: 'invalid_pin' }, { status: 401 });
  }

  const staffSessionToken = await signStaffSessionToken({
    uid: result.member.uid,
    tid: tenantId,
    role: result.member.role,
    bids: result.member.branchIds,
    overrideAuth: result.member.overrideAuth,
    displayName: result.member.displayName,
  });

  const response = NextResponse.json({
    outcome: 'success',
    // Handed to the client so it can call `signInWithCustomToken` and
    // establish the Firestore-facing auth state -- see
    // `staff-session-cookie.ts`'s header for why this is a SEPARATE
    // mechanism from the cookie set below, not a duplicate of it.
    customToken: result.customToken,
    member: { displayName: result.member.displayName, role: result.member.role },
  });

  response.cookies.set(STAFF_SESSION_COOKIE_NAME, staffSessionToken, STAFF_SESSION_COOKIE_OPTIONS);

  return response;
}
