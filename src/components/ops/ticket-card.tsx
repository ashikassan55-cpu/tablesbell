'use client';

/**
 * src/components/ops/ticket-card.tsx
 *
 * Ops surface, tablet-first, dark mode (RULES.md §3 — see this file's
 * companion note in kds-queue-view.tsx for why dark mode specifically
 * deviates from the light ops palette RULES.md/the original Stitch review
 * specify, and why that deviation is scoped to KDS, not assumed project-
 * wide). Every state — SLA tier, priority, staff-approval flag — pairs a
 * color with an icon and a text label; nothing here signals state through
 * color alone (RULES.md §3, "both surfaces" rule 1).
 *
 * ACTION MAPPING: this card renders exactly one contextual action button,
 * not two simultaneous ones. ARCHITECTURE.md §2.2's transition table
 * gives the kitchen role exactly two forward moves — `new → prep` and
 * `prep → ready` — and explicitly does NOT give kitchen the `ready →
 * served` transition (that's server/cashier/manager, a floor action, not
 * a kitchen one). So the button's label and target change with the
 * ticket's current status; a `ready` ticket shows a status badge instead
 * of a third button. The `ready → prep` back-step (a dropped plate,
 * §2.2), the void-line dialog, and the ghost-order report all live on the
 * ticket detail page instead (kds/[orderId]/page.tsx) — this card links
 * to it via `tenantSlug`, threaded down from the page rather than
 * resolved from the current URL, since a relative link from
 * `/[tenantSlug]/kds` (no trailing slash) is genuinely ambiguous about
 * whether it replaces `kds` or appends after it.
 */

import Link from 'next/link';
import { useNow } from '@/components/providers/clock-provider';
import { formatElapsed, getElapsedSec, getSlaTier, type SlaTier } from '@/lib/kds/sla-status';
import { formatMoney } from '@/lib/format/money';
import type { Order } from '@/types/firestore';

/**
 * The canonical `Order` type (types/firestore.ts) intentionally has no
 * `id` field — a Firestore document's id lives in its path, not its body,
 * so adding one there would misrepresent the actual schema this file is
 * meant to stay in lockstep with. Client-side list code always needs the
 * two paired together, though, so that pairing gets its own type here
 * rather than bolting an `id` onto the document shape itself.
 */
export interface OrderWithId extends Order {
  id: string;
}

const SLA_TIER_STYLES: Record<SlaTier, { pill: string; dot: string; label: string }> = {
  onTrack: { pill: 'bg-[#16351F] text-[#4ADE80]', dot: 'bg-[#4ADE80]', label: 'On track' },
  approaching: { pill: 'bg-[#3A2A0E] text-[#FBBF24]', dot: 'bg-[#FBBF24]', label: 'Approaching' },
  breached: { pill: 'bg-[#3B1418] text-[#F87171]', dot: 'bg-[#F87171]', label: 'Over SLA' },
};

interface TicketCardProps {
  order: OrderWithId;
  tenantSlug: string;
  /** Advances the ticket exactly one legal step forward — see the file header. */
  onAdvance: (orderId: string, to: 'prep' | 'ready') => void;
}

export function TicketCard({ order, tenantSlug, onAdvance }: TicketCardProps) {
  const now = useNow();
  // Once a ticket is ready, its SLA clock freezes at how long prep
  // actually took (readyAt - placedAt) rather than continuing to tick
  // against the live clock — a ready ticket isn't still racing a target
  // it has already met, and a badge that kept climbing forever would say
  // otherwise.
  const elapsedSec = getElapsedSec(order.placedAt, order.readyAt ?? now);
  const slaTier = getSlaTier(elapsedSec, order.slaTargetSec);
  const slaStyle = SLA_TIER_STYLES[slaTier];

  const activeItems = order.items.filter((line) => line.status === 'active');
  const voidedItems = order.items.filter((line) => line.status === 'voided');

  return (
    <li className="flex flex-col gap-3 rounded-xl border border-[#25324A] bg-[#151E2E] p-3">
      <header className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <p className="text-base font-semibold text-[#F1F5F9]">
            {order.tableCode} <span className="text-[#94A3B8]">· {order.partyLabel}</span>
            {order.guestName ? (
              <span className="ms-2 rounded bg-[#1E3A32] px-1.5 py-0.5 text-xs font-semibold text-[#5EEAD4]">
                {order.guestName}
              </span>
            ) : null}
          </p>
          <p className="flex flex-wrap items-center gap-1 text-xs text-[#94A3B8]">
            <span aria-hidden="true">👥</span>
            {order.covers} covers ·{' '}
            <Link href={`/${tenantSlug}/kds/${order.id}`} className="underline decoration-dotted underline-offset-2">
              #{order.code}
            </Link>
            {order.placedBy?.kind === 'staff' ? (
              <span className="text-[#94A3B8]">· by {order.placedByName ?? 'staff'}</span>
            ) : null}
          </p>
        </div>

        <div className="flex flex-col items-end gap-1">
          {order.priority === 'urgent' ? (
            <span className="rounded-sm bg-[#3B1418] px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-[#F87171]">
              Urgent
            </span>
          ) : null}
          <span
            className={`flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-semibold tabular-nums ${slaStyle.pill}`}
            aria-label={`${slaStyle.label}, ${formatElapsed(elapsedSec)} elapsed`}
          >
            <span className={`h-1.5 w-1.5 rounded-full ${slaStyle.dot}`} aria-hidden="true" />
            {formatElapsed(elapsedSec)}
          </span>
        </div>
      </header>

      {order.requiresStaffApproval ? (
        <p className="flex items-center gap-1.5 rounded-md bg-[#3A2A0E] px-2 py-1.5 text-xs font-medium text-[#FBBF24]">
          <span aria-hidden="true">⚠</span>
          Needs staff approval before serving
        </p>
      ) : null}

      <ul className="flex flex-col gap-1.5">
        {activeItems.map((line) => (
          <li key={line.lineId} className="text-sm text-[#E2E8F0]">
            <span className="font-semibold tabular-nums">{line.qty}×</span> {line.nameSnapshot.en}
            {line.modifiers.length > 0 ? (
              <span className="block ps-5 text-xs text-[#94A3B8]">
                {line.modifiers.map((m) => m.nameSnapshot.en).join(' · ')}
              </span>
            ) : null}
          </li>
        ))}

        {voidedItems.map((line) => (
          <li key={line.lineId} className="text-sm text-[#64748B] line-through decoration-[#64748B]">
            <span className="font-semibold tabular-nums">{line.qty}×</span> {line.nameSnapshot.en}
            <span className="ms-1.5 text-xs font-medium text-[#F87171] no-underline">Voided</span>
          </li>
        ))}
      </ul>

      {order.guestNote ? (
        <p className="rounded-md border border-[#25324A] bg-[#0F1826] p-2 text-xs text-[#CBD5E1]">
          <span className="font-semibold text-[#94A3B8]">Note: </span>
          {order.guestNote}
        </p>
      ) : null}

      <footer className="mt-auto flex items-center justify-between gap-2 pt-1">
        <span className="text-sm font-semibold tabular-nums text-[#F1F5F9]">{formatMoney(order.grossFils, order.currency)}</span>
        <TicketAction
          status={order.status}
          onAdvance={() => onAdvance(order.id, order.status === 'new' ? 'prep' : 'ready')}
        />
      </footer>
    </li>
  );
}

function TicketAction({ status, onAdvance }: { status: Order['status']; onAdvance: () => void }) {
  if (status === 'new') {
    return (
      <button
        type="button"
        onClick={onAdvance}
        className="flex h-12 min-w-[9rem] items-center justify-center rounded-lg bg-[#14B8A6] px-4 text-sm font-semibold text-[#04201C] active:scale-[0.98]"
      >
        Accept · Preparing
      </button>
    );
  }

  if (status === 'prep') {
    return (
      <button
        type="button"
        onClick={onAdvance}
        className="flex h-12 min-w-[9rem] items-center justify-center rounded-lg bg-[#22C55E] px-4 text-sm font-semibold text-[#052E12] active:scale-[0.98]"
      >
        Bump · Ready
      </button>
    );
  }

  // ready — kitchen's job here is done; ready → served is a server/cashier
  // action (ARCHITECTURE.md §2.2), not a kitchen one, so no button renders.
  return (
    <span className="flex h-12 min-w-[9rem] items-center justify-center rounded-lg border border-[#22C55E]/30 bg-[#0F2318] px-4 text-sm font-semibold text-[#4ADE80]">
      Ready for pickup
    </span>
  );
}
