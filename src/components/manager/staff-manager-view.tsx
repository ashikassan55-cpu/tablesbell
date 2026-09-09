'use client';

/**
 * src/components/manager/staff-manager-view.tsx
 *
 * Manager Staff Management (DECISIONS.md ADR-10). Lists the branch's
 * roster (`listStaff` — a plain fetch on mount + after each mutation,
 * NOT a live listener, so `pinHash` never reaches the browser) and
 * add / edit / revoke via `upsertStaff`.
 *
 * Auth model this UI reflects (see ADR-10): identifier is a `staffCode`
 * (POS-pad code, not email) + a 4–8 digit PIN; role is SINGLE-select
 * (`manager` already covers cashier/server abilities); `overrideAuth` and
 * creating an `owner` are owner-only; "Revoke" flips `status` away from
 * `active`, which blocks the next login and (best-effort) kills a live
 * session within ~1h.
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import { listStaff, upsertStaff } from '@/server/actions/staff.actions';
import { roleLabel } from '@/lib/console/staff-permissions';
import type { StaffMemberStatus, StaffMemberSummary, StaffRole } from '@/types/firestore';

const ALL_ROLES: StaffRole[] = ['manager', 'cashier', 'server', 'kitchen', 'owner'];
const STATUS_LABEL: Record<StaffMemberStatus, string> = {
  active: 'Active',
  inactive: 'Inactive',
  suspended: 'Suspended',
};

function roleOptionLabel(role: StaffRole): string {
  return role === 'server' ? 'Server / Waiter' : roleLabel(role);
}

function reasonText(reason: string): string {
  switch (reason) {
    case 'DISPLAY_NAME_REQUIRED':
      return 'Enter a name (at least 2 characters).';
    case 'INVALID_STAFF_CODE':
      return 'Staff code must be 1–10 letters/digits.';
    case 'INVALID_PIN':
      return 'PIN must be 4–8 digits.';
    case 'PIN_REQUIRED':
      return 'Set a PIN for the new member.';
    case 'STAFF_CODE_TAKEN':
      return 'That staff code is already in use.';
    case 'BRANCHES_REQUIRED':
      return 'Assign at least one branch.';
    case 'BRANCH_NOT_ASSIGNABLE':
      return "You can only assign branches you manage.";
    case 'OWNER_REQUIRES_OWNER':
      return 'Only an owner can create another owner.';
    case 'OVERRIDE_REQUIRES_OWNER':
      return 'Only an owner can grant override authority.';
    case 'CANNOT_EDIT_OWNER':
      return 'Only an owner can edit an owner account.';
    case 'STAFF_NOT_IN_YOUR_BRANCH':
      return "That member isn't in one of your branches.";
    case 'STAFF_NOT_FOUND':
      return 'That member no longer exists.';
    case 'ROLE_NOT_PERMITTED':
      return 'Only a manager or owner can manage staff.';
    case 'NOT_AUTHENTICATED':
      return 'Your session expired — unlock the terminal again.';
    default:
      return 'Something went wrong. Try again.';
  }
}

interface StaffManagerViewProps {
  branchId: string;
  branchOptions: string[];
  actorRole: StaffRole;
}

interface FormState {
  displayName: string;
  staffCode: string;
  pin: string;
  role: StaffRole;
  branchIds: string[];
  overrideAuth: boolean;
  status: StaffMemberStatus;
}

function blankForm(branchId: string): FormState {
  return {
    displayName: '',
    staffCode: '',
    pin: '',
    role: 'server',
    branchIds: [branchId],
    overrideAuth: false,
    status: 'active',
  };
}
function formFromMember(m: StaffMemberSummary): FormState {
  return {
    displayName: m.displayName === '(unnamed)' ? '' : m.displayName,
    staffCode: m.staffCode,
    pin: '',
    role: m.role,
    branchIds: m.branchIds.length > 0 ? m.branchIds : [],
    overrideAuth: m.overrideAuth,
    status: m.status,
  };
}

export function StaffManagerView({ branchId, branchOptions, actorRole }: StaffManagerViewProps) {
  const [list, setList] = useState<StaffMemberSummary[] | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [edit, setEdit] = useState<'new' | StaffMemberSummary | null>(null);
  const [form, setForm] = useState<FormState>(() => blankForm(branchId));
  const [busy, setBusy] = useState<null | 'save' | 'row'>(null);
  const [busyUid, setBusyUid] = useState<string | null>(null);
  const [feedback, setFeedback] = useState<{ tone: 'ok' | 'error'; text: string } | null>(null);
  const mountedRef = useRef(true);
  useEffect(() => () => { mountedRef.current = false; }, []);

  const isOwner = actorRole === 'owner';

  const refresh = useCallback(async () => {
    const result = await listStaff({ branchId });
    if (!mountedRef.current) return;
    if (result.outcome === 'ok') {
      setList(result.members);
      setLoadError(null);
    } else {
      setLoadError(reasonText(result.reason));
    }
  }, [branchId]);

  useEffect(() => {
    setList(null);
    setLoadError(null);
    void refresh();
  }, [refresh]);

  function openCreate() {
    setForm(blankForm(branchId));
    setEdit('new');
    setFeedback(null);
  }
  function openEdit(m: StaffMemberSummary) {
    setForm(formFromMember(m));
    setEdit(m);
    setFeedback(null);
  }

  function toggleBranch(b: string) {
    setForm((f) => ({
      ...f,
      branchIds: f.branchIds.includes(b) ? f.branchIds.filter((x) => x !== b) : [...f.branchIds, b],
    }));
  }

  async function saveForm() {
    if (busy) return;
    setBusy('save');
    setFeedback(null);
    const result = await upsertStaff({
      branchId,
      uid: edit && edit !== 'new' ? edit.uid : undefined,
      displayName: form.displayName,
      staffCode: form.staffCode,
      role: form.role,
      branchIds: form.branchIds,
      overrideAuth: form.overrideAuth,
      status: form.status,
      pin: form.pin.trim() ? form.pin.trim() : undefined,
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
      text:
        result.outcome === 'created'
          ? 'Staff member added.'
          : result.reloginRequired
            ? 'Saved — they must sign out and back in for it to take effect.'
            : 'Saved.',
    });
    void refresh();
  }

  async function quickToggleStatus(m: StaffMemberSummary) {
    if (busy) return;
    setBusy('row');
    setBusyUid(m.uid);
    setFeedback(null);
    const nextStatus: StaffMemberStatus = m.status === 'active' ? 'suspended' : 'active';
    const result = await upsertStaff({
      branchId,
      uid: m.uid,
      displayName: m.displayName === '(unnamed)' ? 'Staff' : m.displayName,
      staffCode: m.staffCode,
      role: m.role,
      branchIds: m.branchIds,
      overrideAuth: m.overrideAuth,
      status: nextStatus,
    });
    if (!mountedRef.current) return;
    setBusy(null);
    setBusyUid(null);
    if (result.outcome === 'rejected') {
      setFeedback({ tone: 'error', text: reasonText(result.reason) });
      return;
    }
    setFeedback({
      tone: 'ok',
      text: nextStatus === 'active' ? `${m.displayName} reactivated.` : `${m.displayName}'s access revoked.`,
    });
    void refresh();
  }

  const roleOptions = ALL_ROLES.filter((r) => r !== 'owner' || isOwner);

  return (
    <div className="pb-24">
      <div className="mb-3 flex flex-wrap items-center gap-2">
        <p className="text-sm text-[#6B7280]">
          {list ? `${list.length} member${list.length === 1 ? '' : 's'} in this branch` : 'Loading roster…'}
        </p>
        <button
          type="button"
          onClick={openCreate}
          className="ms-auto h-10 rounded-lg bg-[#0F5257] px-4 text-sm font-semibold text-white"
        >
          + Add staff
        </button>
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

      {loadError ? (
        <p className="rounded-lg border border-[#E5484D]/30 bg-[#FDECEC] px-3 py-2 text-sm text-[#7A1E22]">
          Couldn&apos;t load the roster: {loadError}
        </p>
      ) : list === null ? (
        <p className="text-sm text-[#6B7280]">Loading…</p>
      ) : list.length === 0 ? (
        <p className="rounded-lg border border-dashed border-[#E5E7EB] bg-white p-6 text-center text-sm text-[#6B7280]">
          No staff in this branch yet. Add your first team member.
        </p>
      ) : (
        <ul className="flex flex-col gap-2">
          {list.map((m) => (
            <li
              key={m.uid}
              className="flex flex-wrap items-center gap-x-3 gap-y-1 rounded-lg border border-[#E5E7EB] bg-white p-3"
            >
              <div className="min-w-0 flex-1">
                <p className="text-sm font-semibold text-[#1F2937]">
                  {m.displayName}
                  <span className="ms-1.5 font-normal text-[#6B7280]">· code {m.staffCode || '—'}</span>
                </p>
                <p className="text-xs text-[#6B7280]">
                  {roleOptionLabel(m.role)}
                  {m.overrideAuth ? ' · override ✓' : ''}
                  {m.branchIds.length > 1 ? ` · ${m.branchIds.length} branches` : ''}
                  {m.lockedUntil && m.lockedUntil > Date.now() ? ' · PIN locked' : ''}
                </p>
              </div>

              <span
                className={`rounded-full px-2 py-0.5 text-[10px] font-semibold uppercase ${
                  m.status === 'active' ? 'bg-[#ECFDF5] text-[#065F46]' : 'bg-[#FDECEC] text-[#7A1E22]'
                }`}
              >
                {STATUS_LABEL[m.status]}
              </span>

              {!isOwner && m.role === 'owner' ? (
                <span className="text-xs text-[#9CA3AF]">Owner — edit as an owner</span>
              ) : (
                <div className="flex gap-1.5">
                  <button
                    type="button"
                    onClick={() => openEdit(m)}
                    className="h-9 rounded-md border border-[#E5E7EB] px-2.5 text-xs font-semibold text-[#1F2937]"
                  >
                    Edit
                  </button>
                  <button
                    type="button"
                    onClick={() => quickToggleStatus(m)}
                    disabled={busy === 'row' && busyUid === m.uid}
                    className={`h-9 rounded-md border px-2.5 text-xs font-semibold disabled:opacity-50 ${
                      m.status === 'active'
                        ? 'border-[#E5484D]/50 text-[#E5484D]'
                        : 'border-[#0F5257]/50 text-[#0F5257]'
                    }`}
                  >
                    {busy === 'row' && busyUid === m.uid
                      ? '…'
                      : m.status === 'active'
                        ? 'Revoke'
                        : 'Reactivate'}
                  </button>
                </div>
              )}
            </li>
          ))}
        </ul>
      )}

      {edit ? (
        <div role="dialog" aria-modal="true" className="fixed inset-0 z-40 flex items-end justify-center bg-black/40 sm:items-center sm:p-4">
          <div className="max-h-[92dvh] w-full max-w-sm overflow-y-auto rounded-t-xl border border-[#E5E7EB] bg-white p-4 sm:rounded-xl">
            <h2 className="text-base font-bold text-[#1F2937]">
              {edit === 'new' ? 'Add staff member' : `Edit ${edit.displayName}`}
            </h2>

            <div className="mt-3 flex flex-col gap-2">
              <label className="flex flex-col text-xs text-[#6B7280]">
                Name
                <input
                  value={form.displayName}
                  onChange={(e) => setForm((f) => ({ ...f, displayName: e.target.value }))}
                  className="mt-0.5 h-10 rounded-md border border-[#E5E7EB] px-2 text-sm text-[#1F2937]"
                />
              </label>

              <div className="flex gap-2">
                <label className="flex flex-1 flex-col text-xs text-[#6B7280]">
                  Staff code (typed at lock screen)
                  <input
                    value={form.staffCode}
                    onChange={(e) => setForm((f) => ({ ...f, staffCode: e.target.value }))}
                    placeholder="11"
                    maxLength={10}
                    className="mt-0.5 h-10 rounded-md border border-[#E5E7EB] px-2 text-sm text-[#1F2937]"
                  />
                </label>
                <label className="flex flex-1 flex-col text-xs text-[#6B7280]">
                  PIN {edit === 'new' ? '(4–8 digits)' : '(blank = keep)'}
                  <input
                    value={form.pin}
                    onChange={(e) => setForm((f) => ({ ...f, pin: e.target.value }))}
                    inputMode="numeric"
                    autoComplete="off"
                    maxLength={8}
                    placeholder={edit === 'new' ? '4917' : '••••'}
                    className="mt-0.5 h-10 rounded-md border border-[#E5E7EB] px-2 text-sm tabular-nums text-[#1F2937]"
                  />
                </label>
              </div>

              <label className="flex flex-col text-xs text-[#6B7280]">
                Role
                <select
                  value={form.role}
                  onChange={(e) => setForm((f) => ({ ...f, role: e.target.value as StaffRole }))}
                  className="mt-0.5 h-10 rounded-md border border-[#E5E7EB] px-2 text-sm text-[#1F2937]"
                >
                  {roleOptions.map((r) => (
                    <option key={r} value={r}>
                      {roleOptionLabel(r)}
                    </option>
                  ))}
                </select>
                <span className="mt-0.5 text-[10px] text-[#9CA3AF]">
                  One role per member — Manager already covers cashier &amp; server tasks.
                </span>
              </label>

              {branchOptions.length > 1 ? (
                <fieldset className="flex flex-col text-xs text-[#6B7280]">
                  <legend className="mb-1">Branches</legend>
                  <div className="flex flex-wrap gap-1.5">
                    {branchOptions.map((b) => {
                      const on = form.branchIds.includes(b);
                      return (
                        <button
                          type="button"
                          key={b}
                          onClick={() => toggleBranch(b)}
                          aria-pressed={on}
                          className={`h-8 rounded-md border px-2 text-xs font-medium ${
                            on ? 'border-[#0F5257] bg-[#0F5257] text-white' : 'border-[#E5E7EB] text-[#1F2937]'
                          }`}
                        >
                          {b}
                        </button>
                      );
                    })}
                  </div>
                </fieldset>
              ) : null}

              <label className="flex flex-col text-xs text-[#6B7280]">
                Status
                <select
                  value={form.status}
                  onChange={(e) => setForm((f) => ({ ...f, status: e.target.value as StaffMemberStatus }))}
                  className="mt-0.5 h-10 rounded-md border border-[#E5E7EB] px-2 text-sm text-[#1F2937]"
                >
                  <option value="active">Active</option>
                  <option value="inactive">Inactive (on leave)</option>
                  <option value="suspended">Suspended (access revoked)</option>
                </select>
              </label>

              <label
                className={`flex items-center gap-2 text-xs ${isOwner ? 'text-[#1F2937]' : 'text-[#9CA3AF]'}`}
              >
                <input
                  type="checkbox"
                  checked={form.overrideAuth}
                  disabled={!isOwner}
                  onChange={(e) => setForm((f) => ({ ...f, overrideAuth: e.target.checked }))}
                />
                Override authority (void / discount / refund / ghost-ban)
                {!isOwner ? <span className="text-[10px]">— owner only</span> : null}
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
                {busy === 'save' ? 'Saving…' : edit === 'new' ? 'Add member' : 'Save'}
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}
