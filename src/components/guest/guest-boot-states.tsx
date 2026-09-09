/**
 * src/components/guest/guest-boot-states.tsx
 *
 * EXTRACTED from `app/(guest)/t/[slug]/page.tsx`, which originally
 * defined these three inline as local functions. `cart/page.tsx` needed
 * the identical markup for the identical outcomes of the identical
 * boot chain (`guest-boot.service.ts`'s `bootGuestPage`) -- these states
 * describe a device/session, not a page, so there was never a reason for
 * two independently-drifting copies. Server Components (no `'use client'`
 * here) -- nothing below is interactive except the intentionally-disabled
 * button in `MoveConfirm`.
 *
 * Still minimal, undesigned placeholder markup -- see MEMORY.md §4. No
 * Stitch design reference exists for any of these three states yet.
 */

export function GenericUnavailable() {
  return (
    <div className="flex min-h-dvh flex-col items-center justify-center bg-[#FAF9F6] px-6 text-center">
      <p className="text-sm font-medium text-[#6B7280]">
        This table isn&apos;t available right now. Please ask a member of staff for help.
      </p>
    </div>
  );
}

export function TableFull() {
  return (
    <div className="flex min-h-dvh flex-col items-center justify-center bg-[#FAF9F6] px-6 text-center">
      <p className="text-sm font-medium text-[#1F2937]">This table already has the maximum number of open bills.</p>
      <p className="mt-1 text-xs text-[#6B7280]">Please ask a member of staff to seat your party.</p>
    </div>
  );
}

export function MoveConfirm({ fromTableCode, toTableCode }: { fromTableCode: string; toTableCode: string }) {
  return (
    <div className="flex min-h-dvh flex-col items-center justify-center gap-4 bg-[#FAF9F6] px-6 text-center">
      <p className="text-sm font-medium text-[#1F2937]">
        Your order is currently open at table <span className="font-semibold">{fromTableCode}</span>. Did you move
        to <span className="font-semibold">{toTableCode}</span>?
      </p>
      {/*
        No confirm action exists to call yet -- `resolveGuestSession`
        deliberately detects a table move without acting on it (see that
        function's own header). Left visibly disabled rather than wired
        to a no-op, so this reads as "not built yet," not as a silently
        broken button.
      */}
      <button
        type="button"
        disabled
        className="rounded-full bg-[#E85D3F] px-5 py-2.5 text-sm font-semibold text-white opacity-50"
      >
        Yes, move my order
      </button>
    </div>
  );
}
