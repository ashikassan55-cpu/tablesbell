/**
 * src/server/services/pricing.service.ts
 *
 * The ONLY VAT arithmetic in the codebase. ARCHITECTURE.md Section 1.9:
 * "A second implementation of this arithmetic anywhere in the repo is a
 * review-blocking defect." Every caller -- order creation, item voids,
 * bill recomputation, discount application -- imports `splitInclusive`
 * from here rather than deriving net/VAT itself.
 *
 * All money in this codebase is an integer of fils / cents (the currency's
 * minor unit). No floats, no decimal strings, anywhere in the stack.
 *
 * VAT RATE IS A PARAMETER (DECISIONS.md ADR-11), not a constant. It is
 * passed in parts-per-million (`50_000` = 5%, `85_000` = 8.5%) — an
 * integer, so the money path stays float-free. It defaults to 5% only so
 * a caller that has genuinely not resolved a branch rate yet still
 * behaves as before; `priceOrderRequest` and `voidTicketLine` BOTH pass
 * the real per-branch value (`priceOrderRequest` from `branch.settings`,
 * `voidTicketLine` from the `vatPpm` it snapshotted onto the order), so
 * the default is a safety net, not the normal path.
 */

export const DEFAULT_VAT_PPM = 50_000; // 5%

export interface InclusiveSplit {
  grossFils: number;
  netFils: number;
  vatFils: number;
}

/**
 * Derives net and VAT from a VAT-inclusive gross amount at `vatPpm`
 * parts-per-million.
 *
 * MUST be called on the freshly summed gross of the surviving line items
 * every time the gross changes -- never used to adjust a previously
 * derived net/VAT pair incrementally. Subtracting a voided line's own
 * VAT from the order's VAT introduces a 1-fil rounding drift per
 * operation (Section 2.6); calling this function again on the new total
 * is the only correct path.
 */
export function splitInclusive(grossFils: number, vatPpm: number = DEFAULT_VAT_PPM): InclusiveSplit {
  if (!Number.isInteger(grossFils) || grossFils < 0) {
    throw new RangeError(`splitInclusive: grossFils must be a non-negative integer, got ${grossFils}`);
  }
  if (!Number.isInteger(vatPpm) || vatPpm < 0 || vatPpm > 1_000_000) {
    throw new RangeError(`splitInclusive: vatPpm must be an integer in [0, 1_000_000], got ${vatPpm}`);
  }
  const netFils = Math.round((grossFils * 1_000_000) / (1_000_000 + vatPpm));
  return { grossFils, netFils, vatFils: grossFils - netFils };
}
