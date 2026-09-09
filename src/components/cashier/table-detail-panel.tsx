'use client';

/**
 * src/components/cashier/table-detail-panel.tsx
 *
 * Two things live here:
 *   1. ADR-7: per-party bill controls — `<PartyBillActions>` ("Request
 *      Bill" → `billing` + alert; "Print Bill" → `printCount`, duplicate-
 *      flagged) and `<SettleCloseControl>` ("Settle & Close Table" →
 *      `closeSession`: session `closed`, party stripped from the table
 *      denorm, table back to `available`, bill alerts resolved). These
 *      replaced the old per-table "Print Receipt" mock; the physical
 *      ESC-POS `/api/print/[billId]` route (Layer 5, ADR-2) is still
 *      deferred.
 *   2. ADR-5: the Cashier-side line void. This panel lists the active
 *      lines of every order on the table and, for a `canVoidSentLine`
 *      role (cashier/manager/owner -- NOT a waiter), offers a "Void"
 *      button that opens `CashierVoidLineDialog` (reason required) and
 *      calls back up to `voidTicketLine`.
 *   3. LIVE (2026-09-09): parties render from the table's denormalised
 *      `parties[]`, and where a live `sessions` document exists for a
 *      party (matched on `sessionId`) the panel shows its real
 *      `runningTotals` net/VAT split plus order/item counts -- richer
 *      than the quick `openTabFils` on the table. Falls back to
 *      `party.openTabFils` when no session doc is present.
 */

import { useState } from 'react';
import { CashierVoidLineDialog } from './void-line-dialog';
import { SettleCloseControl } from './settle-close-control';
import { PartyBillActions } from '@/components/console/party-bill-actions';
import { canVoidSentLine, type StaffIdentity } from '@/lib/console/staff-permissions';
import { formatMoney } from '@/lib/format/money';
import type { VoidReasonCode } from '@/lib/console/void-reasons';
import type { SessionWithId } from '@/hooks/use-live-cashier-data';
import type { TableWithId } from './table-card';
import type { OrderWithId } from '@/components/ops/ticket-card';
import type { OrderLine } from '@/types/firestore';

interface TableDetailPanelProps {
  table: TableWithId;
  branchId: string;
  orders: OrderWithId[];
  sessions: SessionWithId[];
  staff: StaffIdentity;
  onVoidLine: (orderId: string, lineId: string, reason: VoidReasonCode, note: string) => void;
  onClose: () => void;
}

export function TableDetailPanel({ table, branchId, orders, sessions, staff, onVoidLine, onClose }: TableDetailPanelProps) {
  const [voidTarget, setVoidTarget] = useState<{ order: OrderWithId; line: OrderLine } | null>(null);

  const mayVoid = canVoidSentLine(staff);
  // ADR-11 — all orders at one table share the branch's currency; the
  // session running totals carry no currency of their own, so borrow it
  // from a priced ticket (fallback AED).
  const tableCurrency = orders.find((o) => typeof o.currency === 'string')?.currency;
  const money = (fils: number) => formatMoney(fils, tableCurrency);

  return (
    <div role="dialog" aria-modal="true" aria-labelledby="table-detail-title" className="fixed inset-0 z-40 flex items-end justify-center bg-black/40 sm:items-center sm:p-4">
      <div className="max-h-[90dvh] w-full max-w-md overflow-y-auto rounded-t-xl border border-[#E5E7EB] bg-white p-4 sm:rounded-xl">
        <div className="flex items-center justify-between">
          <h2 id="table-detail-title" className="text-lg font-bold text-[#1F2937]">
            {table.code}
          </h2>
          <button type="button" onClick={onClose} aria-label="Close" className="flex h-10 w-10 items-center justify-center text-[#6B7280]">
            <span aria-hidden="true">✕</span>
          </button>
        </div>

        {table.parties.length === 0 ? (
          <p className="mt-4 text-sm text-[#6B7280]">No open party at this table.</p>
        ) : (
          <ul className="mt-4 flex flex-col gap-3">
            {table.parties.map((party) => {
              const session = sessions.find((s) => s.id === party.sessionId);
              return (
                <li key={party.sessionId} className="rounded-lg border border-[#E5E7EB] p-3">
                  <div className="flex items-center justify-between">
                    <span className="text-sm font-semibold text-[#1F2937]">
                      Party {party.label}
                      {session?.guestName ? (
                        <span className="ms-1.5 rounded bg-[#ECFDF5] px-1.5 py-0.5 text-xs font-semibold text-[#065F46]">
                          {session.guestName}
                        </span>
                      ) : null}
                    </span>
                    <span className="text-xs text-[#6B7280]">
                      {party.guestCount} guests
                      {session ? ` · ${session.status}` : ''}
                    </span>
                  </div>
                  <p className="mt-1 text-xl font-bold tabular-nums text-[#1F2937]">
                    {money(session ? session.runningTotals.grossFils : party.openTabFils)}
                  </p>
                  {session ? (
                    <p className="mt-0.5 text-xs tabular-nums text-[#6B7280]">
                      Net {money(session.runningTotals.netFils)} · VAT {money(session.runningTotals.vatFils)}
                      {' · '}
                      {session.orderCount} order{session.orderCount === 1 ? '' : 's'} · {session.itemCount} item
                      {session.itemCount === 1 ? '' : 's'}
                    </p>
                  ) : null}
                  {Boolean(party.riskFlagged || session?.risk.flags.length) ? (
                    <p className="mt-1 flex items-center gap-1 text-xs font-semibold text-[#D97706]">
                      <span aria-hidden="true">⚠</span>
                      Flagged for review{session && session.risk.score > 0 ? ` (risk ${session.risk.score})` : ''}
                    </p>
                  ) : null}
                  {session ? (
                    <>
                      {session.printCount > 0 ? (
                        <p className="mt-1 text-xs font-semibold text-[#D97706]">
                          🖨 {session.printCount} bill{session.printCount === 1 ? '' : 's'} printed
                        </p>
                      ) : null}
                      <PartyBillActions
                        branchId={branchId}
                        sessionId={party.sessionId}
                        sessionStatus={session.status}
                        printCount={session.printCount ?? 0}
                      />
                      <SettleCloseControl
                        branchId={branchId}
                        sessionId={party.sessionId}
                        partyLabel={party.label}
                        sessionStatus={session.status}
                        grossFils={session.runningTotals.grossFils}
                      />
                    </>
                  ) : null}
                </li>
              );
            })}
          </ul>
        )}

        <section className="mt-4">
          <h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-[#6B7280]">Sent Items</h3>
          {orders.length === 0 ? (
            <p className="text-sm text-[#9CA3AF]">No sent orders for this table.</p>
          ) : (
            <ul className="flex flex-col gap-3">
              {orders.map((order) => {
                const activeLines = order.items.filter((line) => line.status === 'active');
                const voidedLines = order.items.filter((line) => line.status === 'voided');
                return (
                  <li key={order.id} className="rounded-lg border border-[#E5E7EB] p-3">
                    <p className="text-sm font-semibold text-[#1F2937]">
                      #{order.code} <span className="font-normal text-[#6B7280]">· {money(order.grossFils)}</span>
                      {order.placedBy?.kind === 'staff' ? (
                        <span className="ms-1.5 font-normal text-[#6B7280]">· by {order.placedByName ?? 'staff'}</span>
                      ) : order.guestName ? (
                        <span className="ms-1.5 font-normal text-[#6B7280]">· {order.guestName}</span>
                      ) : null}
                    </p>

                    <ul className="mt-2 flex flex-col gap-1.5">
                      {activeLines.map((line) => (
                        <li key={line.lineId} className="flex items-center justify-between gap-2 text-sm text-[#1F2937]">
                          <span className="min-w-0 flex-1 truncate">
                            <span className="font-semibold tabular-nums">{line.qty}×</span> {line.nameSnapshot.en}
                          </span>
                          <span className="tabular-nums text-[#6B7280]">{money(line.lineTotalFils)}</span>
                          {mayVoid ? (
                            <button
                              type="button"
                              onClick={() => setVoidTarget({ order, line })}
                              className="shrink-0 rounded-md border border-[#E5484D]/40 px-2 py-1 text-xs font-semibold text-[#E5484D]"
                            >
                              Void
                            </button>
                          ) : null}
                        </li>
                      ))}
                      {activeLines.length === 0 ? (
                        <li className="text-xs text-[#9CA3AF]">All lines voided.</li>
                      ) : null}
                    </ul>

                    {voidedLines.map((line) => (
                      <p key={line.lineId} className="mt-1 text-xs text-[#9CA3AF]">
                        <span className="line-through">{line.qty}× {line.nameSnapshot.en}</span>
                        {line.void ? ` — voided (${line.void.reason.replace(/_/g, ' ')})` : ' — voided'}
                      </p>
                    ))}
                  </li>
                );
              })}
            </ul>
          )}
          {!mayVoid && orders.length > 0 ? (
            <p className="mt-2 rounded-lg bg-[#F3F4F6] px-3 py-2 text-xs text-[#6B7280]">
              A {staff.role === 'server' ? 'server' : staff.role} cannot void sent items. Ask a cashier or manager.
            </p>
          ) : null}
        </section>

        <p className="mt-4 rounded-lg bg-[#F3F4F6] px-3 py-2 text-xs text-[#6B7280]">
          Bill actions are per party, above. The physical thermal receipt
          (ESC-POS <code>/api/print/[billId]</code>) is not wired yet.
        </p>
      </div>

      {voidTarget ? (
        <CashierVoidLineDialog
          line={voidTarget.line}
          orderCode={voidTarget.order.code}
          onConfirm={(reason, note) => {
            onVoidLine(voidTarget.order.id, voidTarget.line.lineId, reason, note);
            setVoidTarget(null);
          }}
          onCancel={() => setVoidTarget(null)}
        />
      ) : null}
    </div>
  );
}
