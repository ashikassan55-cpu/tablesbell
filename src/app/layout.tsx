import type { Metadata } from 'next';
import type { ReactNode } from 'react';
import './globals.css';

/**
 * src/app/layout.tsx
 *
 * Not one of the four requested files -- the App Router will not boot
 * without a root layout at all; this is the minimum one, not a finished
 * one. Deliberately does NOT yet:
 *   - load next/font for the guest/ops font families tailwind.config.ts
 *     just declared (a follow-up, once real typography is prioritized;
 *     until then every screen renders in the system sans stack, as it
 *     already does today)
 *   - set `dir` based on locale (lib/i18n doesn't exist yet -- RULES.md
 *     §3's "RTL is structural from day one" applies to how components
 *     are WRITTEN, which is already true throughout this codebase; the
 *     actual runtime `dir` switch is separate, later work)
 *   - declare `data-surface`, per tailwind.config.ts's header note on
 *     why that mechanism is deliberately still undecided
 */

export const metadata: Metadata = {
  title: 'TableBells',
  description: 'Frictionless QR ordering and waiter-calling for UAE restaurants.',
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
