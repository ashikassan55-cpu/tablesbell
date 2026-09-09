'use client';

/**
 * src/components/waiter/waiter-menu-entry.tsx
 *
 * The Waiter Floor's order-entry flow. Two things happen here:
 *
 * PARTY PICKER — an `orderRequests`/`orders` document is bound to ONE
 * session, so the waiter must say which open party at this table they are
 * ordering for. One party → auto-selected. 2+ → chips. ZERO parties →
 * a "Manually Open Table" button (`openTableSession`) that creates a
 * `source: 'staff'` session so a guest with no phone / no data who ordered
 * verbally can still be served; once the new party lands on the live
 * `tables` listener the menu renders and it is auto-selected.
 *
 * Each picked party also carries the shared `<PartyBillActions>` (ADR-7):
 * "Request Bill" (→ `billing` + the `bill_request` alert) and "Print Bill"
 * (→ `printCount++`, duplicate-flagged). `status` / `printCount` come off
 * the live `sessions` prop threaded down from `waiter-floor-view`.
 *
 * REAL SUBMIT (DECISIONS.md ADR-6) — `placeStaffOrder`
 * (`server/actions/staff-order.actions.ts`) writes an `orderRequests`
 * document with `placedBy: { kind: 'staff' }` and lets the existing
 * `priceOrderRequestTrigger` → `priceOrderRequest` → `orders` pipeline
 * price it. NOT a second write path to `orders`, NOT a re-implementation
 * of the pricing math. The `submitStaffOrder` mock is gone.
 *
 * After the action returns `{ submitted, requestId }` this component
 * briefly watches that `orderRequests` doc (staff can read it) for a
 * PRICING rejection — an item that went 86 between selection and send, a
 * modifier-constraint miss — and keeps the waiter on the cart to fix it.
 * `'priced'`/`'duplicate'`/timeout all mean "it's the kitchen's now" →
 * back to the floor.
 *
 * CATALOG is `useLiveCatalog` (menuPublished + live/availability); only
 * `available` items and options are offered.
 */

import { useEffect, useMemo, useRef, useState } from 'react';
import { doc, onSnapshot } from 'firebase/firestore';
import { db } from '@/lib/firebase/client';
import { useLiveCatalog, type CatalogItem } from '@/hooks/use-live-catalog';
import { placeStaffOrder, openTableSession } from '@/server/actions/staff-order.actions';
import { PartyBillActions } from '@/components/console/party-bill-actions';
import type { SessionWithId } from '@/hooks/live-snapshots';
import type { ModifierGroup, ModifierOption, TableParty } from '@/types/firestore';

function formatAed(fils: number): string {
  return `AED ${(fils / 100).toFixed(2)}`;
}

/** Staff-facing (not the guest's deliberately-coarse mapping) — a waiter
 *  can see enough to fix the cart and resend. */
function rejectionMessage(reason: string | undefined): string {
  switch (reason) {
    case 'ITEM_UNAVAILABLE':
    case 'ITEM_NOT_FOUND':
      return 'An item just went out of stock — review the cart and resend.';
    case 'MODIFIER_CONSTRAINT_VIOLATION':
    case 'INVALID_MODIFIER':
      return 'A modifier selection is invalid for that item.';
    case 'RATE_LIMITED':
      return 'This table has hit its order limit for the moment — wait a few seconds.';
    case 'SESSION_CLOSED':
    case 'SESSION_NOT_FOUND':
      return "That party's tab has closed. Pick a party again.";
    case 'NOT_AUTHENTICATED':
      return 'Your terminal session expired — unlock again.';
    case 'ROLE_NOT_PERMITTED':
      return 'Your role cannot place orders.';
    case 'BRANCH_NOT_AUTHORIZED':
      return 'You are not assigned to this branch.';
    case 'INVALID_LINES':
    case 'INVALID_QTY':
      return 'Something is off with the cart. Rebuild the order.';
    default:
      return "Couldn't send the order. Try again or check with the kitchen.";
  }
}

function openTableRejectionMessage(reason: string): string {
  switch (reason) {
    case 'TABLE_FULL':
      return 'This table is already at its party limit.';
    case 'TABLE_DISABLED':
      return 'This table is disabled.';
    case 'TABLE_NOT_FOUND':
      return 'That table no longer exists.';
    case 'NOT_AUTHENTICATED':
      return 'Your terminal session expired — unlock again.';
    case 'ROLE_NOT_PERMITTED':
      return 'Your role cannot open tables.';
    default:
      return "Couldn't open the table. Try again.";
  }
}

interface CartLine {
  item: CatalogItem;
  qty: number;
  selectedOptionIds: string[];
}

type WatchResult = 'ok' | { rejected: string } | 'timeout';

const PRICING_WATCH_MS = 10_000;

export function WaiterMenuEntry({
  tenantId,
  branchId,
  menuVersion,
  tableId,
  parties,
  sessions,
  tableCode,
  onSent,
}: {
  tenantId: string;
  branchId: string;
  menuVersion: number;
  tableId: string;
  parties: TableParty[];
  /** Live sessions for the branch — used to read each party's `status` /
   *  `printCount` for the per-party bill controls. */
  sessions: SessionWithId[];
  tableCode: string;
  onSent: () => void;
}) {
  const live = useLiveCatalog(tenantId, branchId, menuVersion);
  const [cart, setCart] = useState<CartLine[]>([]);
  const [modifierPickerItem, setModifierPickerItem] = useState<CatalogItem | null>(null);
  const [sending, setSending] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [selectedPartyId, setSelectedPartyId] = useState<string | null>(
    () => (parties.length === 1 ? parties[0].sessionId : null),
  );
  const [opening, setOpening] = useState(false);
  const [openError, setOpenError] = useState<string | null>(null);

  const mountedRef = useRef(true);
  useEffect(() => () => { mountedRef.current = false; }, []);

  // If parties resolve to exactly one after mount (listener update), adopt it.
  useEffect(() => {
    if (selectedPartyId === null && parties.length === 1) {
      setSelectedPartyId(parties[0].sessionId);
    }
  }, [parties, selectedPartyId]);

  // Clear the "Opening…" state once the new party actually shows up on the
  // live `tables` listener (or if the table already had one).
  useEffect(() => {
    if (parties.length > 0) setOpening(false);
  }, [parties.length]);

  async function handleOpenTable() {
    setOpenError(null);
    setOpening(true);
    const result = await openTableSession({ branchId, tableId });
    if (!mountedRef.current) return;
    if (result.outcome === 'rejected') {
      setOpening(false);
      setOpenError(openTableRejectionMessage(result.reason));
    }
    // 'opened' — keep `opening` true; the `tables` listener flips `parties`
    // and the effect above clears it as the menu renders.
  }

  const selectedParty = parties.find((p) => p.sessionId === selectedPartyId) ?? null;

  // Stable across a retried send of the SAME cart (idempotency key for
  // `priceOrderRequest`'s deterministic order id); rotates the instant the
  // cart contents change.
  const cartSignature = cart
    .map((line) => `${line.item.id}:${line.qty}:${line.selectedOptionIds.slice().sort().join(',')}`)
    .join('|');
  const clientRequestId = useMemo(() => crypto.randomUUID(), [cartSignature]);

  const availableCatalog = useMemo(
    () =>
      live.items
        .filter((item) => item.available)
        .map((item) => ({
          ...item,
          modifierGroups: item.modifierGroups.map((group) => ({
            ...group,
            options: group.options.filter((option) => option.available),
          })),
        })),
    [live.items],
  );

  function addToCart(item: CatalogItem, selectedOptionIds: string[]) {
    setSubmitError(null);
    setCart((prev) => {
      const key = selectedOptionIds.slice().sort().join(',');
      const existing = prev.find(
        (line) => line.item.id === item.id && line.selectedOptionIds.slice().sort().join(',') === key,
      );
      if (existing) {
        return prev.map((line) => (line === existing ? { ...line, qty: line.qty + 1 } : line));
      }
      return [...prev, { item, qty: 1, selectedOptionIds }];
    });
  }

  function changeQty(index: number, delta: number) {
    setCart((prev) =>
      prev.flatMap((line, i) => {
        if (i !== index) return [line];
        const nextQty = line.qty + delta;
        return nextQty <= 0 ? [] : [{ ...line, qty: nextQty }];
      }),
    );
  }

  function removeLine(index: number) {
    setCart((prev) => prev.filter((_, i) => i !== index));
  }

  function handleTapItem(item: CatalogItem) {
    if (item.modifierGroups.every((group) => group.options.length === 0)) {
      addToCart(item, []);
      return;
    }
    setModifierPickerItem(item);
  }

  function lineUnitPriceFils(line: CartLine): number {
    const deltaFils = line.item.modifierGroups
      .flatMap((group) => group.options)
      .filter((option) => line.selectedOptionIds.includes(option.id))
      .reduce((sum, option) => sum + option.priceDeltaFils, 0);
    return line.item.priceFils + deltaFils;
  }

  const cartTotalFils = cart.reduce((sum, line) => sum + lineUnitPriceFils(line) * line.qty, 0);
  const cartCount = cart.reduce((sum, line) => sum + line.qty, 0);

  function watchPricing(requestId: string): Promise<WatchResult> {
    return new Promise((resolve) => {
      const ref = doc(db, `tenants/${tenantId}/branches/${branchId}/orderRequests/${requestId}`);
      let settled = false;
      let timer: ReturnType<typeof setTimeout> | undefined;
      let unsub: (() => void) | undefined;
      const finish = (value: WatchResult) => {
        if (settled) return;
        settled = true;
        if (timer) clearTimeout(timer);
        unsub?.();
        resolve(value);
      };
      timer = setTimeout(() => finish('timeout'), PRICING_WATCH_MS);
      unsub = onSnapshot(
        ref,
        (snap) => {
          const data = snap.data() as { status?: string; reason?: string } | undefined;
          if (!data || data.status === 'pending') return;
          if (data.status === 'priced' || data.status === 'duplicate') finish('ok');
          else finish({ rejected: data.reason ?? 'UNKNOWN' });
        },
        () => finish('timeout'),
      );
      // `onSnapshot`'s first callback can fire synchronously on a cache
      // hit — if it already resolved, the `unsub?.()` inside `finish` was
      // a no-op (unsub not yet assigned); tear down now.
      if (settled) unsub();
    });
  }

  async function handleSend() {
    if (!selectedPartyId || sending || cart.length === 0) return;
    setSubmitError(null);
    setSending(true);

    const result = await placeStaffOrder({
      branchId,
      sessionId: selectedPartyId,
      lines: cart.map((line) => ({
        itemId: line.item.id,
        qty: line.qty,
        modifierOptionIds: line.selectedOptionIds,
      })),
      note: '',
      clientRequestId,
    });

    if (!mountedRef.current) return;

    if (result.outcome === 'rejected') {
      setSending(false);
      setSubmitError(rejectionMessage(result.reason));
      return;
    }

    const priced = await watchPricing(result.requestId);
    if (!mountedRef.current) return;

    setSending(false);
    if (typeof priced === 'object') {
      setSubmitError(rejectionMessage(priced.rejected));
      return;
    }
    // 'ok' or 'timeout' — the order is the kitchen's now.
    onSent();
  }

  if (live.status === 'loading') {
    return <p className="p-4 text-sm text-[#6B7280]">Loading the menu…</p>;
  }
  if (live.status === 'error') {
    return <p className="p-4 text-sm text-[#6B7280]">{live.error}</p>;
  }

  if (parties.length === 0) {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-3 px-6 text-center">
        <p className="text-sm font-semibold text-[#1F2937]">No open party at {tableCode}</p>
        <p className="max-w-xs text-sm text-[#6B7280]">
          Open a tab now for a guest who ordered verbally, or ask them to scan the table QR code.
        </p>
        {openError ? (
          <p role="alert" className="rounded-md border border-[#E5484D]/30 bg-[#FDECEC] px-3 py-2 text-xs text-[#7A1E22]">
            {openError}
          </p>
        ) : null}
        <button
          type="button"
          onClick={handleOpenTable}
          disabled={opening}
          className="flex h-12 items-center justify-center rounded-lg bg-[#0F5257] px-5 text-sm font-semibold text-white disabled:opacity-60"
        >
          {opening ? 'Opening…' : 'Manually Open Table'}
        </button>
      </div>
    );
  }

  return (
    <div className="flex h-full flex-col">
      <PartyPicker
        parties={parties}
        sessions={sessions}
        branchId={branchId}
        selectedPartyId={selectedPartyId}
        onSelect={setSelectedPartyId}
      />

      <div className="flex-1 space-y-5 overflow-y-auto pb-32">
        {live.categories.map((category) => {
          const items = availableCatalog.filter((item) => item.categoryId === category.id);
          if (items.length === 0) return null;
          return (
            <section key={category.id}>
              <h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-[#6B7280]">{category.label}</h3>
              <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-4">
                {items.map((item) => (
                  <button
                    key={item.id}
                    type="button"
                    onClick={() => handleTapItem(item)}
                    className="flex h-16 flex-col items-start justify-center rounded-lg border border-[#E5E7EB] bg-white p-2.5 text-start active:bg-[#F3F4F6]"
                  >
                    <span className="line-clamp-1 text-sm font-semibold text-[#1F2937]">{item.name.en}</span>
                    <span className="text-xs tabular-nums text-[#6B7280]">{formatAed(item.priceFils)}</span>
                  </button>
                ))}
              </div>
            </section>
          );
        })}
      </div>

      {cartCount > 0 ? (
        <div className="fixed inset-x-0 bottom-0 z-30 border-t border-[#E5E7EB] bg-white p-3">
          <ul className="mb-2 max-h-40 space-y-1 overflow-y-auto">
            {cart.map((line, index) => (
              <li
                key={`${line.item.id}::${line.selectedOptionIds.slice().sort().join(',')}`}
                className="flex items-center gap-2 text-sm text-[#1F2937]"
              >
                <span className="min-w-0 flex-1 truncate">
                  {line.item.name.en}
                  {line.selectedOptionIds.length > 0 ? (
                    <span className="text-[#6B7280]">
                      {' · '}
                      {line.item.modifierGroups
                        .flatMap((group) => group.options)
                        .filter((option) => line.selectedOptionIds.includes(option.id))
                        .map((option) => option.name.en)
                        .join(', ')}
                    </span>
                  ) : null}
                </span>
                <div className="flex shrink-0 items-center gap-1.5">
                  <button
                    type="button"
                    onClick={() => changeQty(index, -1)}
                    disabled={sending}
                    aria-label={`Reduce ${line.item.name.en}`}
                    className="flex h-8 w-8 items-center justify-center rounded-md border border-[#E5E7EB] text-[#1F2937] disabled:opacity-40"
                  >
                    −
                  </button>
                  <span className="w-5 text-center font-semibold tabular-nums">{line.qty}</span>
                  <button
                    type="button"
                    onClick={() => changeQty(index, 1)}
                    disabled={sending}
                    aria-label={`Add ${line.item.name.en}`}
                    className="flex h-8 w-8 items-center justify-center rounded-md border border-[#E5E7EB] text-[#1F2937] disabled:opacity-40"
                  >
                    +
                  </button>
                  <button
                    type="button"
                    onClick={() => removeLine(index)}
                    disabled={sending}
                    aria-label={`Remove ${line.item.name.en}`}
                    className="flex h-8 w-8 items-center justify-center rounded-md text-[#E5484D] disabled:opacity-40"
                  >
                    ✕
                  </button>
                </div>
              </li>
            ))}
          </ul>

          {submitError ? (
            <p role="alert" className="mb-2 rounded-md border border-[#E5484D]/30 bg-[#FDECEC] px-3 py-2 text-xs text-[#7A1E22]">
              {submitError}
            </p>
          ) : null}

          <button
            type="button"
            onClick={handleSend}
            disabled={sending || !selectedPartyId}
            className="flex h-14 w-full items-center justify-center gap-2 rounded-lg bg-[#0F5257] text-base font-semibold text-white disabled:opacity-60"
          >
            {sending
              ? 'Sending…'
              : !selectedPartyId
                ? 'Select a party first'
                : `Send · ${tableCode} · Party ${selectedParty?.label ?? '?'} · ${cartCount} items · ${formatAed(cartTotalFils)}`}
          </button>
        </div>
      ) : null}

      {modifierPickerItem ? (
        <ModifierQuickPick
          item={modifierPickerItem}
          onConfirm={(optionIds) => {
            addToCart(modifierPickerItem, optionIds);
            setModifierPickerItem(null);
          }}
          onCancel={() => setModifierPickerItem(null)}
        />
      ) : null}
    </div>
  );
}

function PartyPicker({
  parties,
  sessions,
  branchId,
  selectedPartyId,
  onSelect,
}: {
  parties: TableParty[];
  sessions: SessionWithId[];
  branchId: string;
  selectedPartyId: string | null;
  onSelect: (sessionId: string) => void;
}) {
  if (parties.length === 1) {
    const only = parties[0];
    const session = sessions.find((s) => s.id === only.sessionId);
    return (
      <div className="mb-3 space-y-2">
        <p className="rounded-lg bg-[#F3F4F6] px-3 py-2 text-xs text-[#6B7280]">
          Ordering for <span className="font-semibold text-[#1F2937]">Party {only.label}</span> · {only.guestCount} guests
          {only.openTabFils > 0 ? <span className="tabular-nums"> · {formatAed(only.openTabFils)} open</span> : null}
        </p>
        <PartyBillActions
          branchId={branchId}
          sessionId={only.sessionId}
          sessionStatus={session?.status ?? 'active'}
          printCount={session?.printCount ?? 0}
        />
      </div>
    );
  }

  const selectedParty = parties.find((p) => p.sessionId === selectedPartyId) ?? null;
  const selectedSession = selectedParty ? sessions.find((s) => s.id === selectedParty.sessionId) : undefined;

  return (
    <div className="mb-3">
      <p className="mb-1.5 text-xs font-semibold uppercase tracking-wide text-[#6B7280]">Which party?</p>
      <div className="flex flex-wrap gap-2">
        {parties.map((party) => {
          const active = party.sessionId === selectedPartyId;
          return (
            <button
              key={party.sessionId}
              type="button"
              onClick={() => onSelect(party.sessionId)}
              aria-pressed={active}
              className={[
                'flex h-11 items-center rounded-lg border px-3 text-sm font-medium',
                active ? 'border-[#0F5257] bg-[#0F5257] text-white' : 'border-[#E5E7EB] bg-white text-[#1F2937]',
              ].join(' ')}
            >
              Party {party.label}
              <span className={active ? 'ms-1.5 text-white/80' : 'ms-1.5 text-[#6B7280]'}>
                · {party.guestCount}
                {party.openTabFils > 0 ? <span className="tabular-nums"> · {formatAed(party.openTabFils)}</span> : null}
              </span>
            </button>
          );
        })}
      </div>
      {selectedParty ? (
        <div className="mt-2">
          <p className="mb-1 text-xs text-[#6B7280]">Party {selectedParty.label} bill</p>
          <PartyBillActions
            branchId={branchId}
            sessionId={selectedParty.sessionId}
            sessionStatus={selectedSession?.status ?? 'active'}
            printCount={selectedSession?.printCount ?? 0}
          />
        </div>
      ) : null}
    </div>
  );
}

function ModifierQuickPick({
  item,
  onConfirm,
  onCancel,
}: {
  item: CatalogItem;
  onConfirm: (optionIds: string[]) => void;
  onCancel: () => void;
}) {
  const [selected, setSelected] = useState<Record<string, string>>(() => {
    const defaults: Record<string, string> = {};
    for (const group of item.modifierGroups) {
      const defaultOption = group.options.find((option) => option.isDefault);
      if (defaultOption) defaults[group.id] = defaultOption.id;
    }
    return defaults;
  });

  function selectOption(group: ModifierGroup, option: ModifierOption) {
    setSelected((prev) => ({ ...prev, [group.id]: option.id }));
  }

  return (
    <div role="dialog" aria-modal="true" className="fixed inset-0 z-40 flex items-end justify-center bg-black/40 sm:items-center sm:p-4">
      <div className="w-full max-w-sm rounded-t-xl border border-[#E5E7EB] bg-white p-4 sm:rounded-xl">
        <h2 className="text-base font-bold text-[#1F2937]">{item.name.en}</h2>

        {item.modifierGroups.map((group) => (
          <fieldset key={group.id} className="mt-3">
            <legend className="mb-1.5 text-xs font-semibold uppercase tracking-wide text-[#6B7280]">{group.name.en}</legend>
            <div className="flex flex-wrap gap-2">
              {group.options.map((option) => {
                const isSelected = selected[group.id] === option.id;
                return (
                  <button
                    key={option.id}
                    type="button"
                    onClick={() => selectOption(group, option)}
                    className={`flex h-10 items-center rounded-full border px-3 text-sm font-medium ${
                      isSelected ? 'border-[#0F5257] bg-[#0F5257] text-white' : 'border-[#E5E7EB] text-[#1F2937]'
                    }`}
                  >
                    {option.name.en}
                  </button>
                );
              })}
            </div>
          </fieldset>
        ))}

        <div className="mt-4 flex gap-2">
          <button type="button" onClick={onCancel} className="flex h-12 flex-1 items-center justify-center rounded-lg border border-[#E5E7EB] text-sm font-semibold text-[#1F2937]">
            Cancel
          </button>
          <button
            type="button"
            onClick={() => onConfirm(Object.values(selected))}
            className="flex h-12 flex-1 items-center justify-center rounded-lg bg-[#0F5257] text-sm font-semibold text-white"
          >
            Add
          </button>
        </div>
      </div>
    </div>
  );
}
