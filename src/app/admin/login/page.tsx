import { Suspense } from 'react';
import type { Metadata } from 'next';
import { PlatformLoginForm } from '@/components/platform/platform-login-form';

export const metadata: Metadata = {
  title: 'Founder Console',
  robots: { index: false, follow: false },
};

export default function PlatformLoginPage() {
  return (
    <Suspense fallback={<div className="min-h-dvh bg-[#1E1B19]" />}>
      <PlatformLoginForm />
    </Suspense>
  );
}
