'use client';

/**
 * src/components/marketing/demo-form.tsx
 *
 * The landing page's "Book my 5-minute demo" lead form. Writes one
 * document to the root `demoLeads` collection via the Firebase client
 * SDK -- `firestore.rules` allows an unauthenticated CREATE with a
 * strictly-shaped, size-bounded payload and nothing else (no read, no
 * update, no delete). An operator reads these with the Admin SDK; there
 * is no in-app lead inbox yet.
 */

import { useState, type FormEvent } from 'react';
import { addDoc, collection, serverTimestamp } from 'firebase/firestore';
import { CheckCircle2, Loader2 } from 'lucide-react';
import { db } from '@/lib/firebase/client';

const EMIRATES = [
  'Dubai',
  'Abu Dhabi',
  'Sharjah',
  'Ajman',
  'Ras Al Khaimah',
  'Fujairah',
  'Umm Al Quwain',
] as const;

const TABLE_RANGES = ['1–10 tables', '11–25 tables', '26–50 tables', '50+ tables'] as const;

const INPUT_CLASS =
  'w-full rounded-xl border border-guest-border-warm bg-white px-3 py-2.5 text-sm text-guest-text outline-none focus:ring-2 focus:ring-guest-primary';

type State = { status: 'idle' | 'submitting' | 'done' } | { status: 'error'; message: string };

export function DemoForm() {
  const [state, setState] = useState<State>({ status: 'idle' });

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = event.currentTarget;
    const data = new FormData(form);

    const venueName = String(data.get('venueName') ?? '').trim();
    const contactName = String(data.get('contactName') ?? '').trim();
    const localPhone = String(data.get('phone') ?? '').replace(/[^\d]/g, '');
    const emirate = String(data.get('emirate') ?? '');
    const tableRange = String(data.get('tableRange') ?? '');

    if (!venueName || !contactName || localPhone.length < 6 || !emirate || !tableRange) {
      setState({ status: 'error', message: 'Please fill in every field.' });
      return;
    }

    setState({ status: 'submitting' });
    try {
      await addDoc(collection(db, 'demoLeads'), {
        venueName: venueName.slice(0, 120),
        contactName: contactName.slice(0, 120),
        phone: `+971${localPhone}`.slice(0, 40),
        emirate,
        tableRange,
        source: 'landing',
        createdAt: serverTimestamp(),
      });
      setState({ status: 'done' });
      form.reset();
    } catch {
      setState({
        status: 'error',
        message: "Couldn't send that just now — please try again in a moment.",
      });
    }
  }

  if (state.status === 'done') {
    return (
      <div className="flex flex-col items-center gap-2 rounded-2xl border border-guest-tertiary/30 bg-guest-tertiary/10 p-8 text-center">
        <CheckCircle2 className="h-10 w-10 text-guest-tertiary" />
        <p className="font-heading text-lg font-bold text-guest-text">Demo request received</p>
        <p className="text-sm text-guest-text-muted">
          Our UAE team will message your WhatsApp within one business day with a test menu link.
        </p>
      </div>
    );
  }

  const busy = state.status === 'submitting';

  return (
    <form onSubmit={onSubmit} className="flex flex-col gap-4">
      <Field label="Restaurant / café name">
        <input
          name="venueName"
          required
          maxLength={120}
          placeholder="e.g. Saffron Specialty Coffee"
          className={INPUT_CLASS}
        />
      </Field>

      <Field label="Owner / manager name">
        <input name="contactName" required maxLength={120} placeholder="e.g. Karim Salem" className={INPUT_CLASS} />
      </Field>

      <Field label="UAE mobile / WhatsApp">
        <div className="flex items-stretch overflow-hidden rounded-xl border border-guest-border-warm bg-white focus-within:ring-2 focus-within:ring-guest-primary">
          <span className="flex shrink-0 items-center bg-guest-canvas px-3 text-sm font-bold text-guest-text">
            🇦🇪 +971
          </span>
          <input
            name="phone"
            required
            inputMode="numeric"
            placeholder="50 123 4567"
            className="w-full bg-transparent px-3 py-2.5 text-sm text-guest-text outline-none"
          />
        </div>
      </Field>

      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Emirate">
          <select name="emirate" required defaultValue="" className={INPUT_CLASS}>
            <option value="" disabled>
              Select…
            </option>
            {EMIRATES.map((e) => (
              <option key={e} value={e}>
                {e}
              </option>
            ))}
          </select>
        </Field>
        <Field label="Dine-in tables">
          <select name="tableRange" required defaultValue="" className={INPUT_CLASS}>
            <option value="" disabled>
              Select…
            </option>
            {TABLE_RANGES.map((r) => (
              <option key={r} value={r}>
                {r}
              </option>
            ))}
          </select>
        </Field>
      </div>

      {state.status === 'error' ? (
        <p role="alert" className="text-sm font-semibold text-guest-critical">
          {state.message}
        </p>
      ) : null}

      <button
        type="submit"
        disabled={busy}
        className="mt-1 flex items-center justify-center gap-2 rounded-xl bg-guest-primary px-6 py-3.5 text-sm font-bold text-white shadow-lg shadow-guest-primary/25 transition-colors hover:bg-[#d24e33] disabled:opacity-60"
      >
        {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
        {busy ? 'Sending…' : 'Book my 5-minute demo'}
      </button>

      <p className="text-center text-xs text-guest-text-muted">
        No credit card needed · In-person walkthrough available in Dubai &amp; Sharjah
      </p>
    </form>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="flex flex-col gap-1.5">
      <span className="text-sm font-semibold text-guest-text">{label}</span>
      {children}
    </label>
  );
}
