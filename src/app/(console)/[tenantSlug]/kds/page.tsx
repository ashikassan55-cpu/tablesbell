import { KdsQueueView } from '@/components/ops/kds-queue-view';
import { KdsNavTabs } from '@/components/ops/kds-nav-tabs';
import { requireStaffSession } from '@/server/services/resolve-staff-session';

/**
 * src/app/(console)/[tenantSlug]/kds/page.tsx
 *
 * REAL STAFF IDENTITY, replacing `resolveStaffContextPlaceholder`
 * entirely (that file is deleted this pass — it was KDS's only
 * consumer, confirmed before removal). `requireStaffSession` reads and
 * verifies the real staff session cookie server-side, redirecting to
 * `/{tenantSlug}/lock` if it's missing or invalid (defense in depth
 * alongside `middleware.ts`'s own gate — see that function's header).
 *
 * `branchId` IS A SIMPLIFICATION worth naming: a staff member's session
 * carries `bids`, an ARRAY of every branch they're authorized for
 * (ARCHITECTURE.md §1.6's `branchIds`) — this page always operates on
 * the first one. No branch-switcher UI exists anywhere in this codebase;
 * a genuinely multi-branch manager viewing this KDS screen today is
 * silently pinned to their first authorized branch, not offered a
 * choice. Real, not fixed this pass.
 */

export default async function KdsPage({
  params,
}: {
  params: Promise<{ tenantSlug: string }>;
}) {
  const { tenantSlug } = await params;
  const session = await requireStaffSession(tenantSlug);

  const branchId = session.bids[0];
  if (!branchId) {
    // A staff member authenticated successfully but has no branch
    // assigned at all -- a misconfigured member document, not a normal
    // login failure. Distinct from the lock-screen's own uniform
    // "wrong PIN" failure since this happens AFTER a real, successful
    // login, and a blank screen with no explanation would be worse than
    // naming the actual problem to whoever is looking at it.
    return (
      <div className="flex min-h-dvh items-center justify-center bg-[#0B1220] px-6 text-center">
        <p className="text-sm text-[#94A3B8]">Your account has no branch assigned. Contact a manager.</p>
      </div>
    );
  }

  return (
    <div className="flex min-h-dvh flex-col bg-[#0B1220]">
      <header className="flex items-center justify-between border-b border-[#25324A] bg-[#0F1826] px-4 py-3">
        <div>
          <h1 className="text-lg font-semibold text-[#F1F5F9]">Kitchen Display</h1>
          <p className="text-xs text-[#94A3B8]">{tenantSlug} · Live queue</p>
        </div>
      </header>

      <KdsNavTabs tenantSlug={tenantSlug} />
      <KdsQueueView tenantId={session.tid} branchId={branchId} tenantSlug={tenantSlug} />
    </div>
  );
}
