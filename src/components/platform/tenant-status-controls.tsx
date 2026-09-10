'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { Loader2, Power, PlayCircle, Gavel } from 'lucide-react';
import { setTenantStatus } from '@/server/actions/platform.actions';
import type { TenantStatus } from '@/types/firestore';

const LABELS: Record<TenantStatus, string> = {
  trial: 'Trial',
  active: 'Active',
  past_due: 'Past due',
  suspended: 'Suspended',
  churned: 'Churned',
};

export function TenantStatusControls({ tenantId, status }: { tenantId: string; status: TenantStatus }) {
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
    if (res.outcome === 'updated') router.refresh();
    else setMsg(res.message);
  }

  return (
    <div className="rounded border border-[#FFDAD6] bg-[#FFF7F6] p-5">
      <div className="flex items-center gap-2 pb-1">
        <Gavel className="h-5 w-5 text-[#93000A]" />
        <h2 className="font-heading text-base font-bold text-[#93000A]">Access control</h2>
      </div>
      <p className="text-sm text-[#7A1E22]">
        Suspending instantly blocks this restaurant&apos;s guest QR menus and every staff login. Reactivating restores them.
      </p>
      <p className="mt-3 text-sm text-[#404849]">
        Current status: <strong className="text-[#121C2A]">{LABELS[status]}</strong>
      </p>

      {msg ? <p className="mt-2 text-sm font-semibold text-[#93000A]">{msg}</p> : null}

      <div className="mt-4 flex flex-wrap gap-2">
        {blocked ? (
          <button
            type="button"
            disabled={busy}
            onClick={() => apply('active')}
            className="inline-flex items-center gap-2 rounded-sm bg-[#176B4B] px-4 py-2 text-sm font-bold text-white hover:bg-[#12583d] disabled:opacity-60"
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
                className="rounded-sm border border-[#BFC8C9] bg-white px-4 py-2 text-sm font-semibold text-[#121C2A] hover:bg-[#EFF4FF] disabled:opacity-60"
              >
                Mark Active
              </button>
            ) : null}
            {status !== 'past_due' ? (
              <button
                type="button"
                disabled={busy}
                onClick={() => apply('past_due')}
                className="rounded-sm border border-[#BFC8C9] bg-white px-4 py-2 text-sm font-semibold text-[#7A3E00] hover:bg-[#EFF4FF] disabled:opacity-60"
              >
                Mark Past due
              </button>
            ) : null}
            <button
              type="button"
              disabled={busy}
              onClick={() => setConfirming((v) => !v)}
              className="inline-flex items-center gap-2 rounded-sm bg-[#BA1A1A] px-4 py-2 text-sm font-bold text-white hover:bg-[#9a1614] disabled:opacity-60"
            >
              <Power className="h-4 w-4" />
              Suspend
            </button>
          </>
        )}
      </div>

      {confirming && !blocked ? (
        <div className="mt-3 rounded-sm border border-[#FFDAD6] bg-white p-3">
          <label className="text-sm font-semibold text-[#121C2A]">Reason (kept on the tenant record)</label>
          <input
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            placeholder="Invoice 42 days overdue"
            className="mt-1 w-full rounded-sm border border-[#BFC8C9] bg-white px-3 py-2 text-sm outline-none focus:border-[#BA1A1A]"
          />
          <div className="mt-2 flex gap-2">
            <button
              type="button"
              disabled={busy}
              onClick={() => apply('suspended')}
              className="rounded-sm bg-[#BA1A1A] px-4 py-2 text-sm font-bold text-white hover:bg-[#9a1614] disabled:opacity-60"
            >
              {busy ? 'Suspending…' : 'Confirm suspend'}
            </button>
            <button
              type="button"
              onClick={() => setConfirming(false)}
              className="rounded-sm border border-[#BFC8C9] bg-white px-4 py-2 text-sm font-semibold text-[#121C2A]"
            >
              Cancel
            </button>
          </div>
        </div>
      ) : null}
    </div>
  );
}
