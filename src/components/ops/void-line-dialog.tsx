'use client';

/**
 * src/components/ops/void-line-dialog.tsx
 *
 * Collects a reason code and an optional note before voiding one ticket
 * line — the audit-trail fields ARCHITECTURE.md §2.5 writes into
 * `items[lineId].void`. One precision worth stating plainly: this audit
 * trail is enforced by `voidTicketLine`'s own transaction (§2.5), an
 * Admin-SDK staff server action — not by `firestore.rules`, which has no
 * role here at all, since a KDS void never reaches Firestore as a client
 * write in the first place. `firestore.rules`' `validAdjustmentEntry`
 * governs a different, unrelated write (the cashier's `adjustments[]`
 * ledger, ARCHITECTURE.md §1.10) — worth not conflating the two.
 *
 * The note field here is STAFF-authored, not guest-authored, so it is
 * not subject to Layer 2 deep sanitization (ARCHITECTURE.md §8.4) — that
 * defense exists specifically against untrusted guest input. A basic
 * client-side length cap is still applied as ordinary UX hygiene, not a
 * security control.
 */

import { useState } from 'react';
import { VOID_REASON_OPTIONS, type VoidReasonCode } from '@/lib/console/void-reasons';
import type { OrderLine } from '@/types/firestore';

const MAX_NOTE_CHARS = 150;

interface VoidLineDialogProps {
  line: OrderLine;
  onConfirm: (reason: VoidReasonCode, note: string) => void;
  onCancel: () => void;
}

export function VoidLineDialog({ line, onConfirm, onCancel }: VoidLineDialogProps) {
  const [reason, setReason] = useState<VoidReasonCode | null>(null);
  const [note, setNote] = useState('');

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="void-line-title"
      className="fixed inset-0 z-40 flex items-center justify-center bg-black/60 p-4"
    >
      <div className="w-full max-w-md rounded-xl border border-[#25324A] bg-[#151E2E] p-4">
        <h2 id="void-line-title" className="text-base font-semibold text-[#F1F5F9]">
          Void Line
        </h2>
        <p className="mt-1 text-sm text-[#94A3B8]">
          {line.qty}× {line.nameSnapshot.en}
        </p>

        <fieldset className="mt-4">
          <legend className="mb-2 text-xs font-semibold uppercase tracking-wide text-[#94A3B8]">Reason</legend>
          <div className="flex flex-col gap-2">
            {VOID_REASON_OPTIONS.map((option) => {
              const isSelected = reason === option.code;
              return (
                <button
                  key={option.code}
                  type="button"
                  onClick={() => setReason(option.code)}
                  aria-pressed={isSelected}
                  className={[
                    'flex h-12 items-center rounded-lg border px-3 text-sm font-medium transition-colors',
                    isSelected
                      ? 'border-[#F87171] bg-[#3B1418] text-[#F87171]'
                      : 'border-[#25324A] bg-[#0F1826] text-[#CBD5E1]',
                  ].join(' ')}
                >
                  {option.label}
                </button>
              );
            })}
          </div>
        </fieldset>

        <div className="mt-4">
          <label htmlFor="void-note" className="mb-1.5 block text-xs font-semibold uppercase tracking-wide text-[#94A3B8]">
            Note (optional)
          </label>
          <textarea
            id="void-note"
            rows={2}
            value={note}
            onChange={(event) => setNote(event.target.value.slice(0, MAX_NOTE_CHARS))}
            placeholder="e.g. dropped during plating"
            className="w-full resize-none rounded-lg border border-[#25324A] bg-[#0F1826] p-2.5 text-sm text-[#F1F5F9] placeholder:text-[#64748B]"
          />
        </div>

        <div className="mt-5 flex gap-2">
          <button
            type="button"
            onClick={onCancel}
            className="flex h-12 flex-1 items-center justify-center rounded-lg border border-[#25324A] text-sm font-semibold text-[#CBD5E1]"
          >
            Cancel
          </button>
          <button
            type="button"
            disabled={reason === null}
            onClick={() => reason && onConfirm(reason, note)}
            className="flex h-12 flex-1 items-center justify-center rounded-lg bg-[#F87171] text-sm font-semibold text-[#3B1418] disabled:opacity-40"
          >
            Confirm Void
          </button>
        </div>
      </div>
    </div>
  );
}
