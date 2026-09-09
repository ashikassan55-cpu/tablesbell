'use server';

/**
 * src/server/actions/staff-session.actions.ts
 *
 * `lockTerminal` -- the real "Lock" button on the Cashier and Waiter
 * consoles. Replaces the mock `PinLockScreen` gate's `onLock` handler,
 * which just did `setStaff(null)` to re-show a client-side PIN pad.
 *
 * A Server Action (not a Server Component) specifically because it has to
 * DELETE the `tb_staff` cookie -- only Server Actions and Route Handlers
 * can mutate cookies via `next/headers`. Once the cookie is gone,
 * `middleware.ts` redirects any further console navigation to
 * `/{tenantSlug}/lock` on its own; the explicit `redirect()` here just
 * gets the current tab there immediately.
 *
 * WHAT THIS DOES NOT DO YET: it does not sign the Firebase client SDK
 * out (`signOut(auth)`), because the browser's client-SDK auth state
 * lives in IndexedDB and only client code can clear it. The Cashier and
 * Waiter surfaces hold NO real Firestore listeners today (all mock data),
 * so there is nothing that stale client auth state currently reaches --
 * but once those screens get live listeners, a `signOut(auth)` call
 * belongs in the button's client `onClick`, right before this action
 * runs. Named here rather than silently missing.
 */

import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';
import { STAFF_SESSION_COOKIE_NAME } from '@/server/auth/staff-session-cookie';

export async function lockTerminal(tenantSlug: string): Promise<void> {
  const jar = await cookies();
  jar.delete(STAFF_SESSION_COOKIE_NAME);
  redirect(`/${tenantSlug}/lock`);
}
