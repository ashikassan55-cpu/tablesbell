'use client';

import { useState, type FormEvent } from 'react';
import { useRouter } from 'next/navigation';
import { Loader2, CreditCard } from 'lucide-react';
import { setTenantPlan } from '@/server/actions/platform.actions';
import { PLAN_IDS, planMeta } from '@/lib/platform/plans';
import type { SubscriptionPlan, BillingStatus, TenantSubscription } from '@/types/firestore';

const FIELD =
  'w-full rounded-sm border border-[#BFC8C9] bg-white px-3 py-2.5 text-sm text-[#121C2A] outline-none focus:border-[#0F5257]';

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

  const meta = planMeta(plan);

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
      setMsg({ kind: 'ok', text: 'Saved.' });
      router.refresh();
    } else {
      setMsg({ kind: 'err', text: res.message });
    }
  }

  return (
    <div className="rounded border border-[#D9E3F6] bg-white p-5 shadow-sm">
      <div className="flex items-center justify-between pb-3">
        <div className="flex items-center gap-2">
          <CreditCard className="h-5 w-5 text-[#003A3E]" />
          <h2 className="font-heading text-base font-bold text-[#121C2A]">Plan &amp; billing</h2>
        </div>
        <span className="rounded-sm bg-[#DEE9FC] px-1.5 py-0.5 text-[10px] font-bold uppercase tracking-wide text-[#404849]">
          Manual
        </span>
      </div>

      {/* Current-plan tile — the design's gradient card */}
      <div className="mb-4 rounded bg-gradient-to-br from-[#0F5257] to-[#003A3E] p-4 text-white">
        <span className="text-[10px] font-bold uppercase tracking-widest text-[#96D0D6]">Subscription tier</span>
        <p className="font-heading text-lg font-bold">{meta.name}</p>
        <div className="mt-1 flex items-baseline gap-1.5">
          <span className="font-heading text-2xl font-bold">AED {Number(fee || 0).toLocaleString('en-AE')}</span>
          <span className="text-xs text-[#B2EDF2]">/ month · {billing}</span>
        </div>
        <p className="mt-1 text-xs text-[#96D0D6]">
          {periodEnd ? `Paid until ${new Date(periodEnd).toLocaleDateString('en-AE')}` : 'No renewal date set'}
        </p>
      </div>

      <form onSubmit={onSubmit} className="flex flex-col gap-3">
        <div className="grid gap-3 sm:grid-cols-2">
          <label className="flex flex-col gap-1.5">
            <span className="text-xs font-bold uppercase tracking-wide text-[#404849]">Plan</span>
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
            <span className="text-xs font-bold uppercase tracking-wide text-[#404849]">Monthly fee (AED)</span>
            <input value={fee} onChange={(e) => setFee(e.target.value)} inputMode="numeric" className={FIELD} />
          </label>

          <label className="flex flex-col gap-1.5">
            <span className="text-xs font-bold uppercase tracking-wide text-[#404849]">Billing status</span>
            <select value={billing} onChange={(e) => setBilling(e.target.value as BillingStatus)} className={FIELD}>
              {BILLING.map((b) => (
                <option key={b.id} value={b.id}>
                  {b.label}
                </option>
              ))}
            </select>
          </label>

          <label className="flex flex-col gap-1.5">
            <span className="text-xs font-bold uppercase tracking-wide text-[#404849]">
              Paid until <span className="font-normal normal-case text-[#707979]">· optional</span>
            </span>
            <input type="date" value={periodEnd} onChange={(e) => setPeriodEnd(e.target.value)} className={FIELD} />
          </label>
        </div>

        <label className="flex flex-col gap-1.5">
          <span className="text-xs font-bold uppercase tracking-wide text-[#404849]">
            Notes <span className="font-normal normal-case text-[#707979]">· last payment ref, special terms…</span>
          </span>
          <textarea value={notes} onChange={(e) => setNotes(e.target.value)} rows={2} maxLength={500} className={FIELD} />
        </label>

        {msg ? (
          <p className={`text-sm font-semibold ${msg.kind === 'ok' ? 'text-[#1D704F]' : 'text-[#93000A]'}`}>
            {msg.text}
          </p>
        ) : null}

        <button
          type="submit"
          disabled={busy}
          className="inline-flex items-center justify-center gap-2 self-start rounded-sm bg-[#003A3E] px-5 py-2.5 text-sm font-bold text-white hover:bg-[#0F5257] disabled:opacity-60"
        >
          {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
          Save plan
        </button>
      </form>
    </div>
  );
}
