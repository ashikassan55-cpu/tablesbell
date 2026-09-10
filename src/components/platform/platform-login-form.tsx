'use client';

/**
 * src/components/platform/platform-login-form.tsx
 *
 * Founder sign-in: Firebase email/password → ID token → POST
 * /api/admin/session (which verifies the token AND the `plat: true`
 * claim, then sets the `tb_platform` cookie) → hard nav to the console.
 * Firebase is imported lazily so a missing NEXT_PUBLIC_FIREBASE_* config
 * can't take the /admin/login route's build down (same reasoning as the
 * marketing demo form).
 */

import { useState, type FormEvent } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { Loader2, ShieldCheck } from 'lucide-react';

export function PlatformLoginForm() {
  const router = useRouter();
  const params = useSearchParams();
  const next = params.get('next');
  const dest = next && next.startsWith('/admin') && !next.startsWith('/admin/login') ? next : '/admin';

  const [state, setState] = useState<{ status: 'idle' | 'busy' } | { status: 'error'; message: string }>({
    status: 'idle',
  });

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const data = new FormData(event.currentTarget);
    const email = String(data.get('email') ?? '').trim();
    const password = String(data.get('password') ?? '');
    if (!email || !password) {
      setState({ status: 'error', message: 'Enter your email and password.' });
      return;
    }

    setState({ status: 'busy' });
    try {
      const [{ signInWithEmailAndPassword, getIdToken }, { auth }] = await Promise.all([
        import('firebase/auth'),
        import('@/lib/firebase/client'),
      ]);
      const cred = await signInWithEmailAndPassword(auth, email, password);
      const idToken = await getIdToken(cred.user, true);

      const res = await fetch('/api/admin/session', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ idToken }),
      });
      if (!res.ok) {
        setState({ status: 'error', message: 'That account is not a founder account.' });
        return;
      }
      router.push(dest);
      router.refresh();
    } catch {
      setState({ status: 'error', message: 'Email or password not recognised.' });
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

        <form
          onSubmit={onSubmit}
          className="flex flex-col gap-3 rounded-2xl border border-white/10 bg-[#2A2422] p-6"
        >
          <label className="flex flex-col gap-1.5">
            <span className="text-xs font-semibold text-[#C9BDB8]">Email</span>
            <input
              name="email"
              type="email"
              autoComplete="username"
              autoFocus
              className="rounded-lg border border-white/10 bg-[#1E1B19] px-3 py-2.5 text-sm text-white outline-none focus:ring-2 focus:ring-[#E85D3F]"
            />
          </label>
          <label className="flex flex-col gap-1.5">
            <span className="text-xs font-semibold text-[#C9BDB8]">Password</span>
            <input
              name="password"
              type="password"
              autoComplete="current-password"
              className="rounded-lg border border-white/10 bg-[#1E1B19] px-3 py-2.5 text-sm text-white outline-none focus:ring-2 focus:ring-[#E85D3F]"
            />
          </label>

          {state.status === 'error' ? (
            <p role="alert" className="text-sm font-semibold text-[#F87171]">
              {state.message}
            </p>
          ) : null}

          <button
            type="submit"
            disabled={busy}
            className="mt-1 flex items-center justify-center gap-2 rounded-lg bg-[#E85D3F] px-4 py-2.5 text-sm font-bold text-white transition-colors hover:bg-[#d24e33] disabled:opacity-60"
          >
            {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
            {busy ? 'Signing in…' : 'Sign in'}
          </button>
        </form>
        <p className="mt-4 text-center text-xs text-[#8D716B]">
          Access is limited to accounts granted the platform claim.
        </p>
      </div>
    </div>
  );
}
