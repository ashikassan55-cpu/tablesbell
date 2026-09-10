import type { Metadata } from 'next';
import { requirePlatformSession } from '@/server/services/resolve-platform-session';
import { PlatformShell } from '@/components/platform/platform-shell';
import { NewTenantForm } from '@/components/platform/new-tenant-form';

export const metadata: Metadata = {
  title: 'New restaurant',
  robots: { index: false, follow: false },
};

export const dynamic = 'force-dynamic';

export default async function NewTenantPage() {
  const session = await requirePlatformSession();
  return (
    <PlatformShell email={session.email} active="tenants">
      <h1 className="mb-1 font-heading text-2xl font-bold tracking-tight text-[#1E1B19]">
        Onboard a restaurant
      </h1>
      <p className="mb-5 text-sm text-[#59413C]">
        Creates the tenant, its first branch (empty menu), and the first owner PIN account.
      </p>
      <NewTenantForm />
    </PlatformShell>
  );
}
