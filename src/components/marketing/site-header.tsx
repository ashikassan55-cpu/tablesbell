'use client';

/**
 * src/components/marketing/site-header.tsx
 *
 * Fixed public marketing header for the landing page (`src/app/page.tsx`).
 * Client component only for the mobile menu toggle and smooth-scroll
 * anchor handling; every link is a plain in-page anchor except the staff
 * entry point, which goes to the seeded demo tenant's PIN screen.
 */

import { useState } from 'react';
import Link from 'next/link';
import { Menu, X, LockKeyhole } from 'lucide-react';

const NAV = [
  { label: 'How it works', href: '#how' },
  { label: 'Why TableBells', href: '#why' },
  { label: 'Pricing', href: '#pricing' },
  { label: 'Testimonials', href: '#testimonials' },
  { label: 'Contact', href: '#demo' },
] as const;

export function SiteHeader() {
  const [open, setOpen] = useState(false);

  return (
    <header className="fixed inset-x-0 top-0 z-50 border-b border-guest-border-warm bg-guest-canvas/90 backdrop-blur-xl">
      <div className="mx-auto flex h-16 max-w-6xl items-center justify-between px-4 sm:px-6">
        <Link href="/" className="font-heading text-xl font-extrabold tracking-tight text-guest-text">
          Table<span className="text-guest-primary">Bells</span>
        </Link>

        <nav className="hidden items-center gap-1 lg:flex">
          {NAV.map((item) => (
            <a
              key={item.href}
              href={item.href}
              className="rounded-lg px-3 py-2 text-sm font-semibold text-guest-text-muted transition-colors hover:bg-white hover:text-guest-text"
            >
              {item.label}
            </a>
          ))}
        </nav>

        <div className="flex items-center gap-2">
          <Link
            href="/demo/lock"
            className="hidden items-center gap-1.5 rounded-lg px-3 py-2 text-sm font-semibold text-guest-text-muted transition-colors hover:text-guest-text sm:inline-flex"
          >
            <LockKeyhole className="h-4 w-4" />
            Staff login
          </Link>
          <a
            href="#demo"
            className="hidden rounded-xl bg-guest-primary px-4 py-2.5 text-sm font-bold text-white shadow-sm transition-colors hover:bg-[#d24e33] sm:inline-flex"
          >
            Book a 5-min demo
          </a>
          <button
            type="button"
            onClick={() => setOpen((v) => !v)}
            aria-label={open ? 'Close menu' : 'Open menu'}
            className="inline-flex h-10 w-10 items-center justify-center rounded-lg border border-guest-border-warm bg-white text-guest-text lg:hidden"
          >
            {open ? <X className="h-5 w-5" /> : <Menu className="h-5 w-5" />}
          </button>
        </div>
      </div>

      {open ? (
        <div className="border-t border-guest-border-warm bg-guest-canvas px-4 py-3 lg:hidden">
          <nav className="flex flex-col gap-1">
            {NAV.map((item) => (
              <a
                key={item.href}
                href={item.href}
                onClick={() => setOpen(false)}
                className="rounded-lg px-3 py-2.5 text-sm font-semibold text-guest-text"
              >
                {item.label}
              </a>
            ))}
            <Link
              href="/demo/lock"
              className="rounded-lg px-3 py-2.5 text-sm font-semibold text-guest-text-muted"
            >
              Staff login
            </Link>
            <a
              href="#demo"
              onClick={() => setOpen(false)}
              className="mt-1 rounded-xl bg-guest-primary px-3 py-2.5 text-center text-sm font-bold text-white"
            >
              Book a 5-min demo
            </a>
          </nav>
        </div>
      ) : null}
    </header>
  );
}
