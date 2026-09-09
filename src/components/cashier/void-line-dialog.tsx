'use client';

/**
 * src/components/cashier/void-line-dialog.tsx
 *
 * The Cashier-terminal void reason prompt (DECISIONS.md ADR-5). Same job
 * as `components/ops/void-line-dialog.tsx` -- collect a `VoidReasonCode`
 * and an optional note before a line is voided -- but rendered in the
 * light ops palette (`#F3F4F6`/teal) the Cashier surface uses, not KDS's
 * dark one. The two dialogs deliberately differ ONLY in palette; the
 * reason list is the one shared `VOID_REASON_OPTIONS`
 * (`lib/console/void-reasons.ts`), and both feed the same real
 * `voidTicketLine` action.
 *
 * A reason is REQUIRED (the confirm button stays disabled until one is
 * picked) -- ADR-5's "the UI MUST prompt them to select/enter a Void
 * Reason ... permanently appended ... for financial accountability."
 * The note is staff-authored, so it gets an ordinary length cap as UX
 * hygiene, not Layer-2 guest sanitisation.
 */

import { useState } from 'react';
import { VOID_REASON_OPTIONS, type VoidReasonCode } from '@/lib/console/void-reasons';
import type { OrderLine } from '@/types/firestore';

const MAX_NOTE_CHARS = 150;

function formatAed(fils: number): string {
  return `AED ${(fils / 100).toFixed(2)}`;
}

interface CashierVoidLineDialogProps {
  line: OrderLine;
  orderCode: string;
  onConfirm: (reason: VoidReasonCode, note: string) => void;
  onCancel: () => void;
}

export function CashierVoidLineDialog({ line, orderCode, onConfirm, onCancel }: CashierVoidLineDialogProps) {
  const [reason, setReason] = useState<VoidReasonCode | null>(null);
  const [note, setNote] = useState('');
  const [submitting, setSubmitting] = useState(false);

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="cashier-void-title"
      className="fixed inset-0 z-50 flex items-end justify-center bg-black/40 p-0 sm:items-center sm:p-4"
    >
      <div className="w-full max-w-md rounded-t-xl border border-[#E5E7EB] bg-white p-4 sm:rounded-xl">
        <h2 id="cashier-void-title" className="text-base font-bold text-[#1F2937]">
          Void Line
        </h2>
        <p className="mt-1 text-sm text-[#6B7280]">
          #{orderCode} · {line.qty}× {line.nameSnapshot.en} · {formatAed(line.lineTotalFils)}
        </p>

        <fieldset className="mt-4">
          <legend className="mb-2 text-xs font-semibold uppercase tracking-wide text-[#6B7280]">
            Reason (required)
          </legend>
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
                      ? 'border-[#0F5257] bg-[#0F5257]/10 text-[#0F5257]'
                      : 'border-[#E5E7EB] bg-white text-[#1F2937]',
                  ].join(' ')}
                >
                  {option.label}
                </button>
              );
            })}
          </div>
        </fieldset>

        <div className="mt-4">
          <label htmlFor="cashier-void-note" className="mb-1.5 block text-xs font-semibold uppercase tracking-wide text-[#6B7280]">
            Note (optional)
          </label>
          <textarea
            id="cashier-void-note"
            rows={2}
            value={note}
            onChange={(event) => setNote(event.target.value.slice(0, MAX_NOTE_CHARS))}
            placeholder="e.g. guest cancelled after ordering"
            className="w-full resize-none rounded-lg border border-[#E5E7EB] bg-white p-2.5 text-sm text-[#1F2937] placeholder:text-[#9CA3AF]"
          />
        </div>

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
            disabled={reason === null || submitting}
            onClick={() => {
              if (reason === null) return;
              setSubmitting(true);
              onConfirm(reason, note.trim());
            }}
            className="flex h-12 flex-1 items-center justify-center rounded-lg bg-[#E5484D] text-sm font-semibold text-white disabled:opacity-40"
          >
            {submitting ? 'Voiding…' : 'Confirm Void'}
          </button>
        </div>
      </div>
    </div>
  );
}
