'use client';

/**
 * src/components/platform/new-tenant-form.tsx
 *
 * Founder onboarding: one form → `createTenant`, which writes the tenant,
 * its first branch (empty menu), and the first owner account with a PIN.
 * On success it shows the owner's sign-in details — the founder passes
 * these to the restaurant.
 */

import { useState, type FormEvent } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { Loader2, CheckCircle2, ArrowLeft } from 'lucide-react';
import { createTenant, type CreateTenantResult } from '@/server/actions/platform.actions';
import { PLAN_IDS, planMeta } from '@/lib/platform/plans';

const FIELD =
  'w-full rounded-lg border border-[#E0BFB8] bg-white px-3 py-2.5 text-sm text-[#1E1B19] outline-none focus:ring-2 focus:ring-[#E85D3F]';

export function NewTenantForm() {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [done, setDone] = useState<Extract<CreateTenantResult, { outcome: 'created' }> | null>(null);

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setErr(null);
    const d = new FormData(event.currentTarget);
    setBusy(true);
    const res = await createTenant({
      name: String(d.get('name') ?? ''),
      slug: String(d.get('slug') ?? ''),
      city: String(d.get('city') ?? ''),
      legalEntity: String(d.get('legalEntity') ?? ''),
      trn: String(d.get('trn') ?? ''),
      ownerName: String(d.get('ownerName') ?? ''),
      ownerEmail: String(d.get('ownerEmail') ?? ''),
      ownerStaffCode: String(d.get('ownerStaffCode') ?? '01'),
      ownerPin: String(d.get('ownerPin') ?? ''),
      plan: String(d.get('plan') ?? 'starter') as (typeof PLAN_IDS)[number],
    });
    setBusy(false);
    if (res.outcome === 'created') {
      setDone(res);
      router.refresh();
    } else {
      setErr(res.message);
    }
  }

  if (done) {
    return (
      <div className="rounded-xl border border-[#3B8169]/30 bg-[#DDF3E4] p-6">
        <div className="flex items-center gap-2">
          <CheckCircle2 className="h-6 w-6 text-[#1E6751]" />
          <h2 className="font-heading text-lg font-bold text-[#1E1B19]">Restaurant onboarded</h2>
        </div>
        <dl className="mt-4 grid gap-2 text-sm sm:grid-cols-2">
          <Row k="Tenant ID" v={done.tenantId} mono />
          <Row k="Login URL" v={`/${done.slug}/lock`} mono />
          <Row k="Owner staff code" v={done.ownerStaffCode} mono />
          <Row k="Owner PIN" v="(the PIN you just set)" />
        </dl>
        <p className="mt-4 text-sm text-[#1E6751]">
          Give the owner their login URL, staff code and PIN. They sign in, then add their menu, tables
          and staff from the manager console. The account starts on <strong>trial</strong> — set the
          plan and mark it paid from its detail page.
        </p>
        <div className="mt-4 flex gap-2">
          <Link
            href={`/admin/tenants/${done.tenantId}`}
            className="rounded-lg bg-[#E85D3F] px-4 py-2 text-sm font-bold text-white hover:bg-[#d24e33]"
          >
            Open detail page
          </Link>
          <Link
            href="/admin"
            className="rounded-lg bg-white px-4 py-2 text-sm font-semibold text-[#1E1B19] ring-1 ring-[#E0BFB8]"
          >
            Back to directory
          </Link>
        </div>
      </div>
    );
  }

  return (
    <form onSubmit={onSubmit} className="rounded-xl border border-[#E0BFB8] bg-white p-6 shadow-sm">
      <Link href="/admin" className="mb-4 inline-flex items-center gap-1 text-sm font-semibold text-[#E85D3F]">
        <ArrowLeft className="h-4 w-4" /> Directory
      </Link>

      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Restaurant name">
          <input name="name" required maxLength={120} placeholder="Alserkal Roastery" className={FIELD} />
        </Field>
        <Field label="Login slug" hint="lowercase, digits, hyphens — used at /{slug}/lock">
          <input
            name="slug"
            required
            maxLength={40}
            pattern="[a-z0-9][a-z0-9-]{0,38}[a-z0-9]"
            placeholder="alserkal"
            className={`${FIELD} font-mono`}
          />
        </Field>
        <Field label="City / Emirate">
          <input name="city" maxLength={60} placeholder="Dubai" className={FIELD} />
        </Field>
        <Field label="Plan">
          <select name="plan" defaultValue="starter" className={FIELD}>
            {PLAN_IDS.map((p) => (
              <option key={p} value={p}>
                {planMeta(p).name} — AED {planMeta(p).monthlyFeeAed}/mo
              </option>
            ))}
          </select>
        </Field>
        <Field label="Legal entity" hint="optional">
          <input name="legalEntity" maxLength={160} placeholder="Alserkal Specialty Coffee LLC" className={FIELD} />
        </Field>
        <Field label="Tax Registration Number (TRN)" hint="optional">
          <input name="trn" maxLength={40} placeholder="AE1004928190003" className={`${FIELD} font-mono`} />
        </Field>
      </div>

      <div className="mt-5 border-t border-[#F4ECE9] pt-5">
        <p className="mb-3 text-xs font-bold uppercase tracking-wide text-[#8D716B]">First owner account</p>
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Owner name">
            <input name="ownerName" required maxLength={120} placeholder="Tariq Al-Mansoor" className={FIELD} />
          </Field>
          <Field label="Owner email">
            <input name="ownerEmail" type="email" required maxLength={160} placeholder="owner@restaurant.ae" className={FIELD} />
          </Field>
          <Field label="Staff code" hint="typed first at the PIN pad">
            <input name="ownerStaffCode" defaultValue="01" maxLength={10} pattern="[A-Za-z0-9]{1,10}" className={`${FIELD} font-mono`} />
          </Field>
          <Field label="PIN" hint="4–8 digits">
            <input name="ownerPin" required inputMode="numeric" pattern="\d{4,8}" placeholder="220814" className={`${FIELD} font-mono`} />
          </Field>
        </div>
      </div>

      {err ? (
        <p role="alert" className="mt-4 text-sm font-semibold text-[#B4231F]">
          {err}
        </p>
      ) : null}

      <button
        type="submit"
        disabled={busy}
        className="mt-5 flex items-center justify-center gap-2 rounded-lg bg-[#E85D3F] px-6 py-3 text-sm font-bold text-white hover:bg-[#d24e33] disabled:opacity-60"
      >
        {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
        {busy ? 'Creating…' : 'Create restaurant'}
      </button>
    </form>
  );
}

function Field({ label, hint, children }: { label: string; hint?: string; children: React.ReactNode }) {
  return (
    <label className="flex flex-col gap-1.5">
      <span className="text-sm font-semibold text-[#1E1B19]">
        {label}
        {hint ? <span className="ml-1 font-normal text-[#8D716B]">· {hint}</span> : null}
      </span>
      {children}
    </label>
  );
}

function Row({ k, v, mono }: { k: string; v: string; mono?: boolean }) {
  return (
    <div>
      <dt className="text-xs uppercase tracking-wide text-[#59413C]">{k}</dt>
      <dd className={`text-[#1E1B19] ${mono ? 'font-mono' : ''}`}>{v}</dd>
    </div>
  );
}
