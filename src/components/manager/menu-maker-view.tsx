'use client';

/**
 * src/components/manager/menu-maker-view.tsx
 *
 * The Manager Menu Maker editor (DECISIONS.md ADR-8) — the first
 * `components/manager/` surface. A deliberately plain skeleton: it reads
 * the live draft (`useMenuDraft`), holds a local working copy, and calls
 * the three real `menu.actions.ts` server actions:
 *
 *   - `seedMenuDraft`  — when no draft doc exists yet (from the live menu,
 *                        or blank if nothing is published).
 *   - `saveMenuDraft`  — persist the working tree (owner/manager only,
 *                        re-validated server-side).
 *   - `publishMenu`    — cut `menuPublished/v{n+1}` from the saved draft
 *                        and move the branch's `menuVersion` pointer, so
 *                        the guest + waiter menus pick it up on their next
 *                        load.
 *
 * Categories now carry a real `name` — the raw-category-id gap the guest
 * and staff menu hooks flagged is closed here.
 *
 * NOT in this skeleton: modifier-group editing (existing groups are shown
 * as a count and carried through untouched), drag reordering (use the
 * sort field), images, and multi-editor conflict handling (last save
 * wins).
 */

import { useEffect, useMemo, useRef, useState } from 'react';
import { useMenuDraft } from '@/hooks/use-menu-draft';
import { seedMenuDraft, saveMenuDraft, publishMenu } from '@/server/actions/menu.actions';
import type { LocalizedText, MenuItem, MenuItemStatus, MenuTreeCategory } from '@/types/firestore';

function filsToAed(fils: number): string {
  return (fils / 100).toFixed(2);
}
function aedToFils(input: string): number {
  const n = Number.parseFloat(input);
  return Number.isFinite(n) && n > 0 ? Math.round(n * 100) : 0;
}
function genId(prefix: string): string {
  const rand =
    typeof crypto !== 'undefined' && 'randomUUID' in crypto
      ? crypto.randomUUID().replace(/-/g, '')
      : Math.random().toString(36).slice(2);
  return `${prefix}_${rand.slice(0, 12)}`;
}

const STATUS_LABEL: Record<MenuItemStatus, string> = {
  active: 'Active',
  draft: 'Hidden (draft)',
  archived: 'Archived',
};

function reasonText(reason: string): string {
  if (reason.startsWith('INVALID_MENU:')) return `The menu didn't pass validation (${reason.slice(13)}).`;
  switch (reason) {
    case 'EMPTY_MENU':
      return 'Add at least one category with one item before publishing.';
    case 'NO_DRAFT':
      return 'There is no saved draft to publish yet.';
    case 'ROLE_NOT_PERMITTED':
      return 'Only a manager or owner can do that.';
    case 'NOT_AUTHENTICATED':
      return 'Your session expired — unlock the terminal again.';
    case 'BRANCH_NOT_AUTHORIZED':
      return 'You are not assigned to this branch.';
    default:
      return 'Something went wrong. Try again.';
  }
}

interface MenuMakerViewProps {
  tenantId: string;
  branchId: string;
  liveVersion: number;
}

export function MenuMakerView({ tenantId, branchId, liveVersion }: MenuMakerViewProps) {
  const draftState = useMenuDraft(tenantId, branchId);
  const [local, setLocal] = useState<MenuTreeCategory[]>([]);
  const [dirty, setDirty] = useState(false);
  const [busy, setBusy] = useState<null | 'seed' | 'save' | 'publish'>(null);
  const [feedback, setFeedback] = useState<{ tone: 'ok' | 'error'; text: string } | null>(null);
  const [editing, setEditing] = useState<{ categoryId: string; item: MenuItem | null } | null>(null);
  const mountedRef = useRef(true);
  useEffect(() => () => { mountedRef.current = false; }, []);

  const syncedStamp = useRef<number>(-1);
  useEffect(() => {
    if (draftState.status !== 'ready') return;
    // Adopt server state whenever it advances and we have no unsaved local
    // edits. A save bumps `updatedAt`, so this also re-baselines after our
    // own successful save.
    if (!dirty && draftState.draft.updatedAt !== syncedStamp.current) {
      setLocal(structuredCloneSafe(draftState.draft.categories));
      syncedStamp.current = draftState.draft.updatedAt;
    }
  }, [draftState, dirty]);

  const lastPublishedVersion =
    draftState.status === 'ready' ? draftState.draft.lastPublishedVersion : 0;
  const nextVersion = Math.max(liveVersion, lastPublishedVersion) + 1;
  const totalItems = useMemo(() => local.reduce((n, c) => n + c.items.length, 0), [local]);

  function mutate(next: MenuTreeCategory[]) {
    setLocal(next);
    setDirty(true);
    setFeedback(null);
  }

  function addCategory() {
    const maxSort = local.reduce((m, c) => Math.max(m, c.sortIndex), -1);
    mutate([
      ...local,
      { id: genId('cat'), name: { en: 'New category', ar: '' }, sortIndex: maxSort + 1, items: [] },
    ]);
  }
  function renameCategory(id: string, field: keyof LocalizedText, value: string) {
    mutate(local.map((c) => (c.id === id ? { ...c, name: { ...c.name, [field]: value } } : c)));
  }
  function setCategorySort(id: string, value: number) {
    mutate(local.map((c) => (c.id === id ? { ...c, sortIndex: Number.isFinite(value) ? value : 0 } : c)));
  }
  function removeCategory(id: string) {
    mutate(local.filter((c) => c.id !== id));
  }
  function removeItem(categoryId: string, itemId: string) {
    mutate(
      local.map((c) =>
        c.id === categoryId ? { ...c, items: c.items.filter((it) => it.id !== itemId) } : c,
      ),
    );
  }
  function upsertItem(categoryId: string, item: MenuItem) {
    const stamped: MenuItem = { ...item, categoryId };
    mutate(
      local.map((c) => {
        if (c.id !== categoryId) return c;
        const exists = c.items.some((it) => it.id === stamped.id);
        const items = exists
          ? c.items.map((it) => (it.id === stamped.id ? stamped : it))
          : [...c.items, stamped];
        return { ...c, items };
      }),
    );
    setEditing(null);
  }

  async function run(kind: 'seed' | 'save' | 'publish') {
    if (busy) return;
    setBusy(kind);
    setFeedback(null);
    try {
      if (kind === 'seed') {
        const r = await seedMenuDraft({ branchId });
        if (!mountedRef.current) return;
        if (r.outcome === 'rejected') setFeedback({ tone: 'error', text: reasonText(r.reason) });
        else if (r.outcome === 'exists') setFeedback({ tone: 'ok', text: 'Draft already exists — loaded it.' });
        else setFeedback({ tone: 'ok', text: `Draft created from v${r.fromVersion || 'blank'}.` });
      } else if (kind === 'save') {
        const r = await saveMenuDraft({ branchId, categories: local });
        if (!mountedRef.current) return;
        if (r.outcome === 'rejected') {
          setFeedback({ tone: 'error', text: reasonText(r.reason) });
        } else {
          setDirty(false);
          setFeedback({ tone: 'ok', text: `Draft saved — ${r.categoryCount} categories, ${r.itemCount} items.` });
        }
      } else {
        const r = await publishMenu({ branchId });
        if (!mountedRef.current) return;
        if (r.outcome === 'rejected') {
          setFeedback({ tone: 'error', text: reasonText(r.reason) });
        } else {
          setFeedback({
            tone: 'ok',
            text: `Published v${r.version} — live now for guests and waiters on their next load.`,
          });
        }
      }
    } finally {
      if (mountedRef.current) setBusy((b) => (b === kind ? null : b));
    }
  }

  if (draftState.status === 'loading') {
    return <p className="text-sm text-[#6B7280]">Loading the menu draft…</p>;
  }
  if (draftState.status === 'error') {
    return (
      <p className="rounded-lg border border-[#E5484D]/30 bg-[#FDECEC] px-3 py-2 text-sm text-[#7A1E22]">
        Couldn&apos;t load the draft: {draftState.error}
      </p>
    );
  }
  if (draftState.status === 'missing') {
    return (
      <div className="mx-auto max-w-md rounded-lg border border-[#E5E7EB] bg-white p-6 text-center">
        <p className="text-sm font-semibold text-[#1F2937]">No working draft yet</p>
        <p className="mt-1 text-sm text-[#6B7280]">
          Start one from the current live menu{liveVersion ? ` (v${liveVersion})` : ''}. Nothing changes
          for guests until you publish.
        </p>
        {feedback ? (
          <p
            className={`mt-3 text-xs ${feedback.tone === 'ok' ? 'text-[#065F46]' : 'text-[#7A1E22]'}`}
          >
            {feedback.text}
          </p>
        ) : null}
        <button
          type="button"
          onClick={() => run('seed')}
          disabled={busy !== null}
          className="mt-4 flex h-11 w-full items-center justify-center rounded-lg bg-[#0F5257] text-sm font-semibold text-white disabled:opacity-60"
        >
          {busy === 'seed' ? 'Creating…' : 'Create draft'}
        </button>
      </div>
    );
  }

  return (
    <div className="pb-28">
      <div className="mb-3 flex flex-wrap items-center gap-x-4 gap-y-1 rounded-lg border border-[#E5E7EB] bg-white px-3 py-2 text-xs text-[#6B7280]">
        <span>
          Live menu: <span className="font-semibold text-[#1F2937]">v{liveVersion}</span>
        </span>
        <span>
          Draft last published:{' '}
          <span className="font-semibold text-[#1F2937]">
            {lastPublishedVersion ? `v${lastPublishedVersion}` : '—'}
          </span>
        </span>
        <span>
          {local.length} categories · {totalItems} items
        </span>
        <span
          className={`ms-auto rounded-full px-2 py-0.5 font-semibold ${
            dirty ? 'bg-[#FFFBEB] text-[#92400E]' : 'bg-[#ECFDF5] text-[#065F46]'
          }`}
        >
          {dirty ? 'Unsaved changes' : 'Draft saved'}
        </span>
      </div>

      <ul className="flex flex-col gap-3">
        {local.map((category) => (
          <li key={category.id} className="rounded-lg border border-[#E5E7EB] bg-white p-3">
            <div className="flex flex-wrap items-end gap-2">
              <label className="flex flex-col text-xs text-[#6B7280]">
                Category name (EN)
                <input
                  value={category.name.en}
                  onChange={(e) => renameCategory(category.id, 'en', e.target.value)}
                  className="mt-0.5 h-9 w-48 rounded-md border border-[#E5E7EB] px-2 text-sm text-[#1F2937]"
                />
              </label>
              <label className="flex flex-col text-xs text-[#6B7280]">
                الاسم (AR)
                <input
                  value={category.name.ar}
                  onChange={(e) => renameCategory(category.id, 'ar', e.target.value)}
                  dir="rtl"
                  className="mt-0.5 h-9 w-40 rounded-md border border-[#E5E7EB] px-2 text-sm text-[#1F2937]"
                />
              </label>
              <label className="flex flex-col text-xs text-[#6B7280]">
                Sort
                <input
                  type="number"
                  value={category.sortIndex}
                  onChange={(e) => setCategorySort(category.id, Number.parseInt(e.target.value, 10))}
                  className="mt-0.5 h-9 w-16 rounded-md border border-[#E5E7EB] px-2 text-sm text-[#1F2937]"
                />
              </label>
              <button
                type="button"
                onClick={() => {
                  if (category.items.length === 0 || confirm(`Remove "${category.name.en}" and its ${category.items.length} item(s)?`)) {
                    removeCategory(category.id);
                  }
                }}
                className="ms-auto h-9 rounded-md border border-[#E5484D]/50 px-2.5 text-xs font-semibold text-[#E5484D]"
              >
                Remove category
              </button>
            </div>

            <ul className="mt-2 flex flex-col divide-y divide-[#F3F4F6] border-t border-[#F3F4F6]">
              {category.items.map((item) => (
                <li key={item.id} className="flex items-center gap-2 py-2 text-sm">
                  <span className="min-w-0 flex-1 truncate text-[#1F2937]">{item.name.en}</span>
                  <span className="tabular-nums text-[#6B7280]">AED {filsToAed(item.priceFils)}</span>
                  {item.status !== 'active' ? (
                    <span className="rounded-full bg-[#F3F4F6] px-1.5 py-0.5 text-[10px] font-semibold uppercase text-[#6B7280]">
                      {item.status}
                    </span>
                  ) : null}
                  {item.modifierGroups.length > 0 ? (
                    <span className="text-[10px] text-[#9CA3AF]">
                      {item.modifierGroups.length} mod group{item.modifierGroups.length === 1 ? '' : 's'}
                    </span>
                  ) : null}
                  <button
                    type="button"
                    onClick={() => setEditing({ categoryId: category.id, item })}
                    className="rounded-md border border-[#E5E7EB] px-2 py-1 text-xs font-semibold text-[#1F2937]"
                  >
                    Edit
                  </button>
                  <button
                    type="button"
                    onClick={() => removeItem(category.id, item.id)}
                    className="rounded-md px-1.5 py-1 text-xs font-semibold text-[#E5484D]"
                    aria-label={`Remove ${item.name.en}`}
                  >
                    ✕
                  </button>
                </li>
              ))}
              {category.items.length === 0 ? (
                <li className="py-2 text-xs text-[#9CA3AF]">No items yet.</li>
              ) : null}
            </ul>

            <button
              type="button"
              onClick={() => setEditing({ categoryId: category.id, item: null })}
              className="mt-2 h-9 rounded-md border border-[#0F5257]/40 px-3 text-xs font-semibold text-[#0F5257]"
            >
              + Add item
            </button>
          </li>
        ))}
      </ul>

      <button
        type="button"
        onClick={addCategory}
        className="mt-3 h-10 rounded-lg border border-dashed border-[#0F5257]/50 px-4 text-sm font-semibold text-[#0F5257]"
      >
        + Add category
      </button>

      <div className="fixed inset-x-0 bottom-0 z-30 border-t border-[#E5E7EB] bg-white px-4 py-3">
        <div className="mx-auto flex max-w-3xl flex-col gap-2">
          {feedback ? (
            <p className={`text-xs ${feedback.tone === 'ok' ? 'text-[#065F46]' : 'text-[#7A1E22]'}`}>
              {feedback.text}
            </p>
          ) : dirty ? (
            <p className="text-xs text-[#92400E]">Save the draft before you can publish.</p>
          ) : null}
          <div className="flex gap-2">
            <button
              type="button"
              onClick={() => run('save')}
              disabled={busy !== null || !dirty}
              className="flex h-11 flex-1 items-center justify-center rounded-lg border border-[#0F5257] text-sm font-semibold text-[#0F5257] disabled:opacity-50"
            >
              {busy === 'save' ? 'Saving…' : 'Save draft'}
            </button>
            <button
              type="button"
              onClick={() => run('publish')}
              disabled={busy !== null || dirty || local.length === 0 || totalItems === 0}
              className="flex h-11 flex-1 items-center justify-center rounded-lg bg-[#0F5257] text-sm font-semibold text-white disabled:opacity-50"
            >
              {busy === 'publish' ? 'Publishing…' : `Publish v${nextVersion}`}
            </button>
          </div>
        </div>
      </div>

      {editing ? (
        <ItemEditor
          initial={editing.item}
          onCancel={() => setEditing(null)}
          onSave={(item) => upsertItem(editing.categoryId, item)}
        />
      ) : null}
    </div>
  );
}

function ItemEditor({
  initial,
  onCancel,
  onSave,
}: {
  initial: MenuItem | null;
  onCancel: () => void;
  onSave: (item: MenuItem) => void;
}) {
  const [en, setEn] = useState(initial?.name.en ?? '');
  const [ar, setAr] = useState(initial?.name.ar ?? '');
  const [priceAed, setPriceAed] = useState(initial ? filsToAed(initial.priceFils) : '');
  const [sku, setSku] = useState(initial?.sku ?? '');
  const [station, setStation] = useState(initial?.stationId ?? 'kitchen');
  const [status, setStatus] = useState<MenuItemStatus>(initial?.status ?? 'active');
  const [err, setErr] = useState<string | null>(null);

  function submit() {
    if (en.trim().length === 0) {
      setErr('An English name is required.');
      return;
    }
    const priceFils = aedToFils(priceAed);
    onSave({
      id: initial?.id ?? genId('itm'),
      categoryId: initial?.categoryId ?? '', // set by upsertItem's parent category
      sku: sku.trim(),
      name: { en: en.trim(), ar: ar.trim() },
      priceFils,
      stationId: station.trim() || 'kitchen',
      status,
      modifierGroups: initial?.modifierGroups ?? [],
    });
  }

  return (
    <div role="dialog" aria-modal="true" className="fixed inset-0 z-40 flex items-end justify-center bg-black/40 sm:items-center sm:p-4">
      <div className="w-full max-w-sm rounded-t-xl border border-[#E5E7EB] bg-white p-4 sm:rounded-xl">
        <h2 className="text-base font-bold text-[#1F2937]">{initial ? 'Edit item' : 'New item'}</h2>

        <div className="mt-3 flex flex-col gap-2">
          <label className="flex flex-col text-xs text-[#6B7280]">
            Name (EN)
            <input value={en} onChange={(e) => setEn(e.target.value)} className="mt-0.5 h-10 rounded-md border border-[#E5E7EB] px-2 text-sm text-[#1F2937]" />
          </label>
          <label className="flex flex-col text-xs text-[#6B7280]">
            الاسم (AR)
            <input value={ar} onChange={(e) => setAr(e.target.value)} dir="rtl" className="mt-0.5 h-10 rounded-md border border-[#E5E7EB] px-2 text-sm text-[#1F2937]" />
          </label>
          <div className="flex gap-2">
            <label className="flex flex-1 flex-col text-xs text-[#6B7280]">
              Price (AED)
              <input
                inputMode="decimal"
                value={priceAed}
                onChange={(e) => setPriceAed(e.target.value)}
                placeholder="0.00"
                className="mt-0.5 h-10 rounded-md border border-[#E5E7EB] px-2 text-sm tabular-nums text-[#1F2937]"
              />
            </label>
            <label className="flex flex-1 flex-col text-xs text-[#6B7280]">
              Station
              <input value={station} onChange={(e) => setStation(e.target.value)} className="mt-0.5 h-10 rounded-md border border-[#E5E7EB] px-2 text-sm text-[#1F2937]" />
            </label>
          </div>
          <div className="flex gap-2">
            <label className="flex flex-1 flex-col text-xs text-[#6B7280]">
              SKU
              <input value={sku} onChange={(e) => setSku(e.target.value)} className="mt-0.5 h-10 rounded-md border border-[#E5E7EB] px-2 text-sm text-[#1F2937]" />
            </label>
            <label className="flex flex-1 flex-col text-xs text-[#6B7280]">
              Visibility
              <select
                value={status}
                onChange={(e) => setStatus(e.target.value as MenuItemStatus)}
                className="mt-0.5 h-10 rounded-md border border-[#E5E7EB] px-2 text-sm text-[#1F2937]"
              >
                {(Object.keys(STATUS_LABEL) as MenuItemStatus[]).map((s) => (
                  <option key={s} value={s}>
                    {STATUS_LABEL[s]}
                  </option>
                ))}
              </select>
            </label>
          </div>
          {initial && initial.modifierGroups.length > 0 ? (
            <p className="rounded-md bg-[#F3F4F6] px-2 py-1.5 text-xs text-[#6B7280]">
              {initial.modifierGroups.length} modifier group{initial.modifierGroups.length === 1 ? '' : 's'} kept as-is —
              modifier editing isn&apos;t in this screen yet.
            </p>
          ) : null}
          {err ? <p className="text-xs text-[#7A1E22]">{err}</p> : null}
        </div>

        <div className="mt-4 flex gap-2">
          <button type="button" onClick={onCancel} className="flex h-11 flex-1 items-center justify-center rounded-lg border border-[#E5E7EB] text-sm font-semibold text-[#1F2937]">
            Cancel
          </button>
          <button type="button" onClick={submit} className="flex h-11 flex-1 items-center justify-center rounded-lg bg-[#0F5257] text-sm font-semibold text-white">
            {initial ? 'Save item' : 'Add item'}
          </button>
        </div>
      </div>
    </div>
  );
}

function structuredCloneSafe<T>(value: T): T {
  if (typeof structuredClone === 'function') return structuredClone(value);
  return JSON.parse(JSON.stringify(value)) as T;
}
