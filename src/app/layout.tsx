import type { Metadata } from 'next';
import type { ReactNode } from 'react';
import { Plus_Jakarta_Sans, Inter } from 'next/font/google';
import './globals.css';

/**
 * src/app/layout.tsx
 *
 * The App Router root layout. Loads the two families `tailwind.config.ts`
 * declared (RULES.md §3: "Plus Jakarta Sans headings, Inter body") via
 * `next/font/google` and exposes them as CSS variables -- `font-heading`
 * / `font-body` resolve to them, everything else inherits Inter from
 * `<body>`. Still deliberately does NOT switch `dir` by locale (lib/i18n
 * is separate, later work) or declare `data-surface`.
 */

const heading = Plus_Jakarta_Sans({
  subsets: ['latin'],
  weight: ['500', '600', '700', '800'],
  variable: '--font-heading',
  display: 'swap',
});

const body = Inter({
  subsets: ['latin'],
  weight: ['400', '500', '600', '700'],
  variable: '--font-body',
  display: 'swap',
});

export const metadata: Metadata = {
  metadataBase: new URL('https://tablesbell.vercel.app'),
  title: {
    default: 'TableBells — Smart QR Ordering & Waiter Call for UAE Cafés',
    template: '%s · TableBells',
  },
  description:
    'Let guests scan, order, and call their server from their own phones. Zero hardware, setup in 15 minutes, from AED 199/month. Built for independent cafés and eateries across the UAE.',
  openGraph: {
    title: 'TableBells — Smart QR Ordering & Waiter Call for UAE Cafés',
    description:
      'Guests scan, order, and call their server from their own phones. Zero hardware, from AED 199/month.',
    type: 'website',
  },
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en" className={`${heading.variable} ${body.variable}`}>
      <body className="font-body">{children}</body>
    </html>
  );
}
