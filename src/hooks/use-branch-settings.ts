'use client';

/**
 * src/hooks/use-branch-settings.ts
 *
 * Single-doc live listener on `branches/{b}` that projects out just the
 * ADR-11 localization bits (`name` + `settings`), normalised through
 * `resolveBranchSettings` so a consumer always gets a full, valid
 * `BranchSettings` (AED / 5% / empty footer when the branch has never
 * saved any). `firestore.rules` already lets any `isStaff && inBranch`
 * member read `branches/{b}`.
 *
 * Used by the Manager Store Settings view. Console surfaces that want the
 * live currency for display can also mount this — the read is one cheap
 * document.
 */

import { useEffect, useState } from 'react';
import { doc, onSnapshot, type FirestoreError } from 'firebase/firestore';
import { db } from '@/lib/firebase/client';
import { DEFAULT_BRANCH_SETTINGS, resolveBranchSettings } from '@/lib/branch-settings';
import type { BranchSettings } from '@/types/firestore';

export interface LiveBranchSettings {
  status: 'loading' | 'ready' | 'error';
  name: string;
  settings: BranchSettings;
  error: string | null;
}

export function useBranchSettings(tenantId: string, branchId: string): LiveBranchSettings {
  const [state, setState] = useState<LiveBranchSettings>({
    status: 'loading',
    name: '',
    settings: DEFAULT_BRANCH_SETTINGS,
    error: null,
  });

  useEffect(() => {
    setState({ status: 'loading', name: '', settings: DEFAULT_BRANCH_SETTINGS, error: null });

    const unsub = onSnapshot(
      doc(db, `tenants/${tenantId}/branches/${branchId}`),
      (snap) => {
        const data = (snap.data() ?? {}) as { name?: unknown; settings?: unknown };
        setState({
          status: 'ready',
          name: typeof data.name === 'string' ? data.name : '',
          settings: resolveBranchSettings(data.settings),
          error: null,
        });
      },
      (err: FirestoreError) =>
        setState({ status: 'error', name: '', settings: DEFAULT_BRANCH_SETTINGS, error: err.message }),
    );

    return unsub;
  }, [tenantId, branchId]);

  return state;
}
