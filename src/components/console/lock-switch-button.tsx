'use client';

/**
 * src/components/console/lock-switch-button.tsx
 *
 * The shared, highly-visible "Lock / Switch User" control for the shared-
 * iPad workflow (DECISIONS.md ADR-11 Target 2). One waiter hands the
 * tablet to the next: this signs the Firebase client SDK out (kills the
 * live Firestore listeners the previous user's session was driving —
 * `lockTerminal` alone can't, that state lives in IndexedDB and only
 * client code can clear it), then calls `lockTerminal`, which deletes the
 * `tb_staff` cookie and redirects to `/{tenantSlug}/lock` for the next
 * PIN entry.
 *
 * `signOut` is best-effort and wrapped — a failure there must not stop
 * the cookie clear + redirect, which is the security-relevant half.
 */

import { useTransition } from 'react';
import { signOut } from 'firebase/auth';
import { auth } from '@/lib/firebase/client';
import { lockTerminal } from '@/server/actions/staff-session.actions';

export function LockSwitchButton({ tenantSlug }: { tenantSlug: string }) {
  const [pending, start] = useTransition();

  return (
    <button
      type="button"
      onClick={() =>
        start(async () => {
          try {
            await signOut(auth);
          } catch {
            // best-effort — the cookie clear + redirect below is what matters
          }
          await lockTerminal(tenantSlug);
        })
      }
      disabled={pending}
      className="flex h-11 items-center gap-1.5 rounded-lg bg-[#1F2937] px-4 text-sm font-bold text-white disabled:opacity-60"
    >
      <span aria-hidden="true">🔒</span>
      {pending ? 'Locking…' : 'Lock / Switch User'}
    </button>
  );
}
