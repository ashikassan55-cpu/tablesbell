'use client';

import { useState, type FormEvent } from 'react';
import { useRouter } from 'next/navigation';
import { Loader2 } from 'lucide-react';
import { setTenantPlan } from '@/server/actions/platform.actions';
import { PLAN_IDS, planMeta } from '@/lib/platform/plans';
import type { SubscriptionPlan, BillingStatus, TenantSubscription } from '@/types/firestore';

const FIELD =
  'w-full rounded-lg border border-[#E0BFB8] bg-white px-3 py-2.5 text-sm text-[#1E1B19] outline-none focus:ring-2 focus:ring-[#E85D3F]';

const BILLING: { id: BillingStatus; label: string }[] = [
  { id: 'trialing', label: 'Trialing' },
  { id: 'paid', label: 'Paid — current' },
  { id: 'past_due', label: 'Past due' },
  { id: 'suspended', label: 'Suspended' },
];

function toDateInput(ms: number | null): string {
  if (!ms) return '';
  const d = new Date(ms);
  return Number.isNaN(d.getTime()) ? '' : d.toISOString().slice(0, 10);
}

export function TenantPlanControls({
  tenantId,
  subscription,
}: {
  tenantId: string;
  subscription: TenantSubscription;
}) {
  const router = useRouter();
  const [plan, setPlan] = useState<SubscriptionPlan>(subscription.plan);
  const [fee, setFee] = useState(String(subscription.monthlyFeeAed));
  const [billing, setBilling] = useState<BillingStatus>(subscription.billingStatus);
  const [periodEnd, setPeriodEnd] = useState(toDateInput(subscription.currentPeriodEnd));
  const [notes, setNotes] = useState(subscription.notes ?? '');
  const [msg, setMsg] = useState<{ kind: 'ok' | 'err'; text: string } | null>(null);
  const [busy, setBusy] = useState(false);

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setMsg(null);
    const res = await setTenantPlan({
      tenantId,
      plan,
      monthlyFeeAed: Number(fee),
      billingStatus: billing,
      currentPeriodEnd: periodEnd ? new Date(periodEnd + 'T00:00:00Z').getTime() : null,
      notes,
    });
    setBusy(false);
    if (res.outcome === 'updated') {
      setMsg({ kind: 'ok', text: 'Plan updated.' });
      router.refresh();
    } else {
      setMsg({ kind: 'err', text: res.message });
    }
  }

  return (
    <form onSubmit={onSubmit} className="rounded-xl border border-[#E0BFB8] bg-white p-5 shadow-sm">
      <h2 className="font-heading text-base font-bold text-[#1E1B19]">Plan &amp; billing</h2>
      <p className="mt-0.5 text-xs text-[#8D716B]">Manual — nothing here charges a card.</p>

      <div className="mt-4 grid gap-4 sm:grid-cols-2">
        <label className="flex flex-col gap-1.5">
          <span className="text-sm font-semibold text-[#1E1B19]">Plan</span>
          <select
            value={plan}
            onChange={(e) => {
              const p = e.target.value as SubscriptionPlan;
              setPlan(p);
              setFee(String(planMeta(p).monthlyFeeAed));
            }}
            className={FIELD}
          >
            {PLAN_IDS.map((p) => (
              <option key={p} value={p}>
                {planMeta(p).name}
              </option>
            ))}
          </select>
        </label>

        <label className="flex flex-col gap-1.5">
          <span className="text-sm font-semibold text-[#1E1B19]">Monthly fee (AED)</span>
          <input value={fee} onChange={(e) => setFee(e.target.value)} inputMode="numeric" className={FIELD} />
        </label>

        <label className="flex flex-col gap-1.5">
          <span className="text-sm font-semibold text-[#1E1B19]">Billing status</span>
          <select value={billing} onChange={(e) => setBilling(e.target.value as BillingStatus)} className={FIELD}>
            {BILLING.map((b) => (
              <option key={b.id} value={b.id}>
                {b.label}
              </option>
            ))}
          </select>
        </label>

        <label className="flex flex-col gap-1.5">
          <span className="text-sm font-semibold text-[#1E1B19]">
            Paid until <span className="font-normal text-[#8D716B]">· optional</span>
          </span>
          <input type="date" value={periodEnd} onChange={(e) => setPeriodEnd(e.target.value)} className={FIELD} />
        </label>
      </div>

      <label className="mt-4 flex flex-col gap-1.5">
        <span className="text-sm font-semibold text-[#1E1B19]">
          Notes <span className="font-normal text-[#8D716B]">· last payment ref, special terms…</span>
        </span>
        <textarea
          value={notes}
          onChange={(e) => setNotes(e.target.value)}
          rows={2}
          maxLength={500}
          className={FIELD}
        />
      </label>

      {msg ? (
        <p className={`mt-3 text-sm font-semibold ${msg.kind === 'ok' ? 'text-[#1E6751]' : 'text-[#B4231F]'}`}>
          {msg.text}
        </p>
      ) : null}

      <button
        type="submit"
        disabled={busy}
        className="mt-4 flex items-center justify-center gap-2 rounded-lg bg-[#E85D3F] px-5 py-2.5 text-sm font-bold text-white hover:bg-[#d24e33] disabled:opacity-60"
      >
        {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
        Save plan
      </button>
    </form>
  );
}
