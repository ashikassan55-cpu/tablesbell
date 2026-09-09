'use client';

/**
 * src/components/ops/ghost-order-report-dialog.tsx
 *
 * NOT the ghost-order ban. This is deliberate, and worth reading before
 * touching this file.
 *
 * ARCHITECTURE.md §8.7's `flagGhostOrder({ orderId, reason })` action is
 * gated `manager, owner + overrideAuth` — it permanently bans a UID and
 * device, revokes their tokens, and deletes their Firebase Auth user. It
 * is explicitly NOT available to the kitchen role. The task that asked
 * for this dialog described it as something "kitchen staff" can use, and
 * that phrasing was reconciled against the already-approved role gate
 * rather than silently either building an unauthorized kitchen-side ban
 * button or silently dropping the feature: kitchen genuinely is often the
 * first to notice an empty table with food arriving (§8.7's own
 * motivating scenario), so kitchen gets a way to ESCALATE that suspicion
 * to a manager — a `staffAlerts` entry, `type: 'ghost_suspected'` (a new,
 * not-yet-formally-added value; `'ghost_flagged'` is reserved for the
 * confirmed, already-executed ban event written by the real
 * `flagGhostOrder`, ARCHITECTURE.md §5.1 step 10). This dialog only ever
 * creates that alert. It never bans anyone, and its copy says so.
 *
 * The actual ban executes on the manager/owner's own console — the
 * `ghost-order-dialog.tsx` already scoped for the Cashier Dashboard pass
 * (MEMORY.md §3) — where the role gate that matters is actually enforced.
 */

import { useState } from 'react';
import type { OrderWithId } from './ticket-card';

const MAX_NOTE_CHARS = 150;

interface GhostOrderReportDialogProps {
  order: OrderWithId;
  onConfirm: (note: string) => void;
  onCancel: () => void;
}

export function GhostOrderReportDialog({ order, onConfirm, onCancel }: GhostOrderReportDialogProps) {
  const [note, setNote] = useState('');

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="ghost-report-title"
      className="fixed inset-0 z-40 flex items-center justify-center bg-black/60 p-4"
    >
      <div className="w-full max-w-md rounded-xl border border-[#3A2A0E] bg-[#151E2E] p-4">
        <div className="flex items-center gap-2">
          <span className="text-xl text-[#FBBF24]" aria-hidden="true">
            ⚠
          </span>
          <h2 id="ghost-report-title" className="text-base font-semibold text-[#F1F5F9]">
            Report Suspected Ghost Order
          </h2>
        </div>

        <p className="mt-3 rounded-lg bg-[#3A2A0E] p-3 text-sm text-[#FBBF24]">
          This does <strong>not</strong> ban anyone. It notifies a manager to review Table {order.tableCode} · #
          {order.code} and take action — including a permanent ban — only if they confirm it.
        </p>

        <div className="mt-4">
          <label htmlFor="ghost-note" className="mb-1.5 block text-xs font-semibold uppercase tracking-wide text-[#94A3B8]">
            What did you notice? (optional)
          </label>
          <textarea
            id="ghost-note"
            rows={3}
            value={note}
            onChange={(event) => setNote(event.target.value.slice(0, MAX_NOTE_CHARS))}
            placeholder="e.g. table has been empty since the ticket arrived"
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
            onClick={() => onConfirm(note)}
            className="flex h-12 flex-1 items-center justify-center rounded-lg bg-[#FBBF24] text-sm font-semibold text-[#3A2A0E]"
          >
            Send to Manager
          </button>
        </div>
      </div>
    </div>
  );
}
