/**
 * src/lib/branch-settings.ts
 *
 * `branches/{b}.settings` defaults + normalisation (DECISIONS.md ADR-11).
 * Client-importable (`lib/`), used by the Manager Store Settings view and
 * the `use-branch-settings` hook. `order.service.ts` does NOT import this
 * (it is dual-compiled by `functions/` and can only use relative imports)
 * — it inlines the same fallback (`FALLBACK_VAT_PPM` / `FALLBACK_CURRENCY`).
 *
 * VAT is stored as parts-per-million (`vatPpm`) — the integer unit
 * `pricing.service.ts` takes — and shown to the manager as a percent.
 * `5` ⇄ `50_000`, `8.5` ⇄ `85_000`.
 */

import { CURRENCIES } from '@/lib/format/money';
import type { BranchSettings, KitchenStatus } from '@/types/firestore';

export const DEFAULT_BRANCH_SETTINGS: BranchSettings = {
  currency: 'AED',
  vatPpm: 50_000,
  receiptFooter: '',
  wifiSsid: '',
  wifiPassword: '',
  heroImageUrl: '',
  kitchenStatus: 'live',
  address: '',
};

export const SUPPORTED_CURRENCIES: readonly string[] = Object.keys(CURRENCIES);

export const MAX_RECEIPT_FOOTER = 240;
export const MAX_VAT_PERCENT = 30;
export const MAX_WIFI_SSID = 64;
export const MAX_WIFI_PASSWORD = 128;
export const MAX_IMAGE_URL = 600;
export const MAX_ADDRESS = 160;
export const KITCHEN_STATUSES: readonly KitchenStatus[] = ['live', 'busy', 'closed'];

/** http(s) image URLs only — never `javascript:` / `data:` — length-capped.
 *  Blank passes through as "" (the feature is simply off). */
export function cleanImageUrl(value: unknown): string {
  if (typeof value !== 'string') return '';
  const trimmed = value.trim().slice(0, MAX_IMAGE_URL);
  return /^https?:\/\//i.test(trimmed) ? trimmed : '';
}

export function vatPercentToPpm(percent: number): number {
  if (!Number.isFinite(percent) || percent < 0) return DEFAULT_BRANCH_SETTINGS.vatPpm;
  return Math.round(Math.min(percent, MAX_VAT_PERCENT) * 10_000);
}

export function vatPpmToPercent(ppm: number): number {
  if (!Number.isFinite(ppm) || ppm < 0) return 5;
  // Trim to at most 3 decimal places so 85_000 → 8.5, not 8.500000001.
  return Math.round((ppm / 10_000) * 1000) / 1000;
}

/** Coerce whatever is on the branch doc (or `undefined`) into a full,
 *  valid `BranchSettings`. */
export function resolveBranchSettings(raw: unknown): BranchSettings {
  const s = (raw ?? {}) as Partial<BranchSettings>;
  const currency =
    typeof s.currency === 'string' && CURRENCIES[s.currency]
      ? s.currency
      : DEFAULT_BRANCH_SETTINGS.currency;
  const vatPpm =
    typeof s.vatPpm === 'number' && Number.isInteger(s.vatPpm) && s.vatPpm >= 0 && s.vatPpm <= 1_000_000
      ? s.vatPpm
      : DEFAULT_BRANCH_SETTINGS.vatPpm;
  const receiptFooter =
    typeof s.receiptFooter === 'string' ? s.receiptFooter.slice(0, MAX_RECEIPT_FOOTER) : '';
  const wifiSsid = typeof s.wifiSsid === 'string' ? s.wifiSsid.slice(0, MAX_WIFI_SSID) : '';
  const wifiPassword =
    typeof s.wifiPassword === 'string' ? s.wifiPassword.slice(0, MAX_WIFI_PASSWORD) : '';
  const heroImageUrl = cleanImageUrl(s.heroImageUrl);
  const kitchenStatus: KitchenStatus =
    s.kitchenStatus === 'busy' || s.kitchenStatus === 'closed' ? s.kitchenStatus : 'live';
  const address = typeof s.address === 'string' ? s.address.slice(0, MAX_ADDRESS) : '';
  return {
    currency,
    vatPpm,
    receiptFooter,
    wifiSsid,
    wifiPassword,
    heroImageUrl,
    kitchenStatus,
    address,
  };
}
