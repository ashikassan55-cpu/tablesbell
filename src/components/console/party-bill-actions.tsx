'use client';

/**
 * src/components/console/party-bill-actions.tsx
 *
 * The per-party bill controls shared by the Cashier detail panel and the
 * Waiter take-order party picker (DECISIONS.md ADR-7). Both surfaces are
 * the light ops palette, so one component serves both.
 *
 *   - "Request Bill"  — only while the session is `active`. Calls
 *     `requestBill`, which flips the session to `billing` and raises the
 *     `bill_request` staff alert. Once `billing`, the button is replaced
 *     by a static "Bill requested" pill.
 *   - "Print Bill"    — while the session is `active` or `billing`. Calls
 *     `printBill`. If a copy was already printed (`printCount > 0` on the
 *     live session doc) the control self-labels "Reprint · DUPLICATE" and
 *     the post-print confirmation says which copy number it was.
 *
 * State is intentionally local and transient — the authoritative
 * `printCount` / `status` come back down as props from the live session
 * listener on the parent, so this component never has to hold them.
 */

import { useEffect, useRef, useState } from 'react';
import { requestBill, printBill } from '@/server/actions/bill.actions';
import type { GuestSessionStatus } from '@/types/firestore';

interface PartyBillActionsProps {
  branchId: string;
  sessionId: string;
  /** Live session status — decides which controls are offered. */
  sessionStatus: GuestSessionStatus;
  /** Live `session.printCount` — `> 0` means any further print is a duplicate. */
  printCount: number;
}

function reasonText(reason: string): string {
  switch (reason) {
    case 'NOT_AUTHENTICATED':
      return 'Your terminal session expired — unlock again.';
    case 'ROLE_NOT_PERMITTED':
      return 'Your role cannot handle billing.';
    case 'BRANCH_NOT_AUTHORIZED':
      return 'You are not assigned to this branch.';
    case 'SESSION_NOT_FOUND':
      return "That party's tab is gone.";
    case 'SESSION_CLOSED':
      return "That party's tab is already closed.";
    case 'SESSION_NOT_BILLABLE':
      return 'That tab is not in a billable state.';
    default:
      return 'Something went wrong. Try again.';
  }
}

export function PartyBillActions({ branchId, sessionId, sessionStatus, printCount }: PartyBillActionsProps) {
  const [busy, setBusy] = useState<null | 'request' | 'print'>(null);
  const [feedback, setFeedback] = useState<{ tone: 'ok' | 'error'; text: string } | null>(null);
  const mountedRef = useRef(true);
  useEffect(() => () => { mountedRef.current = false; }, []);

  const isBilling = sessionStatus === 'billing';
  const canRequest = sessionStatus === 'active';
  const canPrint = sessionStatus === 'active' || sessionStatus === 'billing';
  const willDuplicate = printCount > 0;

  async function handleRequest() {
    if (busy) return;
    setBusy('request');
    setFeedback(null);
    const result = await requestBill({ branchId, sessionId });
    if (!mountedRef.current) return;
    setBusy(null);
    setFeedback(
      result.outcome === 'requested'
        ? {
            tone: 'ok',
            text: result.alreadyBilling ? 'Kitchen/cashier re-notified.' : 'Bill requested — cashier notified.',
          }
        : { tone: 'error', text: reasonText(result.reason) },
    );
  }

  async function handlePrint() {
    if (busy) return;
    setBusy('print');
    setFeedback(null);
    const result = await printBill({ branchId, sessionId });
    if (!mountedRef.current) return;
    setBusy(null);
    setFeedback(
      result.outcome === 'printed'
        ? {
            tone: 'ok',
            text: result.duplicate
              ? `DUPLICATE bill printed (copy #${result.printCount}).`
              : 'Bill printed.',
          }
        : { tone: 'error', text: reasonText(result.reason) },
    );
  }

  if (!canRequest && !canPrint) return null;

  return (
    <div className="mt-2 flex flex-col gap-1.5">
      <div className="flex flex-wrap gap-2">
        {canRequest ? (
          <button
            type="button"
            onClick={handleRequest}
            disabled={busy !== null}
            className="flex h-9 items-center rounded-lg border border-[#0F5257]/40 px-3 text-xs font-semibold text-[#0F5257] disabled:opacity-50"
          >
            {busy === 'request' ? 'Requesting…' : 'Request Bill'}
          </button>
        ) : isBilling ? (
          <span className="flex h-9 items-center rounded-lg bg-[#FFFBEB] px-3 text-xs font-semibold text-[#92400E]">
            ⏳ Bill requested
          </span>
        ) : null}

        {canPrint ? (
          <button
            type="button"
            onClick={handlePrint}
            disabled={busy !== null}
            className={[
              'flex h-9 items-center rounded-lg px-3 text-xs font-semibold text-white disabled:opacity-50',
              willDuplicate ? 'bg-[#D97706]' : 'bg-[#0F5257]',
            ].join(' ')}
          >
            {busy === 'print'
              ? 'Printing…'
              : willDuplicate
                ? `Reprint Bill · DUPLICATE (#${printCount + 1})`
                : 'Print Bill'}
          </button>
        ) : null}
      </div>

      {feedback ? (
        <p
          className={[
            'text-xs',
            feedback.tone === 'ok' ? 'text-[#065F46]' : 'text-[#7A1E22]',
          ].join(' ')}
        >
          {feedback.text}
        </p>
      ) : null}
    </div>
  );
}
