'use client';

/**
 * src/hooks/use-menu-draft.ts
 *
 * Single-document live listener on the Manager Menu Maker's working draft
 * (`tenants/{t}/branches/{b}/menuDraft/current`, DECISIONS.md ADR-8).
 * `'missing'` is a first-class state — a branch that has never opened the
 * Menu Maker has no draft doc, and the page offers to seed one.
 *
 * `firestore.rules` gates this read to `hasRole(['owner','manager'])`, so
 * the client SDK must be signed in as an owner/manager for the listener
 * to attach — the same auth-ready caveat every staff console surface
 * carries (MEMORY.md §4). A `permission-denied` surfaces as `'error'`.
 */

import { useEffect, useState } from 'react';
import { doc, onSnapshot, type FirestoreError } from 'firebase/firestore';
import { db } from '@/lib/firebase/client';
import type { MenuDraftDoc } from '@/types/firestore';

export interface MenuDraftWithMeta extends MenuDraftDoc {
  /** Always `'current'` — the single draft doc id. Kept for symmetry with
   *  the other `*WithId` shapes. */
  id: string;
}

export type LiveMenuDraftState =
  | { status: 'loading'; draft: null; error: null }
  | { status: 'missing'; draft: null; error: null }
  | { status: 'ready'; draft: MenuDraftWithMeta; error: null }
  | { status: 'error'; draft: null; error: string };

export function useMenuDraft(tenantId: string, branchId: string): LiveMenuDraftState {
  const [state, setState] = useState<LiveMenuDraftState>({ status: 'loading', draft: null, error: null });

  useEffect(() => {
    setState({ status: 'loading', draft: null, error: null });

    const ref = doc(db, `tenants/${tenantId}/branches/${branchId}/menuDraft/current`);
    const unsub = onSnapshot(
      ref,
      (snap) => {
        if (!snap.exists()) {
          setState({ status: 'missing', draft: null, error: null });
          return;
        }
        const data = snap.data() as MenuDraftDoc;
        setState({
          status: 'ready',
          draft: {
            id: snap.id,
            updatedAt: typeof data.updatedAt === 'number' ? data.updatedAt : 0,
            updatedByUid: data.updatedByUid ?? '',
            lastPublishedVersion: typeof data.lastPublishedVersion === 'number' ? data.lastPublishedVersion : 0,
            categories: Array.isArray(data.categories) ? data.categories : [],
          },
          error: null,
        });
      },
      (err: FirestoreError) => setState({ status: 'error', draft: null, error: err.message }),
    );

    return unsub;
  }, [tenantId, branchId]);

  return state;
}
