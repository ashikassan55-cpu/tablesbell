'use client';

/**
 * src/components/providers/clock-provider.tsx
 *
 * ONE skew-corrected 1Hz tick for every timer on a KDS screen
 * (ARCHITECTURE.md §2.8, §7.2). A ticket card must NEVER run its own
 * `setInterval` — that is the specific thing this file exists to prevent:
 * one shared tick driving every card, not one timer per ticket. Storing a
 * countdown instead of deriving it would cost ~86k writes/day/ticket;
 * giving every card its own interval is the client-side version of the
 * same mistake.
 *
 * Clock-skew correction — measuring the offset between this device's
 * clock and the server's, ARCHITECTURE.md §2.8's `useServerClock()` —
 * needs a real round-trip against a server timestamp to measure against.
 * No such endpoint exists in this workspace yet, so `offsetMs` is fixed
 * at 0 for now. The shape is still correct: every consumer already reads
 * `now` from this context rather than calling `Date.now()` itself, so
 * wiring the real measurement later is a change to this one file, not to
 * anything that calls `useNow()`.
 */

import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';

interface ClockContextValue {
  /** Best estimate of the true (server-corrected) current time, epoch ms. */
  now: number;
}

const ClockContext = createContext<ClockContextValue | null>(null);

export function ClockProvider({ children }: { children: ReactNode }) {
  const [tick, setTick] = useState(() => Date.now());

  // TODO(useServerClock): replace this fixed 0 with a measured offset
  // against a real server timestamp, re-measured every ~10 minutes, per
  // ARCHITECTURE.md §2.8.
  const offsetMs = 0;

  useEffect(() => {
    const interval = window.setInterval(() => setTick(Date.now()), 1000);
    return () => window.clearInterval(interval);
  }, []);

  const value = useMemo<ClockContextValue>(() => ({ now: tick + offsetMs }), [tick]);

  return <ClockContext.Provider value={value}>{children}</ClockContext.Provider>;
}

export function useNow(): number {
  const context = useContext(ClockContext);
  if (!context) {
    throw new Error('useNow() must be called within a <ClockProvider>.');
  }
  return context.now;
}
