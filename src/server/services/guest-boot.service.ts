import { cookies } from 'next/headers';
import { resolveTableSlug } from '@/server/services/slug.service';
import { checkGuestBoot, resolveGuestSession } from '@/server/services/session.service';
import { resolveBranchGuestContextFor } from '@/server/services/menu-version';
import { mintGuestSessionToken } from '@/server/auth/mint-guest-session';
import { verifyDeviceToken, DEVICE_COOKIE_NAME } from '@/server/auth/device-cookie';
import type { GuestSessionContext } from '@/components/providers/guest-session-provider';

/**
 * src/server/services/guest-boot.service.ts
 *
 * EXTRACTED, not newly invented: `app/(guest)/t/[slug]/page.tsx` already
 * ran this exact sequence -- `resolveTableSlug` → verify `tb_did` →
 * `checkGuestBoot` → `resolveGuestSession` → read `branch.menuVersion` →
 * `mintGuestSessionToken` -- inline, in its own body. Wiring the cart/
 * checkout page (`cart/page.tsx`) needed the IDENTICAL sequence, which
 * would have meant two Server Components independently re-deriving the
 * same session-boot decision from the same inputs -- exactly the
 * duplicated-business-logic RULES.md §4.9 exists to prevent (the same
 * reasoning that already produced `lib/guest/resolve-table-placeholder.ts`
 * as a shared module rather than a per-page copy, back when this was
 * still a placeholder). This function is that logic, in one place now,
 * called by both pages.
 *
 * WHY THIS RETURNS A DISCRIMINATED UNION rather than throwing for the
 * non-'ready' cases: every one of `'unavailable'` / `'table_full'` /
 * `'move_pending'` is a real, expected outcome of a normal guest visit
 * (RULES.md §4.4) -- a rescanned QR at a suspended venue, a genuinely
 * full table, a guest who really did move seats. Only a violated
 * contract (`middleware.ts` should have guaranteed a valid `tb_did`
 * cookie; it didn't) is still thrown, matching every other page in this
 * codebase that draws that line.
 *
 * WHAT STAYS PAGE-SPECIFIC, deliberately not pulled in here: the actual
 * JSX for each outcome. This function returns data, never markup -- the
 * two pages share `components/guest/guest-boot-states.tsx` for the
 * `<GenericUnavailable>`/`<TableFull>`/`<MoveConfirm>` components instead,
 * so a rendering decision doesn't get baked into a server *service*.
 */

export type GuestPageBoot =
  | { kind: 'unavailable' }
  | { kind: 'table_full' }
  | { kind: 'move_pending'; fromTableCode: string; toTableCode: string }
  | { kind: 'ready'; customToken: string; context: GuestSessionContext };

export async function bootGuestPage(slug: string): Promise<GuestPageBoot> {
  const slugResolution = await resolveTableSlug(slug);
  if (slugResolution.status === 'not_found') {
    return { kind: 'unavailable' };
  }

  const location = {
    tenantId: slugResolution.tenantId,
    branchId: slugResolution.branchId,
    tableId: slugResolution.tableId,
  };

  const cookieStore = await cookies();
  const rawDeviceCookie = cookieStore.get(DEVICE_COOKIE_NAME)?.value;
  const devicePayload = rawDeviceCookie ? await verifyDeviceToken(rawDeviceCookie) : null;
  if (!devicePayload) {
    throw new Error(
      'guest-boot.service.ts: missing or invalid tb_did cookie. middleware.ts should guarantee a valid, ' +
        'signed cookie on every request matching /t/:path* before any guest page ever renders.',
    );
  }
  const deviceId = devicePayload.did;

  const boot = await checkGuestBoot(location, deviceId);
  if (boot.status !== 'ready') {
    // 'banned' | 'tenant_unavailable' | 'table_unavailable' -- uniform
    // failure, ARCHITECTURE.md §8.1.
    return { kind: 'unavailable' };
  }

  const resolution = await resolveGuestSession(location, deviceId);

  if (resolution.outcome === 'banned') {
    return { kind: 'unavailable' };
  }
  if (resolution.outcome === 'table_full') {
    return { kind: 'table_full' };
  }
  if (resolution.outcome === 'move_pending') {
    return {
      kind: 'move_pending',
      fromTableCode: resolution.fromTableCode,
      toTableCode: resolution.toTableCode,
    };
  }

  // resolution.outcome is 'resumed' | 'created' from here on.
  const branch = await resolveBranchGuestContextFor(location.tenantId, location.branchId);
  const { menuVersion, settings: branchSettings } = branch;

  const minted = await mintGuestSessionToken({
    tenantId: location.tenantId,
    branchId: location.branchId,
    sessionId: resolution.sessionId,
    deviceId,
    uid: resolution.hostUid,
  });

  return {
    kind: 'ready',
    customToken: minted.customToken,
    context: {
      tenantId: location.tenantId,
      branchId: location.branchId,
      tableId: location.tableId,
      tableCode: resolution.tableCode,
      zoneId: resolution.zoneId,
      sessionId: resolution.sessionId,
      hostUid: resolution.hostUid,
      partyLabel: resolution.partyLabel,
      menuVersion,
      currency: branchSettings.currency, // ADR-11
      vatPpm: branchSettings.vatPpm,
      restaurantName: branch.name || resolution.tableCode,
      restaurantAddress: branchSettings.address,
      wifiSsid: branchSettings.wifiSsid,
      wifiPassword: branchSettings.wifiPassword,
      heroImageUrl: branchSettings.heroImageUrl,
      kitchenStatus: branchSettings.kitchenStatus,
    },
  };
}
