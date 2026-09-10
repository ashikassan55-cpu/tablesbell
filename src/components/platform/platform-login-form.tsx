'use client';

/**
 * src/components/platform/platform-login-form.tsx
 *
 * Founder sign-in — Google only. `signInWithPopup` (client-side Firebase
 * Google Auth) → ID token → POST /api/admin/session, which checks the
 * token's email against `ADMIN_EMAIL` and, on a match, sets the
 * `tb_platform` cookie. No password, no custom claim, no CLI grant step:
 * the allowlist IS the gate.
 *
 * Firebase is imported lazily so a missing NEXT_PUBLIC_FIREBASE_* config
 * can't take the /admin/login route's build down.
 */

import { useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { Loader2, ShieldCheck } from 'lucide-react';

const GoogleMark = () => (
  <svg viewBox="0 0 48 48" className="h-4 w-4" aria-hidden="true">
    <path
      fill="#EA4335"
      d="M24 9.5c3.54 0 6.71 1.22 9.21 3.6l6.85-6.85C35.9 2.38 30.47 0 24 0 14.62 0 6.51 5.38 2.56 13.22l7.98 6.19C12.43 13.72 17.74 9.5 24 9.5z"
    />
    <path
      fill="#4285F4"
      d="M46.98 24.55c0-1.57-.15-3.09-.38-4.55H24v9.02h12.94c-.58 2.96-2.26 5.48-4.78 7.18l7.73 6c4.51-4.18 7.09-10.36 7.09-17.65z"
    />
    <path
      fill="#FBBC05"
      d="M10.53 28.59c-.48-1.45-.76-2.99-.76-4.59s.27-3.14.76-4.59l-7.98-6.19C.92 16.46 0 20.12 0 24c0 3.88.92 7.54 2.56 10.78l7.97-6.19z"
    />
    <path
      fill="#34A853"
      d="M24 48c6.48 0 11.93-2.13 15.89-5.81l-7.73-6c-2.15 1.45-4.92 2.3-8.16 2.3-6.26 0-11.57-4.22-13.47-9.91l-7.98 6.19C6.51 42.62 14.62 48 24 48z"
    />
  </svg>
);

export function PlatformLoginForm() {
  const router = useRouter();
  const params = useSearchParams();
  const next = params.get('next');
  const dest = next && next.startsWith('/admin') && !next.startsWith('/admin/login') ? next : '/admin';

  const [state, setState] = useState<{ status: 'idle' | 'busy' } | { status: 'error'; message: string }>({
    status: 'idle',
  });

  async function signIn() {
    setState({ status: 'busy' });
    try {
      const [{ GoogleAuthProvider, signInWithPopup, signOut }, { auth }] = await Promise.all([
        import('firebase/auth'),
        import('@/lib/firebase/client'),
      ]);
      const provider = new GoogleAuthProvider();
      provider.setCustomParameters({ prompt: 'select_account' });

      let cred;
      try {
        cred = await signInWithPopup(auth, provider);
      } catch (e) {
        const code = (e as { code?: string })?.code ?? '';
        if (code === 'auth/popup-closed-by-user' || code === 'auth/cancelled-popup-request') {
          setState({ status: 'idle' });
          return;
        }
        setState({ status: 'error', message: 'Google sign-in was blocked. Allow pop-ups and try again.' });
        return;
      }

      const idToken = await cred.user.getIdToken(true);
      const res = await fetch('/api/admin/session', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ idToken }),
      });

      if (!res.ok) {
        const detail = (await res.json().catch(() => null)) as { signedInAs?: string | null } | null;
        // Rejected account — don't leave it signed in on this device.
        try {
          await signOut(auth);
        } catch {
          /* ignore */
        }
        setState({
          status: 'error',
          message: detail?.signedInAs
            ? `Signed in as ${detail.signedInAs} — that account is not on the founder allowlist.`
            : 'This Google account is not authorised for the founder console.',
        });
        return;
      }

      router.push(dest);
      router.refresh();
    } catch {
      setState({ status: 'error', message: 'Could not complete sign-in. Try again.' });
    }
  }

  const busy = state.status === 'busy';

  return (
    <div className="flex min-h-dvh items-center justify-center bg-[#1E1B19] px-6 font-body">
      <div className="w-full max-w-sm">
        <div className="mb-6 text-center">
          <span className="font-heading text-2xl font-extrabold tracking-tight text-[#F7EFEC]">
            Table<span className="text-[#E85D3F]">Bells</span>
          </span>
          <p className="mt-1 flex items-center justify-center gap-1.5 text-xs font-semibold uppercase tracking-wider text-[#8D716B]">
            <ShieldCheck className="h-3.5 w-3.5" />
            Founder Console
          </p>
        </div>

        <div className="flex flex-col gap-4 rounded-2xl border border-white/10 bg-[#2A2422] p-6">
          <p className="text-sm text-[#C9BDB8]">
            Sign in with the Google account authorised for this platform.
          </p>

          <button
            type="button"
            onClick={signIn}
            disabled={busy}
            className="flex items-center justify-center gap-2.5 rounded-lg bg-white px-4 py-2.5 text-sm font-bold text-[#1E1B19] transition-opacity hover:opacity-90 disabled:opacity-60"
          >
            {busy ? <Loader2 className="h-4 w-4 animate-spin text-[#8D716B]" /> : <GoogleMark />}
            {busy ? 'Signing in…' : 'Sign in with Google'}
          </button>

          {state.status === 'error' ? (
            <p role="alert" className="text-sm font-semibold text-[#F87171]">
              {state.message}
            </p>
          ) : null}
        </div>

        <p className="mt-4 text-center text-xs text-[#8D716B]">
          Access is limited to one allowlisted Google account.
        </p>
      </div>
    </div>
  );
}
