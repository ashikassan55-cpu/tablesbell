'use client';

import { useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { LogOut } from 'lucide-react';
import { platformSignOut } from '@/server/actions/platform.actions';

export function PlatformSignOut() {
  const router = useRouter();
  const [pending, start] = useTransition();

  return (
    <button
      type="button"
      disabled={pending}
      onClick={() =>
        start(async () => {
          await platformSignOut();
          try {
            const { signOut } = await import('firebase/auth');
            const { auth } = await import('@/lib/firebase/client');
            await signOut(auth);
          } catch {
            /* ignore */
          }
          router.push('/admin/login');
          router.refresh();
        })
      }
      className="flex w-full items-center gap-2 rounded-sm px-3 py-2 text-sm font-semibold text-[#C9D3E0] transition-colors hover:bg-white/5 hover:text-white disabled:opacity-50"
    >
      <LogOut className="h-4 w-4" />
      {pending ? 'Signing out…' : 'Sign out'}
    </button>
  );
}
