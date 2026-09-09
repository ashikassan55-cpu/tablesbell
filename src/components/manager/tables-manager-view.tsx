'use client';

/**
 * src/components/manager/tables-manager-view.tsx
 *
 * Manager Table Management (ARCHITECTURE.md §1.6, §8.1). Lists the
 * branch's tables live (`useLiveTables`), lets a manager create / edit
 * them and toggle `available` ⇄ `disabled` via `upsertTable`, rotate a
 * leaked slug via `rotateTableSlug`, and open the printable QR sheet
 * (`<QrPrintSheet>`) for one table or all of them.
 *
 * Skeleton scope: no drag reorder (server assigns `sortIndex` on
 * create), no bulk delete (a table with history should be disabled, not
 * removed — deletion isn't wired), no zone management (zone is free text).
 */

import { useEffect, useMemo, useRef, useState } from 'react';
import { useLiveTables } from '@/hooks/use-live-tables';
import { upsertTable, rotateTableSlug } from '@/server/actions/table.actions';
import { QrPrintSheet, type QrPrintTable } from './qr-print-sheet';
import type { TableWithId } from '@/components/cashier/table-card';

interface TablesManagerViewProps {
  tenantId: string;
  branchId: string;
  appUrl: string;
  restaurantName: string;
}

type EditTarget = 'new' | TableWithId;

interface FormState {
  code: string;
  label: string;
  zoneId: string;
  seats: string;
  status: 'available' | 'disabled';
}

function blankForm(): FormState {
  return { code: '', label: '', zoneId: '', seats: '2', status: 'available' };
}
function formFromTable(t: TableWithId): FormState {
  return {
    code: t.code,
    label: t.label,
    zoneId: t.zoneId ?? '',
    seats: String(t.seats ?? 2),
    status: t.status === 'disabled' ? 'disabled' : 'available',
  };
}

function reasonText(reason: string): string {
  switch (reason) {
    case 'CODE_REQUIRED':
      return 'A table number is required.';
    case 'TABLE_NOT_FOUND':
      return 'That table no longer exists.';
    case 'SLUG_COLLISION':
      return 'Slug clash — a one-in-a-trillion fluke. Try again.';
    case 'ROLE_NOT_PERMITTED':
      return 'Only a manager or owner can change tables.';
    case 'NOT_AUTHENTICATED':
      return 'Your session expired — unlock the terminal again.';
    case 'BRANCH_NOT_AUTHORIZED':
      return 'You are not assigned to this branch.';
    default:
      return 'Something went wrong. Try again.';
  }
}

export function TablesManagerView({ tenantId, branchId, appUrl, restaurantName }: TablesManagerViewProps) {
  const live = useLiveTables(tenantId, branchId);
  const [edit, setEdit] = useState<EditTarget | null>(null);
  const [form, setForm] = useState<FormState>(blankForm);
  const [busy, setBusy] = useState<null | 'save' | 'toggle' | 'rotate'>(null);
  const [busyRow, setBusyRow] = useState<string | null>(null);
  const [feedback, setFeedback] = useState<{ tone: 'ok' | 'error'; text: string } | null>(null);
  const [printTables, setPrintTables] = useState<QrPrintTable[] | null>(null);
  const mountedRef = useRef(true);
  useEffect(() => () => { mountedRef.current = false; }, []);

  const printable = useMemo<QrPrintTable[]>(
    () =>
      live.tables.map((t) => ({ id: t.id, code: t.code, label: t.label, zoneId: t.zoneId ?? '', slug: t.slug })),
    [live.tables],
  );

  function openCreate() {
    setForm(blankForm());
    setEdit('new');
    setFeedback(null);
  }
  function openEdit(t: TableWithId) {
    setForm(formFromTable(t));
    setEdit(t);
    setFeedback(null);
  }

  async function saveForm() {
    if (busy) return;
    setBusy('save');
    setFeedback(null);
    const result = await upsertTable({
      branchId,
      tableId: edit && edit !== 'new' ? edit.id : undefined,
      code: form.code,
      label: form.label,
      zoneId: form.zoneId,
      seats: Number.parseInt(form.seats, 10),
      status: form.status,
    });
    if (!mountedRef.current) return;
    setBusy(null);
    if (result.outcome === 'rejected') {
      setFeedback({ tone: 'error', text: reasonText(result.reason) });
      return;
    }
    setEdit(null);
    setFeedback({
      tone: 'ok',
      text: result.outcome === 'created' ? `Table added — slug ${result.slug}.` : 'Table updated.',
    });
  }

  async function toggleStatus(t: TableWithId) {
    if (busy) return;
    setBusy('toggle');
    setBusyRow(t.id);
    setFeedback(null);
    const next = t.status === 'disabled' ? 'available' : 'disabled';
    const result = await upsertTable({
      branchId,
      tableId: t.id,
      code: t.code,
      label: t.label,
      zoneId: t.zoneId ?? '',
      seats: t.seats ?? 2,
      status: next,
    });
    if (!mountedRef.current) return;
    setBusy(null);
    setBusyRow(null);
    if (result.outcome === 'rejected') {
      setFeedback({ tone: 'error', text: reasonText(result.reason) });
    }
  }

  async function rotate(t: TableWithId) {
    if (busy) return;
    if (!confirm(`Rotate the QR for ${t.label}? The current printed code stops working immediately.`)) return;
    setBusy('rotate');
    setBusyRow(t.id);
    setFeedback(null);
    const result = await rotateTableSlug({ branchId, tableId: t.id });
    if (!mountedRef.current) return;
    setBusy(null);
    setBusyRow(null);
    setFeedback(
      result.outcome === 'rotated'
        ? { tone: 'ok', text: `New slug ${result.slug} (v${result.version}) — reprint this table's QR.` }
        : { tone: 'error', text: reasonText(result.reason) },
    );
  }

  if (live.status === 'loading') {
    return <p className="text-sm text-[#6B7280]">Loading tables…</p>;
  }
  if (live.status === 'error') {
    return (
      <p className="rounded-lg border border-[#E5484D]/30 bg-[#FDECEC] px-3 py-2 text-sm text-[#7A1E22]">
        Couldn&apos;t load tables: {live.error}
      </p>
    );
  }

  return (
    <div className="pb-24">
      <div className="mb-3 flex flex-wrap items-center gap-2">
        <p className="text-sm text-[#6B7280]">
          {live.tables.length} table{live.tables.length === 1 ? '' : 's'} · QR codes point at{' '}
          <span className="font-mono text-xs text-[#1F2937]">{appUrl}/t/…</span>
        </p>
        <div className="ms-auto flex gap-2">
          <button
            type="button"
            onClick={() => setPrintTables(printable)}
            disabled={live.tables.length === 0}
            className="h-10 rounded-lg border border-[#0F5257] px-3 text-sm font-semibold text-[#0F5257] disabled:opacity-50"
          >
            Print all QRs
          </button>
          <button
            type="button"
            onClick={openCreate}
            className="h-10 rounded-lg bg-[#0F5257] px-4 text-sm font-semibold text-white"
          >
            + Add table
          </button>
        </div>
      </div>

      {feedback ? (
        <p
          className={`mb-3 rounded-lg border px-3 py-2 text-sm ${
            feedback.tone === 'ok'
              ? 'border-[#0F5257]/30 bg-[#ECFDF5] text-[#065F46]'
              : 'border-[#E5484D]/30 bg-[#FDECEC] text-[#7A1E22]'
          }`}
        >
          {feedback.text}
        </p>
      ) : null}

      {live.tables.length === 0 ? (
        <p className="rounded-lg border border-dashed border-[#E5E7EB] bg-white p-6 text-center text-sm text-[#6B7280]">
          No tables yet. Add your first one to generate its QR code.
        </p>
      ) : (
        <ul className="flex flex-col gap-2">
          {live.tables.map((t) => (
            <li
              key={t.id}
              className="flex flex-wrap items-center gap-x-3 gap-y-1 rounded-lg border border-[#E5E7EB] bg-white p-3"
            >
              <div className="min-w-0 flex-1">
                <p className="text-sm font-semibold text-[#1F2937]">
                  {t.label}
                  {t.code && t.code !== t.label ? (
                    <span className="ms-1.5 font-normal text-[#6B7280]">· {t.code}</span>
                  ) : null}
                </p>
                <p className="text-xs text-[#6B7280]">
                  {t.zoneId ? `${t.zoneId} · ` : ''}
                  {t.seats ?? '?'} seats · slug <span className="font-mono">{t.slug}</span>
                  {t.slugVersion > 1 ? ` (v${t.slugVersion})` : ''}
                </p>
              </div>

              <span
                className={`rounded-full px-2 py-0.5 text-[10px] font-semibold uppercase ${
                  t.status === 'disabled'
                    ? 'bg-[#F3F4F6] text-[#9CA3AF]'
                    : t.partyCount > 0
                      ? 'bg-[#ECFDF5] text-[#065F46]'
                      : 'bg-[#F3F4F6] text-[#6B7280]'
                }`}
              >
                {t.status === 'disabled' ? 'Disabled' : t.partyCount > 0 ? 'In use' : 'Available'}
              </span>

              <div className="flex gap-1.5">
                <button
                  type="button"
                  onClick={() => setPrintTables([{ id: t.id, code: t.code, label: t.label, zoneId: t.zoneId ?? '', slug: t.slug }])}
                  className="h-9 rounded-md border border-[#E5E7EB] px-2.5 text-xs font-semibold text-[#1F2937]"
                >
                  Print QR
                </button>
                <button
                  type="button"
                  onClick={() => openEdit(t)}
                  className="h-9 rounded-md border border-[#E5E7EB] px-2.5 text-xs font-semibold text-[#1F2937]"
                >
                  Edit
                </button>
                <button
                  type="button"
                  onClick={() => toggleStatus(t)}
                  disabled={busy !== null && busyRow === t.id}
                  className="h-9 rounded-md border border-[#E5E7EB] px-2.5 text-xs font-semibold text-[#1F2937] disabled:opacity-50"
                >
                  {t.status === 'disabled' ? 'Enable' : 'Disable'}
                </button>
                <button
                  type="button"
                  onClick={() => rotate(t)}
                  disabled={busy !== null && busyRow === t.id}
                  className="h-9 rounded-md border border-[#D97706]/50 px-2.5 text-xs font-semibold text-[#B45309] disabled:opacity-50"
                >
                  Rotate QR
                </button>
              </div>
            </li>
          ))}
        </ul>
      )}

      {edit ? (
        <div role="dialog" aria-modal="true" className="fixed inset-0 z-40 flex items-end justify-center bg-black/40 sm:items-center sm:p-4">
          <div className="w-full max-w-sm rounded-t-xl border border-[#E5E7EB] bg-white p-4 sm:rounded-xl">
            <h2 className="text-base font-bold text-[#1F2937]">{edit === 'new' ? 'Add table' : `Edit ${edit.label}`}</h2>

            <div className="mt-3 flex flex-col gap-2">
              <label className="flex flex-col text-xs text-[#6B7280]">
                Table number
                <input
                  value={form.code}
                  onChange={(e) => setForm((f) => ({ ...f, code: e.target.value }))}
                  placeholder="T-04"
                  className="mt-0.5 h-10 rounded-md border border-[#E5E7EB] px-2 text-sm text-[#1F2937]"
                />
              </label>
              <label className="flex flex-col text-xs text-[#6B7280]">
                Label (shown on the tent)
                <input
                  value={form.label}
                  onChange={(e) => setForm((f) => ({ ...f, label: e.target.value }))}
                  placeholder="Table 4"
                  className="mt-0.5 h-10 rounded-md border border-[#E5E7EB] px-2 text-sm text-[#1F2937]"
                />
              </label>
              <div className="flex gap-2">
                <label className="flex flex-1 flex-col text-xs text-[#6B7280]">
                  Zone / section
                  <input
                    value={form.zoneId}
                    onChange={(e) => setForm((f) => ({ ...f, zoneId: e.target.value }))}
                    placeholder="Terrace"
                    className="mt-0.5 h-10 rounded-md border border-[#E5E7EB] px-2 text-sm text-[#1F2937]"
                  />
                </label>
                <label className="flex w-24 flex-col text-xs text-[#6B7280]">
                  Capacity
                  <input
                    type="number"
                    min={1}
                    max={99}
                    value={form.seats}
                    onChange={(e) => setForm((f) => ({ ...f, seats: e.target.value }))}
                    className="mt-0.5 h-10 rounded-md border border-[#E5E7EB] px-2 text-sm tabular-nums text-[#1F2937]"
                  />
                </label>
              </div>
              <label className="flex flex-col text-xs text-[#6B7280]">
                Status
                <select
                  value={form.status}
                  onChange={(e) => setForm((f) => ({ ...f, status: e.target.value as FormState['status'] }))}
                  className="mt-0.5 h-10 rounded-md border border-[#E5E7EB] px-2 text-sm text-[#1F2937]"
                >
                  <option value="available">Available</option>
                  <option value="disabled">Disabled</option>
                </select>
              </label>
            </div>

            <div className="mt-4 flex gap-2">
              <button
                type="button"
                onClick={() => setEdit(null)}
                className="flex h-11 flex-1 items-center justify-center rounded-lg border border-[#E5E7EB] text-sm font-semibold text-[#1F2937]"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={saveForm}
                disabled={busy === 'save'}
                className="flex h-11 flex-1 items-center justify-center rounded-lg bg-[#0F5257] text-sm font-semibold text-white disabled:opacity-60"
              >
                {busy === 'save' ? 'Saving…' : edit === 'new' ? 'Add table' : 'Save'}
              </button>
            </div>
          </div>
        </div>
      ) : null}

      {printTables ? (
        <QrPrintSheet
          restaurantName={restaurantName}
          appUrl={appUrl}
          tables={printTables}
          onClose={() => setPrintTables(null)}
        />
      ) : null}
    </div>
  );
}
