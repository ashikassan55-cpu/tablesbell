/**
 * src/server/services/resolve-staff-session.ts
 *
 * The console-page counterpart to `guest-boot.service.ts`'s cookie
 * verification: `middleware.ts` already redirects an unauthenticated
 * console request to `/{tenantSlug}/lock` before this ever runs, but
 * this Server Component-side check exists anyway, independently,
 * matching the exact same defense-in-depth reasoning `guest-boot.
 * service.ts`'s own header states for `tb_did` -- "middleware.ts
 * guarantees a valid... cookie... but this file still verifies it
 * itself rather than trusting the raw cookie value." A matcher typo, a
 * future route added outside the matcher's pattern, or a direct
 * server-side render path that skips middleware entirely (revalidation,
 * an internal fetch) are all real, if uncommon, ways this page could be
 * reached without middleware's gate having run.
 */

import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';
import {
  verifyStaffSessionToken,
  STAFF_SESSION_COOKIE_NAME,
  type StaffSessionPayload,
} from '@/server/auth/staff-session-cookie';

/**
 * Redirects to `/{tenantSlug}/lock` (never returns) if no valid staff
 * session cookie exists; otherwise resolves with the verified payload.
 */
export async function requireStaffSession(tenantSlug: string): Promise<StaffSessionPayload> {
  const cookieStore = await cookies();
  const token = cookieStore.get(STAFF_SESSION_COOKIE_NAME)?.value;
  const session = token ? await verifyStaffSessionToken(token) : null;

  if (!session) {
    redirect(`/${tenantSlug}/lock`);
  }

  return session;
}
