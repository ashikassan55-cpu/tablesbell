'use client';

/**
 * src/components/ops/ticket-detail-view.tsx
 *
 * The KDS ticket-detail screen. LIVE-WIRED (2026-09-09): `order` comes
 * from a real single-document listener (`hooks/use-live-order.ts`) — the
 * `initialOrder` prop and the `MOCK_ORDERS` lookup behind it are gone,
 * and `lib/kds/mock-orders.ts` is deleted. This was the last mock read in
 * the app.
 *
 * ACTIONS ARE REAL NOW, TOO — not because this task set out to build
 * actions, but because a live read makes local `setOrder` mutations
 * actively wrong (they fight the listener). Both handlers call actions
 * that ALREADY EXISTED:
 *   - `handleAdvance`  → `advanceTicket` (`server/actions/kds.actions.ts`),
 *     the same cookie-verified action the KDS queue already uses. Maps the
 *     `ready → prep` back-step's `'prep-return'` to `to: 'prep'`.
 *   - `handleVoidConfirm` → `voidTicketLine` (`server/actions/bill.actions.ts`),
 *     the ADR-5 action — this is finally its KDS caller (kitchen holds
 *     the void authority via this screen). NOT the §2.5 bill/session
 *     fan-out, which is still unbuilt; `voidTicketLine` writes the order
 *     doc + events, and the listener reflects it.
 * On success neither handler touches local state — the listener is the
 * single source of truth, exactly like the queue's `handleAdvance`.
 *
 * STILL A MOCK: `handleGhostReport` — there is no `staffAlerts` writer
 * action yet (see `ghost-order-report-dialog.tsx`'s header). It sets a
 * local boolean only; that is separate UI state, not an `order` mutation,
 * so it doesn't fight the listener.
 *
 * SEPARATE ClockProvider INSTANCE PER PAGE is still fine here — "the
 * current time" carries nothing worth preserving across a navigation.
 */

import { useMemo, useState, useTransition } from 'react';
import Link from 'next/link';
import { ClockProvider, useNow } from '@/components/providers/clock-provider';
import { formatElapsed, getElapsedSec } from '@/lib/kds/sla-status';
import { advanceTicket } from '@/server/actions/kds.actions';
import { voidTicketLine } from '@/server/actions/bill.actions';
import { useLiveOrder } from '@/hooks/use-live-order';
import type { VoidReasonCode } from '@/lib/console/void-reasons';
import { VoidLineDialog } from './void-line-dialog';
import { GhostOrderReportDialog } from './ghost-order-report-dialog';
import type { OrderWithId } from './ticket-card';
import type { OrderLine } from '@/types/firestore';
import { formatMoney } from '@/lib/format/money';

function DetailShell({ tenantSlug, message }: { tenantSlug: string; message: string }) {
  return (
    <div className="flex min-h-dvh flex-col bg-[#0B1220]">
      <header className="flex items-center gap-3 border-b border-[#25324A] bg-[#0F1826] px-4 py-3">
        <Link
          href={`/${tenantSlug}/kds`}
          aria-label="Back to ticket queue"
          className="flex h-10 w-10 items-center justify-center rounded-full text-[#F1F5F9]"
        >
          <span aria-hidden="true">←</span>
        </Link>
        <h1 className="text-lg font-semibold text-[#F1F5F9]">Ticket</h1>
      </header>
      <div className="flex flex-1 items-center justify-center px-6 text-center">
        <p className="text-sm text-[#94A3B8]">{message}</p>
      </div>
    </div>
  );
}

export function TicketDetailView({
  tenantId,
  branchId,
  orderId,
  tenantSlug,
}: {
  tenantId: string;
  branchId: string;
  orderId: string;
  tenantSlug: string;
}) {
  const live = useLiveOrder(tenantId, branchId, orderId);

  if (live.status === 'loading') {
    return <DetailShell tenantSlug={tenantSlug} message="Loading ticket…" />;
  }
  if (live.status === 'not_found') {
    return <DetailShell tenantSlug={tenantSlug} message="This ticket is no longer in the queue." />;
  }
  if (live.status === 'error') {
    return <DetailShell tenantSlug={tenantSlug} message="Couldn't load this ticket. Check your connection." />;
  }

  return (
    <ClockProvider>
      <TicketDetailBody order={live.order} branchId={branchId} orderId={orderId} tenantSlug={tenantSlug} />
    </ClockProvider>
  );
}

function TicketDetailBody({
  order,
  branchId,
  orderId,
  tenantSlug,
}: {
  order: OrderWithId;
  branchId: string;
  orderId: string;
  tenantSlug: string;
}) {
  const now = useNow();
  const [voidingLine, setVoidingLine] = useState<OrderLine | null>(null);
  const [ghostDialogOpen, setGhostDialogOpen] = useState(false);
  const [ghostReported, setGhostReported] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);
  const [pending, startAction] = useTransition();

  const elapsedSec = getElapsedSec(order.placedAt, order.readyAt ?? now);

  function handleAdvance(to: 'prep' | 'ready' | 'prep-return') {
    const target = to === 'prep-return' ? 'prep' : to;
    setActionError(null);
    startAction(async () => {
      const result = await advanceTicket({ branchId, orderId, to: target });
      if (result.outcome === 'rejected') {
        setActionError(`Couldn't advance this ticket (${result.reason}).`);
      }
      // 'advanced' / 'already_there': the listener reflects the new status.
    });
  }

  function handleVoidConfirm(reason: VoidReasonCode, note: string) {
    if (!voidingLine) return;
    const lineId = voidingLine.lineId;
    setVoidingLine(null);
    setActionError(null);
    startAction(async () => {
      const result = await voidTicketLine({ branchId, orderId, lineId, reason, note });
      if (result.outcome === 'rejected') {
        setActionError(`Couldn't void that line (${result.reason}).`);
      }
      // 'voided' / 'already_voided': the listener reflects the recompute.
    });
  }

  function handleGhostReport() {
    // Still a mock — no `staffAlerts` writer action exists yet. Local
    // boolean only, not an `order` mutation, so it does not fight the
    // listener. See `ghost-order-report-dialog.tsx`'s header.
    setGhostReported(true);
    setGhostDialogOpen(false);
  }

  const activeItems = useMemo(() => order.items.filter((line) => line.status === 'active'), [order.items]);
  const voidedItems = useMemo(() => order.items.filter((line) => line.status === 'voided'), [order.items]);
  const canVoidLines = order.status === 'new' || order.status === 'prep' || order.status === 'ready';
  // ADR-11 — every figure on this ticket is in the currency it was priced in.
  const money = (fils: number) => formatMoney(fils, order.currency);
  const taxPercent = (typeof order.vatPpm === 'number' ? order.vatPpm : 50_000) / 10_000;

  return (
    <div className="flex min-h-dvh flex-col bg-[#0B1220] pb-8">
      <header className="flex items-center gap-3 border-b border-[#25324A] bg-[#0F1826] px-4 py-3">
        <Link
          href={`/${tenantSlug}/kds`}
          aria-label="Back to ticket queue"
          className="flex h-10 w-10 items-center justify-center rounded-full text-[#F1F5F9]"
        >
          <span aria-hidden="true">←</span>
        </Link>
        <div className="min-w-0 flex-1">
          <h1 className="text-lg font-semibold text-[#F1F5F9]">
            {order.tableCode} <span className="text-[#94A3B8]">· Party {order.partyLabel}</span>
            {order.guestName ? (
              <span className="ms-2 rounded bg-[#1E3A32] px-1.5 py-0.5 text-xs font-semibold text-[#5EEAD4]">
                {order.guestName}
              </span>
            ) : null}
          </h1>
          <p className="text-xs text-[#94A3B8]">
            #{order.code} · {order.zoneId.replace('zone_', '').replace('_', ' ')}
            {order.placedBy?.kind === 'staff' ? ` · by ${order.placedByName ?? 'staff'}` : ''}
          </p>
        </div>
        <StatusBadge status={order.status} />
      </header>

      <main className="flex-1 space-y-4 px-4 py-4">
        {actionError ? (
          <p role="alert" className="rounded-lg border border-[#F87171]/30 bg-[#3B1418] px-3 py-2 text-sm text-[#F87171]">
            {actionError}
          </p>
        ) : null}

        {order.requiresStaffApproval ? (
          <p className="flex items-center gap-1.5 rounded-lg bg-[#3A2A0E] px-3 py-2 text-sm font-medium text-[#FBBF24]">
            <span aria-hidden="true">⚠</span>
            Flagged for staff approval — risk score {order.riskScore}
          </p>
        ) : null}

        <section className="grid grid-cols-2 gap-3 sm:grid-cols-4">
          <Stat label="Covers" value={String(order.covers)} />
          <Stat label="Priority" value={order.priority === 'urgent' ? 'Urgent' : 'Normal'} />
          <Stat label="Elapsed" value={formatElapsed(elapsedSec)} tabular />
          <Stat label="SLA Target" value={formatElapsed(order.slaTargetSec)} tabular />
        </section>

        <section className="rounded-xl border border-[#25324A] bg-[#151E2E] p-3">
          <h2 className="mb-2 text-xs font-semibold uppercase tracking-wide text-[#94A3B8]">Timeline</h2>
          <ul className="flex flex-col gap-1.5 text-sm text-[#CBD5E1]">
            <TimelineRow label="Placed" atMs={order.placedAt} nowMs={now} />
            <TimelineRow label="Prep started" atMs={order.prepStartedAt} nowMs={now} />
            <TimelineRow label="Ready" atMs={order.readyAt} nowMs={now} />
            <TimelineRow label="Served" atMs={order.servedAt} nowMs={now} />
          </ul>
        </section>

        {order.guestNote ? (
          <section className="rounded-xl border border-[#25324A] bg-[#0F1826] p-3">
            <h2 className="mb-1 text-xs font-semibold uppercase tracking-wide text-[#94A3B8]">Guest Note</h2>
            <p className="text-sm text-[#E2E8F0]">{order.guestNote}</p>
          </section>
        ) : null}

        <section>
          <h2 className="mb-2 text-xs font-semibold uppercase tracking-wide text-[#94A3B8]">Items</h2>
          <ul className="flex flex-col gap-2">
            {activeItems.map((line) => (
              <li
                key={line.lineId}
                className="flex items-start justify-between gap-3 rounded-xl border border-[#25324A] bg-[#151E2E] p-3"
              >
                <div className="min-w-0 flex-1">
                  <p className="text-sm font-semibold text-[#F1F5F9]">
                    <span className="tabular-nums">{line.qty}×</span> {line.nameSnapshot.en}
                  </p>
                  {line.modifiers.length > 0 ? (
                    <p className="mt-0.5 text-xs text-[#94A3B8]">{line.modifiers.map((m) => m.nameSnapshot.en).join(' · ')}</p>
                  ) : null}
                  <p className="mt-1 text-xs tabular-nums text-[#64748B]">{money(line.lineTotalFils)}</p>
                </div>
                {canVoidLines ? (
                  <button
                    type="button"
                    onClick={() => setVoidingLine(line)}
                    disabled={pending}
                    className="flex h-10 shrink-0 items-center rounded-lg border border-[#F87171]/40 px-3 text-xs font-semibold text-[#F87171] disabled:opacity-40"
                  >
                    Void
                  </button>
                ) : null}
              </li>
            ))}

            {voidedItems.map((line) => (
              <li
                key={line.lineId}
                className="rounded-xl border border-[#25324A] bg-[#0F1826] p-3 text-[#64748B]"
              >
                <p className="text-sm line-through decoration-[#64748B]">
                  <span className="tabular-nums">{line.qty}×</span> {line.nameSnapshot.en}
                </p>
                <p className="mt-1 text-xs text-[#F87171]">
                  Voided · {line.void?.reason.replace(/_/g, ' ')}
                  {line.void?.note ? ` — "${line.void.note}"` : ''}
                </p>
              </li>
            ))}
          </ul>
        </section>

        <section className="rounded-xl border border-[#25324A] bg-[#151E2E] p-3">
          <h2 className="mb-2 text-xs font-semibold uppercase tracking-wide text-[#94A3B8]">Bill</h2>
          <div className="flex justify-between text-sm text-[#CBD5E1]">
            <span>Net</span>
            <span className="tabular-nums">{money(order.netFils)}</span>
          </div>
          <div className="flex justify-between text-sm text-[#CBD5E1]">
            <span>VAT ({taxPercent}%)</span>
            <span className="tabular-nums">{money(order.vatFils)}</span>
          </div>
          {order.voidedFils > 0 ? (
            <div className="flex justify-between text-sm text-[#64748B]">
              <span>Voided</span>
              <span className="tabular-nums">−{money(order.voidedFils)}</span>
            </div>
          ) : null}
          <div className="mt-1.5 flex justify-between border-t border-[#25324A] pt-1.5 text-sm font-semibold text-[#F1F5F9]">
            <span>Total</span>
            <span className="tabular-nums">{money(order.grossFils)}</span>
          </div>
        </section>

        <section>
          {ghostReported ? (
            <p className="flex items-center gap-1.5 rounded-lg border border-[#FBBF24]/30 bg-[#3A2A0E]/40 px-3 py-2 text-sm text-[#FBBF24]">
              <span aria-hidden="true">✓</span>
              Reported to manager for review.
            </p>
          ) : (
            <button
              type="button"
              onClick={() => setGhostDialogOpen(true)}
              className="flex h-11 items-center gap-1.5 rounded-lg border border-[#FBBF24]/30 px-3 text-sm font-semibold text-[#FBBF24]"
            >
              <span aria-hidden="true">⚠</span>
              Report Suspected Ghost Order
            </button>
          )}
        </section>
      </main>

      <footer className="sticky bottom-0 border-t border-[#25324A] bg-[#0F1826] px-4 py-3">
        <DetailAction status={order.status} pending={pending} onAdvance={handleAdvance} />
      </footer>

      {voidingLine ? (
        <VoidLineDialog line={voidingLine} onConfirm={handleVoidConfirm} onCancel={() => setVoidingLine(null)} />
      ) : null}

      {ghostDialogOpen ? (
        <GhostOrderReportDialog order={order} onConfirm={handleGhostReport} onCancel={() => setGhostDialogOpen(false)} />
      ) : null}
    </div>
  );
}

function Stat({ label, value, tabular }: { label: string; value: string; tabular?: boolean }) {
  return (
    <div className="rounded-lg border border-[#25324A] bg-[#151E2E] p-2.5">
      <p className="text-[10px] font-semibold uppercase tracking-wide text-[#94A3B8]">{label}</p>
      <p className={`text-sm font-semibold text-[#F1F5F9] ${tabular ? 'tabular-nums' : ''}`}>{value}</p>
    </div>
  );
}

function TimelineRow({ label, atMs, nowMs }: { label: string; atMs: number | null; nowMs: number }) {
  return (
    <li className="flex items-center justify-between">
      <span className="text-[#94A3B8]">{label}</span>
      {atMs === null ? (
        <span className="text-[#64748B]">—</span>
      ) : (
        <span className="tabular-nums text-[#E2E8F0]">{formatElapsed(getElapsedSec(atMs, nowMs))} ago</span>
      )}
    </li>
  );
}

function StatusBadge({ status }: { status: OrderWithId['status'] }) {
  const STATUS_LABEL: Record<OrderWithId['status'], string> = {
    new: 'New',
    prep: 'Preparing',
    ready: 'Ready',
    served: 'Served',
    voided: 'Voided',
  };
  return (
    <span className="shrink-0 rounded-full border border-[#25324A] bg-[#0F1826] px-2.5 py-1 text-xs font-semibold uppercase tracking-wide text-[#CBD5E1]">
      {STATUS_LABEL[status]}
    </span>
  );
}

function DetailAction({
  status,
  pending,
  onAdvance,
}: {
  status: OrderWithId['status'];
  pending: boolean;
  onAdvance: (to: 'prep' | 'ready' | 'prep-return') => void;
}) {
  if (status === 'new') {
    return (
      <button
        type="button"
        onClick={() => onAdvance('prep')}
        disabled={pending}
        className="flex h-14 w-full items-center justify-center rounded-lg bg-[#14B8A6] text-base font-semibold text-[#04201C] active:scale-[0.98] disabled:opacity-50"
      >
        {pending ? 'Working…' : 'Accept · Preparing'}
      </button>
    );
  }

  if (status === 'prep') {
    return (
      <button
        type="button"
        onClick={() => onAdvance('ready')}
        disabled={pending}
        className="flex h-14 w-full items-center justify-center rounded-lg bg-[#22C55E] text-base font-semibold text-[#052E12] active:scale-[0.98] disabled:opacity-50"
      >
        {pending ? 'Working…' : 'Bump · Ready'}
      </button>
    );
  }

  if (status === 'ready') {
    // ready → prep, the dropped-plate / remake back-step — ARCHITECTURE.md
    // §2.2, kitchen/manager/owner, audited. This is the control the queue
    // page's ticket-card explicitly deferred to this screen.
    return (
      <button
        type="button"
        onClick={() => onAdvance('prep-return')}
        disabled={pending}
        className="flex h-14 w-full items-center justify-center rounded-lg border border-[#25324A] bg-[#151E2E] text-base font-semibold text-[#CBD5E1] active:scale-[0.98] disabled:opacity-50"
      >
        {pending ? 'Working…' : '↩ Return to Prep'}
      </button>
    );
  }

  // served or voided — terminal, no kitchen action remains.
  return (
    <p className="flex h-14 w-full items-center justify-center text-sm text-[#64748B]">
      No further kitchen action for this ticket.
    </p>
  );
}
