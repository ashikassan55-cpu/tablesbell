import { bootGuestPage } from '@/server/services/guest-boot.service';
import { GenericUnavailable, TableFull, MoveConfirm } from '@/components/guest/guest-boot-states';
import { GuestSessionProvider } from '@/components/providers/guest-session-provider';
import { GuestMenuView } from '@/components/guest/guest-menu-view';

/**
 * src/app/(guest)/t/[slug]/page.tsx
 *
 * LIVE-WIRED. All of the actual boot-chain orchestration (slug
 * resolution, device-cookie verification, `checkGuestBoot`,
 * `resolveGuestSession`, `mintGuestSessionToken`) now lives in
 * `server/services/guest-boot.service.ts`'s `bootGuestPage` -- extracted
 * out of this file specifically because `cart/page.tsx` needed the exact
 * same sequence and duplicating it per-page would have been the kind of
 * drift-prone copy RULES.md §4.9 exists to prevent. This file's only job
 * now is turning that result into the right thing to render.
 *
 * `lib/guest/resolve-table-placeholder.ts` is gone as of this pass --
 * both `page.tsx` and `cart/page.tsx` now run the real chain, which was
 * its last consumer; deleted rather than left as dead code once that
 * was confirmed (grep, zero remaining imports).
 */

interface RouteParams {
  params: Promise<{ slug: string }>;
}

export default async function GuestTablePage({ params }: RouteParams) {
  const { slug } = await params;
  const boot = await bootGuestPage(slug);

  if (boot.kind === 'unavailable') {
    return <GenericUnavailable />;
  }
  if (boot.kind === 'table_full') {
    return <TableFull />;
  }
  if (boot.kind === 'move_pending') {
    return <MoveConfirm fromTableCode={boot.fromTableCode} toTableCode={boot.toTableCode} />;
  }

  return (
    <GuestSessionProvider customToken={boot.customToken} context={boot.context}>
      <GuestMenuView />
    </GuestSessionProvider>
  );
}
