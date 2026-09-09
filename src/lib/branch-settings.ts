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
import type { BranchSettings } from '@/types/firestore';

export const DEFAULT_BRANCH_SETTINGS: BranchSettings = {
  currency: 'AED',
  vatPpm: 50_000,
  receiptFooter: '',
};

export const SUPPORTED_CURRENCIES: readonly string[] = Object.keys(CURRENCIES);

export const MAX_RECEIPT_FOOTER = 240;
export const MAX_VAT_PERCENT = 30;

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
  return { currency, vatPpm, receiptFooter };
}
