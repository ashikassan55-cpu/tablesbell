'use client';

/**
 * src/components/manager/menu-maker-view.tsx
 *
 * The Manager Menu Maker (DECISIONS.md ADR-8), UI rebuilt to the Stitch
 * "Menu Catalog & Inventory Control" design: a single item table with a
 * search box, three summary cards, an inline live/off-menu toggle per
 * row, and a collapsible category editor — over the same three real
 * `menu.actions.ts` server actions (`seedMenuDraft` / `saveMenuDraft` /
 * `publishMenu`).
 *
 * The row toggle flips an item's `status` between `active` (on the menu)
 * and `archived` (off it) in the working draft — the closest thing this
 * editor owns to the design's "86 toggle" (true runtime 86'ing lives on
 * the KDS Stock Board). "Today's velocity" is real per-item units sold,
 * passed from the server page.
 *
 * NOT here: item photos, allergen tags (no schema field — the SKU / mod
 * count fill that chip row instead), modifier-group editing (carried
 * through untouched), and the design's "Combo Upsell Pairings" panel
 * (no upsell feature exists).
 */

import { useEffect, useMemo, useRef, useState } from 'react';
import { Search, Plus, Pencil, Trash2, SlidersHorizontal, X } from 'lucide-react';
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
  active: 'On the menu',
  draft: 'Hidden (draft)',
  archived: 'Off the menu',
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

type Velocity = Record<string, { qty: number; revenueFils: number }>;

interface MenuMakerViewProps {
  tenantId: string;
  branchId: string;
  liveVersion: number;
  velocity?: Velocity;
}

export function MenuMakerView({ tenantId, branchId, liveVersion, velocity = {} }: MenuMakerViewProps) {
  const draftState = useMenuDraft(tenantId, branchId);
  const [local, setLocal] = useState<MenuTreeCategory[]>([]);
  const [dirty, setDirty] = useState(false);
  const [busy, setBusy] = useState<null | 'seed' | 'save' | 'publish'>(null);
  const [feedback, setFeedback] = useState<{ tone: 'ok' | 'error'; text: string } | null>(null);
  const [editing, setEditing] = useState<{ categoryId: string | null; item: MenuItem | null } | null>(null);
  const [query, setQuery] = useState('');
  const [showCats, setShowCats] = useState(false);
  const mountedRef = useRef(true);
  useEffect(() => () => { mountedRef.current = false; }, []);

  const syncedStamp = useRef<number>(-1);
  useEffect(() => {
    if (draftState.status !== 'ready') return;
    if (!dirty && draftState.draft.updatedAt !== syncedStamp.current) {
      setLocal(structuredCloneSafe(draftState.draft.categories));
      syncedStamp.current = draftState.draft.updatedAt;
    }
  }, [draftState, dirty]);

  const lastPublishedVersion = draftState.status === 'ready' ? draftState.draft.lastPublishedVersion : 0;
  const nextVersion = Math.max(liveVersion, lastPublishedVersion) + 1;

  const sortedCats = useMemo(() => [...local].sort((a, b) => a.sortIndex - b.sortIndex), [local]);
  const rows = useMemo(() => {
    const q = query.trim().toLowerCase();
    const out: { cat: MenuTreeCategory; item: MenuItem }[] = [];
    for (const cat of sortedCats) {
      for (const item of cat.items) {
        if (
          q &&
          !item.name.en.toLowerCase().includes(q) &&
          !item.name.ar.toLowerCase().includes(q) &&
          !item.sku.toLowerCase().includes(q)
        ) {
          continue;
        }
        out.push({ cat, item });
      }
    }
    return out;
  }, [sortedCats, query]);

  const totalItems = useMemo(() => local.reduce((n, c) => n + c.items.length, 0), [local]);
  const activeItems = useMemo(
    () => local.reduce((n, c) => n + c.items.filter((it) => it.status === 'active').length, 0),
    [local],
  );

  function mutate(next: MenuTreeCategory[]) {
    setLocal(next);
    setDirty(true);
    setFeedback(null);
  }
  function addCategory() {
    const maxSort = local.reduce((m, c) => Math.max(m, c.sortIndex), -1);
    mutate([...local, { id: genId('cat'), name: { en: 'New category', ar: '' }, sortIndex: maxSort + 1, items: [] }]);
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
    mutate(local.map((c) => (c.id === categoryId ? { ...c, items: c.items.filter((it) => it.id !== itemId) } : c)));
  }
  function toggleItemLive(categoryId: string, itemId: string) {
    mutate(
      local.map((c) =>
        c.id === categoryId
          ? {
              ...c,
              items: c.items.map((it) =>
                it.id === itemId
                  ? { ...it, status: it.status === 'active' ? ('archived' as const) : ('active' as const) }
                  : it,
              ),
            }
          : c,
      ),
    );
  }
  function upsertItem(targetCategoryId: string, item: MenuItem) {
    const stamped: MenuItem = { ...item, categoryId: targetCategoryId };
    mutate(
      local.map((c) => {
        const withoutThis = c.items.filter((it) => it.id !== stamped.id);
        if (c.id !== targetCategoryId) return { ...c, items: withoutThis };
        return { ...c, items: [...withoutThis, stamped] };
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
        if (r.outcome === 'rejected') setFeedback({ tone: 'error', text: reasonText(r.reason) });
        else {
          setDirty(false);
          setFeedback({ tone: 'ok', text: `Draft saved — ${r.categoryCount} categories, ${r.itemCount} items.` });
        }
      } else {
        const r = await publishMenu({ branchId });
        if (!mountedRef.current) return;
        if (r.outcome === 'rejected') setFeedback({ tone: 'error', text: reasonText(r.reason) });
        else setFeedback({ tone: 'ok', text: `Published v${r.version} — live now for guests and waiters on their next load.` });
      }
    } finally {
      if (mountedRef.current) setBusy((b) => (b === kind ? null : b));
    }
  }

  if (draftState.status === 'loading') {
    return <p className="text-sm text-[#6B7280]">Loading the menu catalog…</p>;
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
      <div className="mx-auto max-w-md rounded-lg border border-[#E5E7EB] bg-white p-6 text-center shadow-sm">
        <p className="text-sm font-semibold text-[#1F2937]">No working draft yet</p>
        <p className="mt-1 text-sm text-[#6B7280]">
          Start one from the current live menu{liveVersion ? ` (v${liveVersion})` : ''}. Nothing changes for guests
          until you publish.
        </p>
        {feedback ? (
          <p className={`mt-3 text-xs ${feedback.tone === 'ok' ? 'text-[#065F46]' : 'text-[#7A1E22]'}`}>{feedback.text}</p>
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

  const catOptions = sortedCats.map((c) => ({ id: c.id, label: c.name.en || 'Untitled' }));

  return (
    <div className="flex flex-col gap-4 pb-28">
      {/* Header / action bar */}
      <section className="flex flex-col gap-3 rounded-xl border border-[#E5E7EB] bg-white p-4 shadow-sm lg:flex-row lg:items-center lg:justify-between">
        <div>
          <h1 className="text-xl font-bold tracking-tight text-[#1F2937]">Menu Catalog &amp; Inventory Control</h1>
          <p className="mt-0.5 flex flex-wrap items-center gap-x-3 gap-y-0.5 text-xs text-[#6B7280]">
            <span>
              Live menu <strong className="text-[#1F2937]">v{liveVersion}</strong>
            </span>
            <span>·</span>
            <span>
              Draft last published{' '}
              <strong className="text-[#1F2937]">{lastPublishedVersion ? `v${lastPublishedVersion}` : '—'}</strong>
            </span>
            <span
              className={`rounded-full px-2 py-0.5 font-semibold ${
                dirty ? 'bg-[#FEF3C7] text-[#92400E]' : 'bg-[#D1FAE5] text-[#065F46]'
              }`}
            >
              {dirty ? 'Unsaved changes' : 'Draft saved'}
            </span>
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <div className="flex h-10 items-center gap-2 rounded-lg border border-[#E5E7EB] bg-[#F3F4F6] px-3">
            <Search className="h-4 w-4 text-[#6B7280]" />
            <input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search menu item or SKU…"
              className="w-52 bg-transparent text-sm text-[#1F2937] outline-none placeholder:text-[#9CA3AF]"
            />
          </div>
          <button
            type="button"
            onClick={() => setShowCats((v) => !v)}
            className={`inline-flex h-10 items-center gap-2 rounded-lg border px-3 text-sm font-semibold transition-colors ${
              showCats
                ? 'border-[#0F5257] bg-[#0F5257] text-white'
                : 'border-[#E5E7EB] bg-white text-[#1F2937] hover:bg-[#F3F4F6]'
            }`}
          >
            <SlidersHorizontal className="h-4 w-4" />
            Categories
          </button>
          <button
            type="button"
            onClick={() => setEditing({ categoryId: catOptions[0]?.id ?? null, item: null })}
            className="inline-flex h-10 items-center gap-2 rounded-lg bg-[#003A3E] px-4 text-sm font-bold text-white transition-colors hover:bg-[#0F5257]"
          >
            <Plus className="h-4 w-4" />
            New item
          </button>
        </div>
      </section>

      {/* Summary cards */}
      <section className="grid grid-cols-1 gap-3 sm:grid-cols-3">
        <StatCard label="On the menu" value={String(activeItems)} tone="ok" />
        <StatCard label="Hidden / off menu" value={String(totalItems - activeItems)} />
        <StatCard label="Categories" value={String(local.length)} />
      </section>

      {/* Category editor */}
      {showCats ? (
        <section className="rounded-xl border border-[#E5E7EB] bg-white p-4 shadow-sm">
          <h2 className="text-sm font-bold text-[#1F2937]">Categories</h2>
          <div className="mt-2 flex flex-col gap-2">
            {sortedCats.map((c) => (
              <div key={c.id} className="flex flex-wrap items-end gap-2 rounded-lg bg-[#F3F4F6] p-2">
                <label className="flex flex-col text-[10px] font-bold uppercase tracking-wide text-[#6B7280]">
                  Name (EN)
                  <input
                    value={c.name.en}
                    onChange={(e) => renameCategory(c.id, 'en', e.target.value)}
                    className="mt-0.5 h-9 w-44 rounded-lg border border-[#E5E7EB] bg-white px-2 text-sm text-[#1F2937]"
                  />
                </label>
                <label className="flex flex-col text-[10px] font-bold uppercase tracking-wide text-[#6B7280]">
                  الاسم (AR)
                  <input
                    value={c.name.ar}
                    dir="rtl"
                    onChange={(e) => renameCategory(c.id, 'ar', e.target.value)}
                    className="mt-0.5 h-9 w-36 rounded-lg border border-[#E5E7EB] bg-white px-2 text-sm text-[#1F2937]"
                  />
                </label>
                <label className="flex flex-col text-[10px] font-bold uppercase tracking-wide text-[#6B7280]">
                  Sort
                  <input
                    type="number"
                    value={c.sortIndex}
                    onChange={(e) => setCategorySort(c.id, Number.parseInt(e.target.value, 10))}
                    className="mt-0.5 h-9 w-16 rounded-lg border border-[#E5E7EB] bg-white px-2 text-sm text-[#1F2937]"
                  />
                </label>
                <span className="text-xs text-[#9CA3AF]">{c.items.length} items</span>
                <button
                  type="button"
                  onClick={() => {
                    if (c.items.length === 0 || confirm(`Remove "${c.name.en}" and its ${c.items.length} item(s)?`)) {
                      removeCategory(c.id);
                    }
                  }}
                  className="ms-auto inline-flex h-9 items-center gap-1 rounded-lg border border-[#E5484D]/40 px-2.5 text-xs font-semibold text-[#E5484D]"
                >
                  <Trash2 className="h-3.5 w-3.5" /> Remove
                </button>
              </div>
            ))}
          </div>
          <button
            type="button"
            onClick={addCategory}
            className="mt-2 inline-flex h-9 items-center gap-1.5 rounded-lg border border-dashed border-[#0F5257]/50 px-3 text-xs font-semibold text-[#0F5257]"
          >
            <Plus className="h-3.5 w-3.5" /> Add category
          </button>
        </section>
      ) : null}

      {/* Item table */}
      <section className="overflow-hidden rounded-xl border border-[#E5E7EB] bg-white shadow-sm">
        <div className="overflow-x-auto">
          <table className="w-full min-w-[860px] text-left text-sm">
            <thead>
              <tr className="bg-[#F3F4F6] text-[10px] uppercase tracking-widest text-[#6B7280]">
                <th className="px-4 py-3 font-bold">Item details</th>
                <th className="px-3 py-3 font-bold">Category</th>
                <th className="px-3 py-3 font-bold">Price (AED)</th>
                <th className="px-3 py-3 font-bold">Today&apos;s velocity &amp; station</th>
                <th className="px-3 py-3 font-bold">Live status</th>
                <th className="px-4 py-3 text-right font-bold">Actions</th>
              </tr>
            </thead>
            <tbody>
              {rows.length === 0 ? (
                <tr>
                  <td colSpan={6} className="px-4 py-10 text-center text-sm text-[#6B7280]">
                    {totalItems === 0
                      ? 'No items yet. Use “New item” to add your first dish.'
                      : 'No items match that search.'}
                  </td>
                </tr>
              ) : (
                rows.map(({ cat, item }) => {
                  const live = item.status === 'active';
                  const v = velocity[item.id];
                  return (
                    <tr key={item.id} className="border-t border-[#F3F4F6] hover:bg-[#F3F4F6]/50">
                      <td className="px-4 py-3">
                        <p className={`font-semibold ${live ? 'text-[#1F2937]' : 'text-[#6B7280] line-through opacity-80'}`}>
                          {item.name.en || 'Untitled'}
                        </p>
                        <div className="mt-0.5 flex flex-wrap items-center gap-1">
                          {item.name.ar ? (
                            <span className="text-xs text-[#9CA3AF]" dir="rtl">
                              {item.name.ar}
                            </span>
                          ) : null}
                          {item.sku ? (
                            <span className="rounded bg-[#F3F4F6] px-1.5 py-0.5 text-[10px] font-semibold uppercase text-[#6B7280]">
                              {item.sku}
                            </span>
                          ) : null}
                          {item.modifierGroups.length > 0 ? (
                            <span className="rounded bg-[#F3F4F6] px-1.5 py-0.5 text-[10px] font-semibold uppercase text-[#6B7280]">
                              {item.modifierGroups.length} mod{item.modifierGroups.length === 1 ? '' : 's'}
                            </span>
                          ) : null}
                        </div>
                      </td>
                      <td className="px-3 py-3">
                        <span className="rounded bg-[#DEE9FC] px-2 py-0.5 text-xs font-semibold text-[#0F5257]">
                          {cat.name.en || 'Untitled'}
                        </span>
                      </td>
                      <td className="px-3 py-3 font-semibold tabular-nums text-[#1F2937]">{filsToAed(item.priceFils)}</td>
                      <td className="px-3 py-3">
                        <p className="text-sm text-[#1F2937]">
                          {v ? `${v.qty} sold` : <span className="text-[#9CA3AF]">No sales yet</span>}
                          {v ? <span className="text-[#6B7280]"> · AED {filsToAed(v.revenueFils)}</span> : null}
                        </p>
                        <span className="mt-0.5 inline-block rounded bg-[#F3F4F6] px-1.5 py-0.5 text-[10px] font-semibold uppercase text-[#6B7280]">
                          {item.stationId || 'kitchen'}
                        </span>
                      </td>
                      <td className="px-3 py-3">
                        <div className="flex items-center gap-2">
                          <button
                            type="button"
                            role="switch"
                            aria-checked={live}
                            onClick={() => toggleItemLive(cat.id, item.id)}
                            className={`relative h-6 w-11 shrink-0 rounded-full p-0.5 transition-colors ${
                              live ? 'bg-[#176B4B]' : 'bg-[#BFC8C9]'
                            }`}
                          >
                            <span
                              className={`block h-5 w-5 rounded-full bg-white transition-transform ${
                                live ? 'translate-x-5' : 'translate-x-0'
                              }`}
                            />
                          </button>
                          <span className={`text-xs font-semibold ${live ? 'text-[#176B4B]' : 'text-[#E5484D]'}`}>
                            {live ? 'On menu' : 'Off menu'}
                          </span>
                        </div>
                      </td>
                      <td className="px-4 py-3">
                        <div className="flex items-center justify-end gap-1.5">
                          <button
                            type="button"
                            onClick={() => setEditing({ categoryId: cat.id, item })}
                            className="inline-flex h-8 items-center gap-1 rounded-lg bg-[#0F5257] px-2.5 text-xs font-bold text-white hover:bg-[#093336]"
                          >
                            <Pencil className="h-3.5 w-3.5" /> Edit
                          </button>
                          <button
                            type="button"
                            onClick={() => removeItem(cat.id, item.id)}
                            aria-label={`Remove ${item.name.en}`}
                            className="inline-flex h-8 w-8 items-center justify-center rounded-lg text-[#6B7280] hover:bg-[#FDECEC] hover:text-[#E5484D]"
                          >
                            <Trash2 className="h-4 w-4" />
                          </button>
                        </div>
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>
        {rows.length > 0 ? (
          <p className="border-t border-[#F3F4F6] px-4 py-2 text-xs text-[#9CA3AF]">
            {rows.length} of {totalItems} items shown
          </p>
        ) : null}
      </section>

      {/* Save / publish bar */}
      <div className="fixed inset-x-0 bottom-0 z-30 border-t border-[#E5E7EB] bg-white px-4 py-3 lg:pl-[300px]">
        <div className="mx-auto flex max-w-3xl flex-col gap-2">
          {feedback ? (
            <p className={`text-xs ${feedback.tone === 'ok' ? 'text-[#065F46]' : 'text-[#7A1E22]'}`}>{feedback.text}</p>
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
              className="flex h-11 flex-1 items-center justify-center rounded-lg bg-[#003A3E] text-sm font-bold text-white disabled:opacity-50"
            >
              {busy === 'publish' ? 'Publishing…' : `Publish v${nextVersion}`}
            </button>
          </div>
        </div>
      </div>

      {editing ? (
        <ItemEditor
          initial={editing.item}
          categories={catOptions}
          defaultCategoryId={editing.categoryId ?? catOptions[0]?.id ?? null}
          onCancel={() => setEditing(null)}
          onSave={(categoryId, item) => upsertItem(categoryId, item)}
        />
      ) : null}
    </div>
  );
}

function StatCard({ label, value, tone }: { label: string; value: string; tone?: 'ok' }) {
  return (
    <div className="rounded-xl border border-[#E5E7EB] bg-white p-4 shadow-sm">
      <span className="text-[10px] font-bold uppercase tracking-widest text-[#6B7280]">{label}</span>
      <p className={`mt-1 text-2xl font-bold tabular-nums ${tone === 'ok' ? 'text-[#176B4B]' : 'text-[#1F2937]'}`}>
        {value}
      </p>
    </div>
  );
}

function ItemEditor({
  initial,
  categories,
  defaultCategoryId,
  onCancel,
  onSave,
}: {
  initial: MenuItem | null;
  categories: { id: string; label: string }[];
  defaultCategoryId: string | null;
  onCancel: () => void;
  onSave: (categoryId: string, item: MenuItem) => void;
}) {
  const [categoryId, setCategoryId] = useState(initial?.categoryId || defaultCategoryId || categories[0]?.id || '');
  const [en, setEn] = useState(initial?.name.en ?? '');
  const [ar, setAr] = useState(initial?.name.ar ?? '');
  const [priceAed, setPriceAed] = useState(initial ? filsToAed(initial.priceFils) : '');
  const [sku, setSku] = useState(initial?.sku ?? '');
  const [station, setStation] = useState(initial?.stationId ?? 'kitchen');
  const [status, setStatus] = useState<MenuItemStatus>(initial?.status ?? 'active');
  const [imageUrl, setImageUrl] = useState(initial?.imageUrl ?? '');
  const [descEn, setDescEn] = useState(initial?.description?.en ?? '');
  const [descAr, setDescAr] = useState(initial?.description?.ar ?? '');
  const [err, setErr] = useState<string | null>(null);

  const F = 'mt-0.5 h-10 rounded-lg border border-[#E5E7EB] bg-white px-2 text-sm text-[#1F2937]';
  const L = 'flex flex-col text-[10px] font-bold uppercase tracking-wide text-[#6B7280]';

  function submit() {
    if (en.trim().length === 0) return setErr('An English name is required.');
    if (!categoryId) return setErr('Pick a category.');
    onSave(categoryId, {
      id: initial?.id ?? genId('itm'),
      categoryId,
      sku: sku.trim(),
      name: { en: en.trim(), ar: ar.trim() },
      priceFils: aedToFils(priceAed),
      stationId: station.trim() || 'kitchen',
      status,
      modifierGroups: initial?.modifierGroups ?? [],
      imageUrl: imageUrl.trim(),
      description: { en: descEn.trim(), ar: descAr.trim() },
    });
  }

  return (
    <div role="dialog" aria-modal="true" className="fixed inset-0 z-40 flex items-end justify-center bg-black/40 sm:items-center sm:p-4">
      <div className="w-full max-w-sm rounded-t-xl border border-[#E5E7EB] bg-white p-4 shadow-xl sm:rounded-xl">
        <div className="flex items-center justify-between">
          <h2 className="text-base font-bold text-[#1F2937]">{initial ? 'Edit item' : 'New item'}</h2>
          <button type="button" onClick={onCancel} aria-label="Close" className="rounded-lg p-1 text-[#6B7280] hover:bg-[#F3F4F6]">
            <X className="h-4 w-4" />
          </button>
        </div>

        <div className="mt-3 flex flex-col gap-2">
          <label className={L}>
            Category
            <select value={categoryId} onChange={(e) => setCategoryId(e.target.value)} className={F}>
              {categories.length === 0 ? <option value="">— add a category first —</option> : null}
              {categories.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.label}
                </option>
              ))}
            </select>
          </label>
          <label className={L}>
            Name (EN)
            <input value={en} onChange={(e) => setEn(e.target.value)} className={F} />
          </label>
          <label className={L}>
            الاسم (AR)
            <input value={ar} onChange={(e) => setAr(e.target.value)} dir="rtl" className={F} />
          </label>
          <label className={L}>
            Description (EN)
            <textarea
              value={descEn}
              onChange={(e) => setDescEn(e.target.value.slice(0, 240))}
              rows={2}
              placeholder="Shown under the item name on the guest menu"
              className="mt-0.5 rounded-lg border border-[#E5E7EB] bg-white p-2 text-sm text-[#1F2937]"
            />
          </label>
          <label className={L}>
            الوصف (AR)
            <textarea
              value={descAr}
              onChange={(e) => setDescAr(e.target.value.slice(0, 240))}
              rows={2}
              dir="rtl"
              className="mt-0.5 rounded-lg border border-[#E5E7EB] bg-white p-2 text-sm text-[#1F2937]"
            />
          </label>
          <label className={L}>
            Photo URL
            <input
              value={imageUrl}
              onChange={(e) => setImageUrl(e.target.value.slice(0, 600))}
              placeholder="https://…/dish.jpg"
              className={F}
            />
          </label>
          <div className="flex gap-2">
            <label className={`${L} flex-1`}>
              Price (AED)
              <input inputMode="decimal" value={priceAed} onChange={(e) => setPriceAed(e.target.value)} placeholder="0.00" className={`${F} tabular-nums`} />
            </label>
            <label className={`${L} flex-1`}>
              Station
              <input value={station} onChange={(e) => setStation(e.target.value)} className={F} />
            </label>
          </div>
          <div className="flex gap-2">
            <label className={`${L} flex-1`}>
              SKU
              <input value={sku} onChange={(e) => setSku(e.target.value)} className={F} />
            </label>
            <label className={`${L} flex-1`}>
              Visibility
              <select value={status} onChange={(e) => setStatus(e.target.value as MenuItemStatus)} className={F}>
                {(Object.keys(STATUS_LABEL) as MenuItemStatus[]).map((s) => (
                  <option key={s} value={s}>
                    {STATUS_LABEL[s]}
                  </option>
                ))}
              </select>
            </label>
          </div>
          {initial && initial.modifierGroups.length > 0 ? (
            <p className="rounded-lg bg-[#F3F4F6] px-2 py-1.5 text-xs text-[#6B7280]">
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
          <button type="button" onClick={submit} className="flex h-11 flex-1 items-center justify-center rounded-lg bg-[#003A3E] text-sm font-bold text-white">
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
