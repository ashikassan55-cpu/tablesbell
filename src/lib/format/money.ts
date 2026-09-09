/**
 * src/lib/format/money.ts
 *
 * The one place a fils/cents integer becomes a human string (DECISIONS.md
 * ADR-11). All amounts in the system are integer minor units; this adds
 * the currency symbol and decimal point for display ONLY — never feed a
 * formatted string back into arithmetic.
 *
 * `formatAed` is kept as a thin `formatMoney(x, 'AED')` wrapper so the
 * pre-ADR-11 call sites that still import it keep working while the
 * currency-aware ones migrate.
 */

export interface CurrencyMeta {
  code: string;
  /** `$` / `£` / `€` render tight (`$12.00`); multi-char codes render
   *  spaced (`AED 12.00`). */
  symbol: string;
  decimals: number;
}

export const CURRENCIES: Record<string, CurrencyMeta> = {
  AED: { code: 'AED', symbol: 'AED', decimals: 2 },
  USD: { code: 'USD', symbol: '$', decimals: 2 },
  GBP: { code: 'GBP', symbol: '£', decimals: 2 },
  EUR: { code: 'EUR', symbol: '€', decimals: 2 },
  SAR: { code: 'SAR', symbol: 'SAR', decimals: 2 },
};

export function currencyMeta(currency: string | null | undefined): CurrencyMeta {
  return (currency && CURRENCIES[currency]) || CURRENCIES.AED;
}

/** `minorUnits` is an integer of the currency's minor unit (fils, cents). */
export function formatMoney(minorUnits: number, currency: string | null | undefined): string {
  const meta = currencyMeta(currency);
  const value = (minorUnits / 10 ** meta.decimals).toFixed(meta.decimals);
  return meta.symbol.length === 1 ? `${meta.symbol}${value}` : `${meta.symbol} ${value}`;
}

/** Back-compat: the fixed-AED formatter the codebase used before ADR-11. */
export function formatAed(fils: number): string {
  return formatMoney(fils, 'AED');
}
