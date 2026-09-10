/**
 * src/server/services/resolve-platform-session.ts
 *
 * The `/admin` counterpart to `resolve-staff-session.ts`. `middleware.ts`
 * already redirects an unauthenticated `/admin/*` request to
 * `/admin/login`, but every founder page re-checks the cookie itself —
 * same defense-in-depth the staff and guest sides use.
 */

import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';
import {
  verifyPlatformSessionToken,
  PLATFORM_SESSION_COOKIE_NAME,
  type PlatformSessionPayload,
} from '@/server/auth/platform-session-cookie';

export async function requirePlatformSession(): Promise<PlatformSessionPayload> {
  const store = await cookies();
  const token = store.get(PLATFORM_SESSION_COOKIE_NAME)?.value;
  const session = token ? await verifyPlatformSessionToken(token) : null;
  if (!session) {
    redirect('/admin/login');
  }
  return session;
}
