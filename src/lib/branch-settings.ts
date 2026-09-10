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

/**
 * An image reference the guest surface can render: either an `http(s)`
 * URL (Firebase Storage download URL, or a hand-pasted link) or an inline
 * `data:image/...;base64,` URI (the upload field's no-bucket fallback).
 * Anything else — `javascript:`, other `data:` types — collapses to "".
 *
 * Data URIs are capped at ~700 KB (a compressed ~800px JPEG is well
 * under that); `MAX_IMAGE_URL` still caps plain links. Firebase Storage
 * (a real download URL) is the path for anything heavier or more
 * numerous — see `image-upload-field.tsx`.
 */
const MAX_DATA_URI = 700_000;
export function cleanImageUrl(value: unknown): string {
  if (typeof value !== 'string') return '';
  const trimmed = value.trim();
  if (/^https?:\/\//i.test(trimmed)) return trimmed.slice(0, MAX_IMAGE_URL);
  if (/^data:image\/(png|jpe?g|webp|gif);base64,[A-Za-z0-9+/=]+$/.test(trimmed)) {
    return trimmed.length <= MAX_DATA_URI ? trimmed : '';
  }
  return '';
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
