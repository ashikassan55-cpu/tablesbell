/**
 * src/server/services/pricing.service.ts
 *
 * The ONLY VAT arithmetic in the codebase. ARCHITECTURE.md Section 1.9:
 * "A second implementation of this arithmetic anywhere in the repo is a
 * review-blocking defect." Every caller -- order creation, item voids,
 * bill recomputation, discount application -- imports `splitInclusive`
 * from here rather than deriving net/VAT itself.
 *
 * All money in this codebase is an integer of fils (AED minor units).
 * No floats, no decimal strings, anywhere in the stack.
 */

const VAT_PPM = 50_000; // 5%, expressed as parts-per-million

export interface InclusiveSplit {
  grossFils: number;
  netFils: number;
  vatFils: number;
}

/**
 * Derives net and VAT from a VAT-inclusive gross amount.
 *
 * MUST be called on the freshly summed gross of the surviving line items
 * every time the gross changes -- never used to adjust a previously
 * derived net/VAT pair incrementally. Subtracting a voided line's own
 * VAT from the order's VAT introduces a 1-fil rounding drift per
 * operation (Section 2.6); calling this function again on the new total
 * is the only correct path.
 */
export function splitInclusive(grossFils: number): InclusiveSplit {
  if (!Number.isInteger(grossFils) || grossFils < 0) {
    throw new RangeError(`splitInclusive: grossFils must be a non-negative integer, got ${grossFils}`);
  }
  const netFils = Math.round((grossFils * 1_000_000) / (1_000_000 + VAT_PPM));
  return { grossFils, netFils, vatFils: grossFils - netFils };
}
