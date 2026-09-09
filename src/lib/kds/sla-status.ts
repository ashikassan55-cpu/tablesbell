/**
 * src/lib/kds/sla-status.ts
 *
 * SLA-tier math specifically (RULES.md §4.9: reusable logic lives in one
 * place, not duplicated per component). `getElapsedSec`/`formatElapsed`
 * moved to `lib/time.ts` once the Cashier Dashboard needed the same
 * elapsed-time math for a table grid that has nothing to do with SLAs —
 * this file re-exports them so nothing that already imports from here
 * breaks, but new code reaching only for elapsed-time formatting should
 * import from `lib/time.ts` directly.
 */

import { getElapsedSec, formatElapsed } from '@/lib/time';

export { getElapsedSec, formatElapsed };

export type SlaTier = 'onTrack' | 'approaching' | 'breached';

/**
 * The 70% "approaching" threshold is a UI/UX judgment call made here, not
 * a value ARCHITECTURE.md specifies anywhere — the architecture only
 * defines a binary `slaBreached` flag on the order document itself. This
 * constant isn't load-bearing for anything outside this file; adjust it
 * freely.
 */
const APPROACHING_RATIO = 0.7;

export function getSlaTier(elapsedSec: number, slaTargetSec: number): SlaTier {
  if (slaTargetSec <= 0) return 'onTrack';
  const ratio = elapsedSec / slaTargetSec;
  if (ratio >= 1) return 'breached';
  if (ratio >= APPROACHING_RATIO) return 'approaching';
  return 'onTrack';
}
