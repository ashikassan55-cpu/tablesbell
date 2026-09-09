'use client';

/**
 * src/components/console/staff-login-view.tsx
 *
 * The real staff login flow: staff code, then a 4-digit PIN, POSTed to
 * `/api/auth/pin`; on success, `signInWithCustomToken` establishes the
 * browser's Firestore-facing auth state, and the staff session cookie
 * the API route already set carries the visit forward across
 * navigation. TWO fields, not one -- real, per-user-salted argon2id
 * cannot support "type a PIN, the system figures out who you are" the way
 * the old plaintext dictionary could; see `staff-login.service.ts`'s
 * header for the full reasoning.
 *
 * This is the ONLY staff login UI. The old Cashier-embedded
 * `pin-lock-screen.tsx` stub (PIN-only, `MOCK_PIN_DIRECTORY`) is deleted;
 * the Cashier and Waiter terminals now consume the `tb_staff` session
 * this screen establishes. Styled plainly against the light ops palette,
 * no Stitch reference -- flagged in MEMORY.md, not presented as finished
 * design work.
 */

import { useState, type FormEvent } from 'react';
import { useRouter } from 'next/navigation';
import { signInWithCustomToken } from 'firebase/auth';
import { auth } from '@/lib/firebase/client';

const PIN_LENGTH = 4;

type Step = 'staffCode' | 'pin';
type SubmitState = { status: 'idle' } | { status: 'submitting' } | { status: 'error'; message: string };

function lockoutMessage(retryAfterMs: number): string {
  const minutes = Math.max(1, Math.ceil(retryAfterMs / 60_000));
  return `Too many attempts. Try again in ${minutes} minute${minutes === 1 ? '' : 's'}.`;
}

export function StaffLoginView({ tenantSlug, nextPath }: { tenantSlug: string; nextPath: string }) {
  const router = useRouter();
  const [step, setStep] = useState<Step>('staffCode');
  const [staffCode, setStaffCode] = useState('');
  const [pin, setPin] = useState('');
  const [submitState, setSubmitState] = useState<SubmitState>({ status: 'idle' });

  function handleStaffCodeSubmit(event: FormEvent) {
    event.preventDefault();
    if (staffCode.trim().length === 0) return;
    setSubmitState({ status: 'idle' });
    setStep('pin');
  }

  async function submitPin(candidatePin: string) {
    setSubmitState({ status: 'submitting' });

    let response: Response;
    try {
      response = await fetch('/api/auth/pin', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ staffCode: staffCode.trim(), pin: candidatePin }),
      });
    } catch {
      setSubmitState({ status: 'error', message: 'Network error -- check your connection and try again.' });
      setPin('');
      return;
    }

    if (response.status === 429) {
      const body = (await response.json().catch(() => null)) as { retryAfterMs?: number } | null;
      setSubmitState({ status: 'error', message: lockoutMessage(body?.retryAfterMs ?? 15 * 60_000) });
      setPin('');
      setStep('staffCode');
      return;
    }

    if (!response.ok) {
      // Uniform failure -- see api/auth/pin/route.ts's own header. Never
      // distinguish "code not found" from "wrong PIN" from "suspended"
      // here either; the API already collapsed them, this component
      // just displays what it's told.
      setSubmitState({ status: 'error', message: 'Staff code or PIN not recognized.' });
      setPin('');
      return;
    }

    const data = (await response.json()) as { customToken: string };

    try {
      await signInWithCustomToken(auth, data.customToken);
    } catch {
      setSubmitState({ status: 'error', message: "Signed in, but couldn't establish your session. Please try again." });
      setPin('');
      return;
    }

    // Full navigation (not a soft client-side transition) so
    // middleware re-evaluates the now-set staff cookie against the
    // originally-requested console route.
    router.push(nextPath);
  }

  function handleDigit(digit: string) {
    if (submitState.status === 'submitting') return;
    setSubmitState({ status: 'idle' });
    const next = (pin + digit).slice(0, PIN_LENGTH);
    setPin(next);
    if (next.length === PIN_LENGTH) {
      void submitPin(next);
    }
  }

  function handleBackspace() {
    if (submitState.status === 'submitting') return;
    setSubmitState({ status: 'idle' });
    setPin((prev) => prev.slice(0, -1));
  }

  return (
    <div className="flex min-h-dvh flex-col items-center justify-center gap-6 bg-[#F3F4F6] px-6">
      <div className="text-center">
        <p className="text-sm font-semibold uppercase tracking-wide text-[#6B7280]">Secure Terminal</p>
        <h1 className="mt-1 text-xl font-bold text-[#1F2937]">{tenantSlug}</h1>
        <p className="mt-1 text-sm text-[#6B7280]">
          {step === 'staffCode' ? 'Enter your staff code' : 'Enter your 4-digit PIN'}
        </p>
      </div>

      {step === 'staffCode' ? (
        <form onSubmit={handleStaffCodeSubmit} className="flex w-full max-w-xs flex-col gap-3">
          <input
            type="text"
            inputMode="numeric"
            autoFocus
            value={staffCode}
            onChange={(event) => setStaffCode(event.target.value)}
            placeholder="Staff code"
            className="h-14 rounded-lg border border-[#E5E7EB] bg-white px-4 text-center text-lg font-semibold text-[#1F2937]"
          />
          <button
            type="submit"
            className="flex h-12 items-center justify-center rounded-lg bg-[#0F5257] text-sm font-semibold text-white active:scale-[0.98]"
          >
            Continue
          </button>
        </form>
      ) : (
        <>
          <div className="flex gap-3" aria-live="polite">
            {Array.from({ length: PIN_LENGTH }).map((_, index) => (
              <span
                key={index}
                className={`h-4 w-4 rounded-full border-2 ${
                  index < pin.length ? 'border-[#0F5257] bg-[#0F5257]' : 'border-[#D1D5DB] bg-transparent'
                }`}
              />
            ))}
          </div>

          <div className="grid grid-cols-3 gap-3">
            {['1', '2', '3', '4', '5', '6', '7', '8', '9'].map((digit) => (
              <button
                key={digit}
                type="button"
                onClick={() => handleDigit(digit)}
                disabled={submitState.status === 'submitting'}
                className="flex h-16 w-16 items-center justify-center rounded-lg border border-[#E5E7EB] bg-white text-xl font-semibold text-[#1F2937] active:bg-[#F3F4F6] disabled:opacity-50"
              >
                {digit}
              </button>
            ))}
            <button
              type="button"
              onClick={() => setStep('staffCode')}
              className="flex h-16 w-16 items-center justify-center rounded-lg text-xs font-semibold text-[#6B7280]"
            >
              Change code
            </button>
            <button
              type="button"
              onClick={() => handleDigit('0')}
              disabled={submitState.status === 'submitting'}
              className="flex h-16 w-16 items-center justify-center rounded-lg border border-[#E5E7EB] bg-white text-xl font-semibold text-[#1F2937] active:bg-[#F3F4F6] disabled:opacity-50"
            >
              0
            </button>
            <button
              type="button"
              onClick={handleBackspace}
              disabled={submitState.status === 'submitting'}
              aria-label="Delete last digit"
              className="flex h-16 w-16 items-center justify-center rounded-lg border border-[#E5E7EB] bg-white text-[#6B7280] active:bg-[#F3F4F6] disabled:opacity-50"
            >
              ⌫
            </button>
          </div>
        </>
      )}

      {submitState.status === 'error' ? (
        <p role="alert" className="text-sm font-semibold text-[#E5484D]">
          {submitState.message}
        </p>
      ) : null}
    </div>
  );
}
