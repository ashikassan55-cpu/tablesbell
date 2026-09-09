'use client';

/**
 * src/components/cashier/settle-close-control.tsx
 *
 * The Cashier-only "Settle & Close Table" control (DECISIONS.md ADR-7's
 * final step), one per party inside `table-detail-panel.tsx`. Two-tap
 * confirm — closing a session is not reversible in practice and the tab
 * amount is shown so the cashier can be sure it is the right party.
 *
 * It calls `closeSession`; on success there is nothing local to do — the
 * live `tables` listener drops the party (and flips the table back to
 * `available` when it was the last one), so the panel re-renders itself.
 * Deliberately NOT in `components/console/` alongside `<PartyBillActions>`:
 * closing out is a Cashier station action, not something the Waiter
 * handheld offers (the server action still re-checks `canHandleBilling`).
 */

import { useState } from 'react';
import { closeSession } from '@/server/actions/bill.actions';
import type { GuestSessionStatus } from '@/types/firestore';

function formatAed(fils: number): string {
  return `AED ${(fils / 100).toFixed(2)}`;
}

function reasonText(reason: string): string {
  switch (reason) {
    case 'SESSION_ALREADY_CLOSED':
      return 'That tab is already closed.';
    case 'SESSION_NOT_FOUND':
      return "That party's tab is gone.";
    case 'ROLE_NOT_PERMITTED':
      return 'Your role cannot close tables.';
    case 'NOT_AUTHENTICATED':
      return 'Your terminal session expired — unlock again.';
    case 'BRANCH_NOT_AUTHORIZED':
      return 'You are not assigned to this branch.';
    default:
      return "Couldn't close the table. Try again.";
  }
}

interface SettleCloseControlProps {
  branchId: string;
  sessionId: string;
  partyLabel: string;
  sessionStatus: GuestSessionStatus;
  /** Live `session.runningTotals.grossFils` — shown in the confirm so the
   *  cashier can sanity-check they're closing the right party. */
  grossFils: number;
}

export function SettleCloseControl({
  branchId,
  sessionId,
  partyLabel,
  sessionStatus,
  grossFils,
}: SettleCloseControlProps) {
  const [phase, setPhase] = useState<'idle' | 'confirm' | 'closing'>('idle');
  const [error, setError] = useState<string | null>(null);

  // Only offered while the tab is live (task scope: active / billing).
  if (sessionStatus !== 'active' && sessionStatus !== 'billing') return null;

  async function handleClose() {
    setPhase('closing');
    setError(null);
    const result = await closeSession({ branchId, sessionId });
    if (result.outcome === 'closed') {
      // The `tables` listener removes this party (and frees the table if
      // it was the last) — nothing to do here; this component unmounts
      // with the party row.
      return;
    }
    setPhase('idle');
    setError(reasonText(result.reason));
  }

  if (phase === 'confirm' || phase === 'closing') {
    const closing = phase === 'closing';
    return (
      <div className="mt-2 rounded-lg border border-[#E5484D]/40 bg-[#FDECEC] p-2.5">
        <p className="text-xs text-[#7A1E22]">
          Close <span className="font-semibold">Party {partyLabel}</span> and settle{' '}
          <span className="font-semibold tabular-nums">{formatAed(grossFils)}</span>? The table returns to
          Available and this can&apos;t be undone.
        </p>
        <div className="mt-2 flex gap-2">
          <button
            type="button"
            onClick={() => setPhase('idle')}
            disabled={closing}
            className="flex h-9 flex-1 items-center justify-center rounded-lg border border-[#E5E7EB] bg-white text-xs font-semibold text-[#1F2937] disabled:opacity-50"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={handleClose}
            disabled={closing}
            className="flex h-9 flex-1 items-center justify-center rounded-lg bg-[#E5484D] text-xs font-semibold text-white disabled:opacity-60"
          >
            {closing ? 'Closing…' : 'Settle & Close'}
          </button>
        </div>
      </div>
    );
  }

  // phase === 'idle' (possibly after a failed attempt — `error` is set)
  return (
    <div className="mt-2">
      <button
        type="button"
        onClick={() => setPhase('confirm')}
        className="flex h-9 items-center rounded-lg border border-[#E5484D]/50 px-3 text-xs font-semibold text-[#E5484D]"
      >
        Settle &amp; Close Table
      </button>
      {error ? <p className="mt-1 text-xs text-[#7A1E22]">{error}</p> : null}
    </div>
  );
}
