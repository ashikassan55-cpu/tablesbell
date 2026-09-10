'use client';

/**
 * src/components/guest/use-service-call.ts
 *
 * Guest → staff assistance request (Stitch guest ordering: "Call Waiter",
 * "Free Water", "Wipes & Set", the floating "Ring Service Bell", and the
 * tracker's "Need anything else?" row).
 *
 * Writes a `serviceCalls` doc directly with the Firestore client SDK —
 * `firestore.rules` already gates the `create` (`isGuest`, `inParty`,
 * `partyOpen`, the fixed `type` enum + key set). Staff see it live in the
 * Cashier "Alerts & Pagers" tab and clear it via `resolveServiceCall`
 * (Admin SDK). There is no cancel — a guest asks a human (Section 1.7).
 */

import { useCallback, useState } from 'react';
import { addDoc, collection, serverTimestamp } from 'firebase/firestore';
import { db, auth } from '@/lib/firebase/client';
import { useGuestSession } from '@/components/providers/guest-session-provider';
import type { ServiceCallType } from '@/types/firestore';

export type ServiceCallStatus = 'idle' | 'sending' | 'sent' | 'error';

export function useServiceCall() {
  const { tenantId, branchId, tableId, sessionId } = useGuestSession();
  const [status, setStatus] = useState<ServiceCallStatus>('idle');
  const [lastType, setLastType] = useState<ServiceCallType | null>(null);

  const send = useCallback(
    async (type: ServiceCallType, note = ''): Promise<boolean> => {
      const uid = auth.currentUser?.uid;
      if (!uid) {
        setStatus('error');
        setLastType(type);
        window.setTimeout(() => setStatus('idle'), 3500);
        return false;
      }
      setStatus('sending');
      setLastType(type);
      try {
        await addDoc(collection(db, `tenants/${tenantId}/branches/${branchId}/serviceCalls`), {
          sessionId,
          tableId,
          type,
          note: note.slice(0, 150),
          createdBy: uid,
          createdAt: serverTimestamp(),
          status: 'open',
        });
        setStatus('sent');
        window.setTimeout(() => setStatus('idle'), 3500);
        return true;
      } catch {
        setStatus('error');
        window.setTimeout(() => setStatus('idle'), 3500);
        return false;
      }
    },
    [tenantId, branchId, tableId, sessionId],
  );

  return { send, status, lastType };
}
