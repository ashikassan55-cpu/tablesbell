import { StaffLoginView } from '@/components/console/staff-login-view';

/**
 * src/app/(console)/[tenantSlug]/lock/page.tsx
 *
 * ARCHITECTURE.md §7.2's `lock/page.tsx` -- named in that directory
 * listing since the very first architecture pass, built for the first
 * time this pass. `middleware.ts` redirects here from any console route
 * (`/:tenantSlug/(kds|cashier|floor)/*`) that lacks a valid staff
 * session cookie, carrying the original destination as `?next=`.
 *
 * `tenantSlug` is passed through for DISPLAY only (unchanged from every
 * other console page's existing convention) -- `StaffLoginView` does not
 * use it to resolve a tenant; see `api/auth/pin/route.ts`'s own header
 * for the real, separately-flagged tenant-resolution gap this pass does
 * not close.
 */

interface RouteParams {
  params: Promise<{ tenantSlug: string }>;
  searchParams: Promise<{ next?: string }>;
}

export default async function StaffLockPage({ params, searchParams }: RouteParams) {
  const { tenantSlug } = await params;
  const { next } = await searchParams;

  // Open-redirect guard, not incidental -- `next` is attacker-
  // influenceable query-string input (anyone can craft a
  // `?next=https://evil.example` or a protocol-relative `?next=//evil.
  // example` link to this page), and a validated, real successful login
  // must never be the thing that sends a staff member's browser
  // off-origin afterward. `startsWith('/')` alone is NOT sufficient --
  // `//evil.example` also starts with `/` but browsers resolve it as
  // protocol-relative (effectively `https://evil.example`) -- the second
  // check is the one that actually matters here.
  //
  // `null` when there is no safe explicit destination: the login view
  // then routes by the authenticated member's ROLE (a cashier who opens
  // /lock directly should land on the Cashier dashboard, not the KDS).
  const nextPath = next && next.startsWith('/') && !next.startsWith('//') ? next : null;

  return <StaffLoginView tenantSlug={tenantSlug} nextPath={nextPath} />;
}
