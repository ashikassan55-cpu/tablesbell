/**
 * src/lib/time.ts
 *
 * ARCHITECTURE.md §7.2 already named this file: "lib/time.ts — Asia/Dubai
 * formatting, elapsed, service-day boundary." `getElapsedSec` and
 * `formatElapsed` were first written inside `lib/kds/sla-status.ts`
 * because the KDS ticket queue was the first thing that needed them — but
 * they are generic time utilities with nothing KDS-specific about them,
 * and the Cashier Dashboard's table-elapsed-time grid needs the exact
 * same math. Importing them from a `kds/`-named module into cashier code
 * would work, but it's the wrong dependency direction — cashier code has
 * no business depending on a kitchen-display module for something both
 * equally need. Moved here, to the path already reserved for them;
 * `lib/kds/sla-status.ts` now imports from here instead of defining its
 * own copy (RULES.md §4.9).
 */

export function getElapsedSec(atMs: number, nowMs: number): number {
  return Math.max(0, Math.floor((nowMs - atMs) / 1000));
}

/** "11m 42s" — tabular-friendly, fixed-width seconds (RULES.md §3, ops surface rule 3). */
export function formatElapsed(elapsedSec: number): string {
  const minutes = Math.floor(elapsedSec / 60);
  const seconds = elapsedSec % 60;
  return `${minutes}m ${String(seconds).padStart(2, '0')}s`;
}
