'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { Loader2, Power, PlayCircle } from 'lucide-react';
import { setTenantStatus } from '@/server/actions/platform.actions';
import type { TenantStatus } from '@/types/firestore';

const LABELS: Record<TenantStatus, string> = {
  trial: 'Trial',
  active: 'Active',
  past_due: 'Past due',
  suspended: 'Suspended',
  churned: 'Churned',
};

export function TenantStatusControls({
  tenantId,
  status,
}: {
  tenantId: string;
  status: TenantStatus;
}) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const [reason, setReason] = useState('');
  const [msg, setMsg] = useState<string | null>(null);

  const blocked = status === 'suspended' || status === 'churned';

  async function apply(next: TenantStatus) {
    setBusy(true);
    setMsg(null);
    const res = await setTenantStatus({ tenantId, status: next, reason });
    setBusy(false);
    setConfirming(false);
    setReason('');
    if (res.outcome === 'updated') {
      router.refresh();
    } else {
      setMsg(res.message);
    }
  }

  return (
    <div className="rounded-xl border border-[#E5484D]/30 bg-[#FDECEC] p-5">
      <h2 className="font-heading text-base font-bold text-[#7A1E22]">Access control</h2>
      <p className="mt-0.5 text-sm text-[#7A1E22]/80">
        Suspending immediately blocks this restaurant&apos;s guest QR menus and every staff login.
      </p>

      <p className="mt-3 text-sm text-[#59413C]">
        Current status: <strong className="text-[#1E1B19]">{LABELS[status]}</strong>
      </p>

      {msg ? <p className="mt-2 text-sm font-semibold text-[#B4231F]">{msg}</p> : null}

      <div className="mt-4 flex flex-wrap gap-2">
        {blocked ? (
          <button
            type="button"
            disabled={busy}
            onClick={() => apply('active')}
            className="inline-flex items-center gap-2 rounded-lg bg-[#1E6751] px-4 py-2 text-sm font-bold text-white hover:bg-[#17513f] disabled:opacity-60"
          >
            {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <PlayCircle className="h-4 w-4" />}
            Reactivate (set Active)
          </button>
        ) : (
          <>
            {status !== 'active' ? (
              <button
                type="button"
                disabled={busy}
                onClick={() => apply('active')}
                className="rounded-lg bg-white px-4 py-2 text-sm font-semibold text-[#1E1B19] ring-1 ring-[#E0BFB8] hover:bg-[#F4ECE9] disabled:opacity-60"
              >
                Mark Active
              </button>
            ) : null}
            {status !== 'past_due' ? (
              <button
                type="button"
                disabled={busy}
                onClick={() => apply('past_due')}
                className="rounded-lg bg-white px-4 py-2 text-sm font-semibold text-[#8E4E14] ring-1 ring-[#E0BFB8] hover:bg-[#F4ECE9] disabled:opacity-60"
              >
                Mark Past due
              </button>
            ) : null}
            <button
              type="button"
              disabled={busy}
              onClick={() => setConfirming((v) => !v)}
              className="inline-flex items-center gap-2 rounded-lg bg-[#B4231F] px-4 py-2 text-sm font-bold text-white hover:bg-[#9a1c19] disabled:opacity-60"
            >
              <Power className="h-4 w-4" />
              Suspend
            </button>
          </>
        )}
      </div>

      {confirming && !blocked ? (
        <div className="mt-3 rounded-lg border border-[#E5484D]/40 bg-white p-3">
          <label className="text-sm font-semibold text-[#1E1B19]">Reason (kept on the tenant record)</label>
          <input
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            placeholder="Invoice 42 days overdue"
            className="mt-1 w-full rounded-lg border border-[#E0BFB8] bg-white px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-[#B4231F]"
          />
          <div className="mt-2 flex gap-2">
            <button
              type="button"
              disabled={busy}
              onClick={() => apply('suspended')}
              className="rounded-lg bg-[#B4231F] px-4 py-2 text-sm font-bold text-white hover:bg-[#9a1c19] disabled:opacity-60"
            >
              {busy ? 'Suspending…' : 'Confirm suspend'}
            </button>
            <button
              type="button"
              onClick={() => setConfirming(false)}
              className="rounded-lg bg-white px-4 py-2 text-sm font-semibold text-[#1E1B19] ring-1 ring-[#E0BFB8]"
            >
              Cancel
            </button>
          </div>
        </div>
      ) : null}
    </div>
  );
}
