'use client';

/**
 * src/components/manager/store-settings-view.tsx
 *
 * Manager Store Settings (DECISIONS.md ADR-11): branch display name,
 * currency, VAT rate (shown as a percent, stored as `vatPpm`), and a
 * receipt footer. Reads live via `useBranchSettings`; writes via
 * `updateBranchSettings`.
 *
 * The form re-seeds from the live doc only while the manager has no
 * unsaved edits — so a background change doesn't clobber what they're
 * typing, and their own save re-baselines cleanly.
 */

import { useEffect, useRef, useState } from 'react';
import { useBranchSettings } from '@/hooks/use-branch-settings';
import { updateBranchSettings } from '@/server/actions/branch-settings.actions';
import { CURRENCIES, formatMoney } from '@/lib/format/money';
import {
  MAX_RECEIPT_FOOTER,
  MAX_WIFI_SSID,
  MAX_WIFI_PASSWORD,
  MAX_IMAGE_URL,
  SUPPORTED_CURRENCIES,
  vatPercentToPpm,
  vatPpmToPercent,
} from '@/lib/branch-settings';
import type { KitchenStatus } from '@/types/firestore';

interface FormState {
  name: string;
  currency: string;
  vatPercent: string;
  receiptFooter: string;
  wifiSsid: string;
  wifiPassword: string;
  heroImageUrl: string;
  kitchenStatus: KitchenStatus;
}

const KITCHEN_STATUS_LABEL: Record<KitchenStatus, string> = {
  live: 'Live & Ready — taking orders',
  busy: 'Busy — longer waits',
  closed: 'Closed — kitchen not accepting orders',
};

function reasonText(reason: string): string {
  switch (reason) {
    case 'NAME_REQUIRED':
      return 'Enter a display name.';
    case 'UNSUPPORTED_CURRENCY':
      return 'Pick a supported currency.';
    case 'INVALID_VAT_RATE':
      return 'Enter a VAT rate between 0 and 30%.';
    case 'ROLE_NOT_PERMITTED':
      return 'Only a manager or owner can change settings.';
    case 'NOT_AUTHENTICATED':
      return 'Your session expired — unlock the terminal again.';
    default:
      return 'Something went wrong. Try again.';
  }
}

export function StoreSettingsView({
  tenantId,
  branchId,
}: {
  tenantId: string;
  branchId: string;
  tenantSlug: string;
}) {
  const live = useBranchSettings(tenantId, branchId);
  const [form, setForm] = useState<FormState | null>(null);
  const [dirty, setDirty] = useState(false);
  const [busy, setBusy] = useState(false);
  const [feedback, setFeedback] = useState<{ tone: 'ok' | 'error'; text: string } | null>(null);
  const mountedRef = useRef(true);
  useEffect(() => () => { mountedRef.current = false; }, []);
  const syncedStamp = useRef<string>('');

  useEffect(() => {
    if (live.status !== 'ready') return;
    const stamp = JSON.stringify([live.name, live.settings]);
    if (!dirty && stamp !== syncedStamp.current) {
      setForm({
        name: live.name,
        currency: live.settings.currency,
        vatPercent: String(vatPpmToPercent(live.settings.vatPpm)),
        receiptFooter: live.settings.receiptFooter,
        wifiSsid: live.settings.wifiSsid,
        wifiPassword: live.settings.wifiPassword,
        heroImageUrl: live.settings.heroImageUrl,
        kitchenStatus: live.settings.kitchenStatus,
      });
      syncedStamp.current = stamp;
    }
  }, [live, dirty]);

  function set<K extends keyof FormState>(key: K, value: FormState[K]) {
    setForm((f) => (f ? { ...f, [key]: value } : f));
    setDirty(true);
    setFeedback(null);
  }

  async function save() {
    if (!form || busy) return;
    setBusy(true);
    setFeedback(null);
    const result = await updateBranchSettings({
      branchId,
      name: form.name,
      currency: form.currency,
      vatPpm: vatPercentToPpm(Number.parseFloat(form.vatPercent)),
      receiptFooter: form.receiptFooter,
      wifiSsid: form.wifiSsid,
      wifiPassword: form.wifiPassword,
      heroImageUrl: form.heroImageUrl,
      kitchenStatus: form.kitchenStatus,
    });
    if (!mountedRef.current) return;
    setBusy(false);
    if (result.outcome === 'rejected') {
      setFeedback({ tone: 'error', text: reasonText(result.reason) });
      return;
    }
    setDirty(false);
    setFeedback({ tone: 'ok', text: 'Saved. New orders will use these settings; existing tickets are unchanged.' });
  }

  if (live.status === 'loading' || !form) {
    return <p className="text-sm text-[#6B7280]">Loading settings…</p>;
  }
  if (live.status === 'error') {
    return (
      <p className="rounded-lg border border-[#E5484D]/30 bg-[#FDECEC] px-3 py-2 text-sm text-[#7A1E22]">
        Couldn&apos;t load settings: {live.error}
      </p>
    );
  }

  const vatNum = Number.parseFloat(form.vatPercent);
  const previewGross = 10_500; // 105.00 in minor units
  const previewPpm = vatPercentToPpm(Number.isFinite(vatNum) ? vatNum : 5);
  const previewNet = Math.round((previewGross * 1_000_000) / (1_000_000 + previewPpm));

  return (
    <div className="mx-auto flex max-w-lg flex-col gap-4 pb-24">
      <section className="rounded-lg border border-[#E5E7EB] bg-white p-4">
        <h2 className="text-sm font-semibold text-[#1F2937]">Restaurant details</h2>
        <label className="mt-3 flex flex-col text-xs text-[#6B7280]">
          Display name
          <input
            value={form.name}
            onChange={(e) => set('name', e.target.value)}
            maxLength={80}
            className="mt-0.5 h-10 rounded-md border border-[#E5E7EB] px-2 text-sm text-[#1F2937]"
          />
        </label>
        <label className="mt-3 flex flex-col text-xs text-[#6B7280]">
          Receipt footer
          <textarea
            value={form.receiptFooter}
            onChange={(e) => set('receiptFooter', e.target.value.slice(0, MAX_RECEIPT_FOOTER))}
            rows={3}
            placeholder={'Thank you for dining with us!\nwww.example.com'}
            className="mt-0.5 rounded-md border border-[#E5E7EB] p-2 text-sm text-[#1F2937]"
          />
          <span className="mt-0.5 text-[10px] text-[#9CA3AF]">
            {MAX_RECEIPT_FOOTER - form.receiptFooter.length} characters left · printed at the bottom of every receipt
          </span>
        </label>
      </section>

      <section className="rounded-lg border border-[#E5E7EB] bg-white p-4">
        <h2 className="text-sm font-semibold text-[#1F2937]">Currency &amp; tax</h2>
        <div className="mt-3 flex gap-2">
          <label className="flex flex-1 flex-col text-xs text-[#6B7280]">
            Currency
            <select
              value={form.currency}
              onChange={(e) => set('currency', e.target.value)}
              className="mt-0.5 h-10 rounded-md border border-[#E5E7EB] px-2 text-sm text-[#1F2937]"
            >
              {SUPPORTED_CURRENCIES.map((c) => (
                <option key={c} value={c}>
                  {c} ({CURRENCIES[c].symbol})
                </option>
              ))}
            </select>
          </label>
          <label className="flex w-28 flex-col text-xs text-[#6B7280]">
            VAT / tax %
            <input
              inputMode="decimal"
              value={form.vatPercent}
              onChange={(e) => set('vatPercent', e.target.value)}
              placeholder="5"
              className="mt-0.5 h-10 rounded-md border border-[#E5E7EB] px-2 text-sm tabular-nums text-[#1F2937]"
            />
          </label>
        </div>
        <p className="mt-2 rounded-md bg-[#F3F4F6] px-2 py-1.5 text-xs text-[#6B7280]">
          Example: a {formatMoney(previewGross, form.currency)} order splits to{' '}
          <span className="font-semibold text-[#1F2937]">{formatMoney(previewNet, form.currency)}</span> net +{' '}
          <span className="font-semibold text-[#1F2937]">{formatMoney(previewGross - previewNet, form.currency)}</span> tax
          (VAT-inclusive pricing).
        </p>
      </section>

      <section className="rounded-lg border border-[#E5E7EB] bg-white p-4">
        <h2 className="text-sm font-semibold text-[#1F2937]">Guest experience</h2>
        <p className="mt-0.5 text-xs text-[#6B7280]">Shown on the QR landing &amp; menu screens guests see when they scan a table.</p>

        <label className="mt-3 flex flex-col text-xs text-[#6B7280]">
          Kitchen status
          <select
            value={form.kitchenStatus}
            onChange={(e) => set('kitchenStatus', e.target.value as KitchenStatus)}
            className="mt-0.5 h-10 rounded-md border border-[#E5E7EB] px-2 text-sm text-[#1F2937]"
          >
            {(Object.keys(KITCHEN_STATUS_LABEL) as KitchenStatus[]).map((k) => (
              <option key={k} value={k}>
                {KITCHEN_STATUS_LABEL[k]}
              </option>
            ))}
          </select>
        </label>

        <div className="mt-3 flex gap-2">
          <label className="flex flex-1 flex-col text-xs text-[#6B7280]">
            Guest Wi-Fi name
            <input
              value={form.wifiSsid}
              onChange={(e) => set('wifiSsid', e.target.value.slice(0, MAX_WIFI_SSID))}
              placeholder="Alserkal_Guest"
              className="mt-0.5 h-10 rounded-md border border-[#E5E7EB] px-2 text-sm text-[#1F2937]"
            />
          </label>
          <label className="flex flex-1 flex-col text-xs text-[#6B7280]">
            Wi-Fi password
            <input
              value={form.wifiPassword}
              onChange={(e) => set('wifiPassword', e.target.value.slice(0, MAX_WIFI_PASSWORD))}
              placeholder="Leave blank for open network"
              className="mt-0.5 h-10 rounded-md border border-[#E5E7EB] px-2 text-sm text-[#1F2937]"
            />
          </label>
        </div>
        <span className="mt-1 block text-[10px] text-[#9CA3AF]">
          Leave the name blank to hide the Wi-Fi tile. The landing shows a “tap to copy” button; the password is never shown in plain text.
        </span>

        <label className="mt-3 flex flex-col text-xs text-[#6B7280]">
          Hero image URL
          <input
            value={form.heroImageUrl}
            onChange={(e) => set('heroImageUrl', e.target.value.slice(0, MAX_IMAGE_URL))}
            placeholder="https://…/cafe-photo.jpg"
            className="mt-0.5 h-10 rounded-md border border-[#E5E7EB] px-2 text-sm text-[#1F2937]"
          />
          <span className="mt-0.5 text-[10px] text-[#9CA3AF]">
            Wide photo shown at the top of the landing screen. https:// only. Blank = a warm coral gradient.
          </span>
        </label>
      </section>

      {feedback ? (
        <p
          className={`rounded-lg border px-3 py-2 text-sm ${
            feedback.tone === 'ok'
              ? 'border-[#0F5257]/30 bg-[#ECFDF5] text-[#065F46]'
              : 'border-[#E5484D]/30 bg-[#FDECEC] text-[#7A1E22]'
          }`}
        >
          {feedback.text}
        </p>
      ) : null}

      <div className="fixed inset-x-0 bottom-0 z-30 border-t border-[#E5E7EB] bg-white px-4 py-3">
        <div className="mx-auto max-w-lg">
          <button
            type="button"
            onClick={save}
            disabled={busy || !dirty}
            className="flex h-11 w-full items-center justify-center rounded-lg bg-[#0F5257] text-sm font-semibold text-white disabled:opacity-50"
          >
            {busy ? 'Saving…' : dirty ? 'Save settings' : 'Saved'}
          </button>
        </div>
      </div>
    </div>
  );
}
