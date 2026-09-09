'use client';

/**
 * src/components/cashier/execute-ban-dialog.tsx
 *
 * Requirement #4. "The sole location where flagGhostOrder can actually
 * be executed" — this claim is only true if it's enforced here, at the
 * one place this component is ever rendered from
 * (`cashier-dashboard-view.tsx`, reached only via `alerts-inbox.tsx`'s
 * `canExecuteBan()`-gated "Review" button), AND re-verified inside this
 * component's own confirm handler, rather than trusted from the caller.
 * A component that skips its own check because "the parent already
 * checked" is exactly the single point of failure ARCHITECTURE.md §8.2's
 * two-independent-checks pattern exists to avoid.
 *
 * COPY ACCURACY NOTE: the summary below describes what ARCHITECTURE.md
 * §8.7 actually specifies — `revokeRefreshTokens` + `deleteUser`, and
 * both the anonymous UID and the device id added to their respective
 * permanent ban arrays. It does NOT say "drop cookies," on purpose: a
 * server has no mechanism to reach into a guest's browser and delete a
 * cookie it doesn't control. What actually happens is that the banned
 * device's cookie becomes USELESS — `isDeviceBanned()` in middleware
 * rejects it on the next scan — which reads differently from "dropping"
 * it, and a manager should see the accurate mechanism, not a
 * simplification that overstates what the system can reach into.
 *
 * Also offers the optional slug rotation §8.7 names explicitly: "OPTIONAL,
 * offered in the confirm sheet: rotateSlug({ tableId })" — for a
 * photographed QR code circulating off-premises, not just the one device.
 */

import { useState } from 'react';
import { canExecuteBan, type StaffIdentity } from '@/lib/console/staff-permissions';
import type { StaffAlert } from '@/types/firestore';

interface ExecuteBanDialogProps {
  alert: StaffAlert;
  staff: StaffIdentity;
  onConfirm: (input: { alertId: string; rotateSlug: boolean }) => void;
  onCancel: () => void;
}

export function ExecuteBanDialog({ alert, staff, onConfirm, onCancel }: ExecuteBanDialogProps) {
  const [rotateSlug, setRotateSlug] = useState(true);
  const authorized = canExecuteBan(staff);

  return (
    <div role="dialog" aria-modal="true" aria-labelledby="ban-dialog-title" className="fixed inset-0 z-40 flex items-center justify-center bg-black/50 p-4">
      <div className="w-full max-w-md rounded-xl border border-[#E5E7EB] bg-white p-4">
        <h2 id="ban-dialog-title" className="text-base font-bold text-[#1F2937]">
          Review &amp; Execute Ban
        </h2>
        <p className="mt-1 text-sm text-[#6B7280]">
          Table {alert.tableCode} {alert.orderCode ? `· #${alert.orderCode}` : ''}
        </p>

        <p className="mt-3 rounded-lg bg-[#F3F4F6] p-3 text-sm text-[#1F2937]">
          <span className="font-semibold">Kitchen report: </span>
          {alert.note}
        </p>

        {authorized ? (
          <>
            <div className="mt-3 rounded-lg border border-[#E5484D]/30 bg-[#FDECEC] p-3 text-sm text-[#7A1E22]">
              <p className="font-semibold">Confirming this will, permanently:</p>
              <ul className="mt-1.5 list-disc space-y-1 ps-4">
                <li>Void this ticket and credit the table&apos;s bill</li>
                <li>Revoke the guest&apos;s active session tokens</li>
                <li>Delete the guest&apos;s anonymous account</li>
                <li>Add their account and device to the permanent ban list</li>
              </ul>
              <p className="mt-1.5 text-xs text-[#7A1E22]/80">
                This does not reach into the guest&apos;s browser — their device simply stops being recognized the next time it scans.
              </p>
            </div>

            <label className="mt-3 flex items-center gap-2 text-sm text-[#1F2937]">
              <input
                type="checkbox"
                checked={rotateSlug}
                onChange={(event) => setRotateSlug(event.target.checked)}
                className="h-5 w-5 rounded border-[#D1D5DB]"
              />
              Also rotate Table {alert.tableCode}&apos;s QR code
            </label>

            <div className="mt-5 flex gap-2">
              <button
                type="button"
                onClick={onCancel}
                className="flex h-12 flex-1 items-center justify-center rounded-lg border border-[#E5E7EB] text-sm font-semibold text-[#1F2937]"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={() => {
                  // Explicit re-check, not just reliance on the conditional
                  // render above — this line is what makes the file header's
                  // "defense in depth" claim literally true rather than
                  // implied by the button simply not existing otherwise.
                  if (!canExecuteBan(staff)) return;
                  onConfirm({ alertId: alert.id, rotateSlug });
                }}
                className="flex h-12 flex-1 items-center justify-center rounded-lg bg-[#E5484D] text-sm font-semibold text-white"
              >
                Confirm Permanent Ban
              </button>
            </div>
          </>
        ) : (
          <>
            <p className="mt-3 rounded-lg bg-[#FDECEC] p-3 text-sm text-[#7A1E22]">
              {staff.displayName} does not hold manager/owner override authority. This action cannot proceed from this
              account, regardless of what this dialog displays — the same check runs again on confirm.
            </p>
            <button
              type="button"
              onClick={onCancel}
              className="mt-4 flex h-12 w-full items-center justify-center rounded-lg border border-[#E5E7EB] text-sm font-semibold text-[#1F2937]"
            >
              Close
            </button>
          </>
        )}
      </div>
    </div>
  );
}
