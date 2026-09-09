import { adminDb } from '@/lib/firebase/admin';
import { resolveBranchSettings } from '@/lib/branch-settings';
import type { BranchSettings } from '@/types/firestore';

/**
 * src/server/services/menu-version.ts
 *
 * `resolveMenuVersion` — the one Admin SDK read that turns a branch into
 * the `n` in `menuPublished/v{n}`. Extracted from
 * `guest-boot.service.ts`, which had this exact line inline
 * (`branchSnap.data()?.menuVersion ?? 1`); the KDS Stock Board and the
 * Waiter order-entry menu now need the identical resolution to open their
 * `menuPublished` listener, so it lives in one place (RULES.md §4.9).
 *
 * WHY SERVER-SIDE, ONCE, NOT A LIVE LISTENER: exactly the reasoning
 * `guest-session-provider.tsx` / `use-live-menu.ts` already state — a
 * menu republished while a screen is open is picked up on the next
 * navigation/reload, not mid-session. Keeping the version number itself
 * live would make every catalog surface a 3-read load and let the doc
 * path change out from under the listener.
 *
 * `?? 1` is the same default the guest path uses: a branch with no
 * `menuVersion` field yet is treated as being on v1.
 */
export async function resolveMenuVersion(tenantId: string, branchId: string): Promise<number> {
  const branchSnap = await adminDb.doc(`tenants/${tenantId}/branches/${branchId}`).get();
  return (branchSnap.data() as { menuVersion?: number } | undefined)?.menuVersion ?? 1;
}

/**
 * ADR-11 — the branch's localization, resolved server-side once for the
 * guest boot context (so the guest menu / cart show the right currency)
 * the same way `resolveMenuVersion` resolves the menu number. Normalised
 * through `resolveBranchSettings`, so the caller always gets a full
 * `BranchSettings` (AED / 5% / empty footer when unset).
 */
export async function resolveBranchSettingsFor(
  tenantId: string,
  branchId: string,
): Promise<BranchSettings> {
  const branchSnap = await adminDb.doc(`tenants/${tenantId}/branches/${branchId}`).get();
  return resolveBranchSettings((branchSnap.data() as { settings?: unknown } | undefined)?.settings);
}
