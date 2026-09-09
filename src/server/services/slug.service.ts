/**
 * src/server/services/slug.service.ts
 *
 * Node runtime, Admin SDK only -- ARCHITECTURE.md §8.1: `tableSlugs/{slug}`
 * is a ROOT-level collection with `allow read, write: if false` in
 * firestore.rules. No client, guest or staff, can ever read it; this
 * service is the only thing in the codebase that can.
 *
 * This is the real implementation `lib/guest/resolve-table-placeholder.ts`
 * has been standing in for since the guest menu page was first built --
 * that file's own header names this exact path as what replaces it. Not
 * wired into the guest pages in this pass; that's a frontend swap, not
 * part of building this backend service.
 *
 * `generateTableSlug` (added with the Manager Table Management pass) is
 * the MINT half §8.1 named as TARGET. `table.actions.ts`'s `upsertTable`
 * (create) and `rotateTableSlug` call it, then write the
 * `tableSlugs/{slug}` mapping this same file reads back.
 *
 * UNIFORM FAILURE, the one property this whole file exists to guarantee:
 * ARCHITECTURE.md §8.1 is explicit that a never-valid slug, a rotated-away-
 * from slug, and a slug pointing at a now-suspended tenant must all be
 * INDISTINGUISHABLE to whoever calls this -- "no oracle distinguishes
 * 'wrong slug' from 'valid slug, closed venue.'" This function collapses
 * "doesn't exist" and "exists but inactive" into the exact same
 * `{ status: 'not_found' }` result on purpose. Do not add a case that
 * tells a caller which one it was.
 */

import { randomInt } from 'node:crypto';
import { adminDb } from '@/lib/firebase/admin';
import type { TableSlugDoc } from '@/types/firestore';

export type SlugResolution =
  | { status: 'resolved'; tenantId: string; branchId: string; tableId: string }
  | { status: 'not_found' };

/**
 * ARCHITECTURE.md §8.1's alphabet, verbatim: 58 characters, no `0`/`O` /
 * `1`/`l`/`I` — unambiguous when read off a printed table tent. 12 chars
 * is the documented default (8 permitted only for legacy print runs);
 * 1% of a 12-char space takes ~4.6 × 10¹¹ years to cover at the §8.1
 * rate ceiling. Drawn with a CSPRNG (`node:crypto` `randomInt`), uniform
 * over the alphabet — no modulo bias.
 */
const SLUG_ALPHABET = '123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz';
const SLUG_LENGTH = 12;

export function generateTableSlug(): string {
  let out = '';
  for (let i = 0; i < SLUG_LENGTH; i += 1) {
    out += SLUG_ALPHABET[randomInt(0, SLUG_ALPHABET.length)];
  }
  return out;
}

/**
 * Resolves an opaque, printed table slug to its location. Never throws
 * for "the slug doesn't work" -- that is an entirely expected outcome
 * for a slug that's wrong, old, or has been rotated away from
 * (RULES.md §4.4: expected outcomes are typed results, not exceptions).
 * A genuine Firestore infrastructure failure (a timed-out read, a
 * misconfigured Admin SDK credential) is NOT caught here and propagates
 * as a real exception -- that distinction is the whole point of not
 * wrapping this in a blanket try/catch.
 */
export async function resolveTableSlug(slug: string): Promise<SlugResolution> {
  const snapshot = await adminDb.doc(`tableSlugs/${slug}`).get();

  if (!snapshot.exists) {
    return { status: 'not_found' };
  }

  const data = snapshot.data() as TableSlugDoc;

  if (!data.active) {
    // A rotated-away-from slug (ARCHITECTURE.md §8.1's rotation
    // response to a ghost-order incident, or a compromised QR) reads as
    // identical to one that never existed -- see file header.
    return { status: 'not_found' };
  }

  return {
    status: 'resolved',
    tenantId: data.tenantId,
    branchId: data.branchId,
    tableId: data.tableId,
  };
}
