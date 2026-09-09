'use client';

/**
 * src/components/providers/guest-session-provider.tsx
 *
 * The client-side half of the guest session boot sequence. The server
 * half (`app/(guest)/t/[slug]/page.tsx`) runs the real chain --
 * `resolveTableSlug` → `checkGuestBoot` → `resolveGuestSession` →
 * `mintGuestSessionToken` -- entirely server-side with the Admin SDK,
 * and hands this component exactly two things: a Firebase Auth custom
 * token, and the already-resolved location/session context that went
 * into minting it. This component's only job is turning that custom
 * token into an actual signed-in client SDK session, and making the
 * resolved context available to every descendant via React context --
 * `useLiveMenu` and (in a later pass) the cart's real submit path both
 * need `tenantId`/`branchId`/`sessionId` to construct the right
 * Firestore paths.
 *
 * WHY THIS HAS TO BE A CLIENT COMPONENT, stated plainly: `firebase/auth`'s
 * `signInWithCustomToken` only exists in the client SDK
 * (`lib/firebase/client.ts`) — RULES.md §1.7 draws that boundary
 * deliberately. The custom token itself is minted server-side (Admin
 * SDK, `mint-guest-session.ts`) and passed down as a plain string prop;
 * nothing about the Admin SDK ever runs in the browser.
 *
 * WHAT THIS DOES NOT DO, named rather than silently absent: it signs in
 * exactly once, on mount, and never again. `mint-guest-session.ts`'s own
 * header already flags that the ~6-hour guest session lifetime
 * (ARCHITECTURE.md §1.4) has no enforcement mechanism anywhere in this
 * chain yet -- this component doesn't invent one either. A custom
 * token's underlying ID token auto-refreshes on its own normal ~1-hour
 * cycle once signed in (ordinary Firebase Auth behavior, unrelated to
 * this file), but there is no logic here for "the session document
 * itself expired, re-run the boot chain and sign in again." That's a
 * real gap for a future pass, not an oversight to paper over with a
 * comment claiming otherwise.
 */

import { createContext, useContext, useEffect, useState, type ReactNode } from 'react';
import { signInWithCustomToken } from 'firebase/auth';
import { auth } from '@/lib/firebase/client';

export interface GuestSessionContext {
  tenantId: string;
  branchId: string;
  tableId: string;
  tableCode: string;
  zoneId: string;
  sessionId: string;
  hostUid: string;
  partyLabel: string;
  /**
   * Resolved server-side, once, from `branches/{b}.menuVersion` --
   * deliberately NOT a live-listened field itself. ARCHITECTURE.md §2.4
   * states a full guest menu load is exactly 2 reads
   * (`menuPublished/v{n}` + `live/availability`); keeping the version
   * number itself live would make it 3, and would mean this whole
   * provider's context could change out from under `useLiveMenu`
   * mid-session. A menu republished while a guest already has this page
   * open is picked up on their next reload, not live -- a deliberate,
   * budget-driven trade-off, not a bug.
   */
  menuVersion: number;
  /**
   * ADR-11 — the branch's currency code + VAT rate (parts-per-million),
   * resolved server-side alongside `menuVersion` from `branches/{b}.
   * settings`. `currency` drives `formatMoney` on the guest menu / cart;
   * `vatPpm` is here for a future "incl. X% VAT" line. Same "resolved
   * once, not live-listened" trade-off as `menuVersion` — a settings
   * change lands on the guest's next reload.
   */
  currency: string;
  vatPpm: number;
}

export interface GuestSessionContextValue extends GuestSessionContext {
  /** True once `signInWithCustomToken` has resolved. Every Firestore
   *  listener gated on session context (`useLiveMenu`, and the cart's
   *  eventual real submit path) MUST wait for this -- starting a
   *  listener before sign-in completes hits `firestore.rules`'
   *  `isGuest(t, b)` check with no `request.auth` at all yet, surfacing
   *  as a spurious permission-denied error rather than the transient
   *  "still signing in" state it actually is. */
  authReady: boolean;
  authError: string | null;
}

const Context = createContext<GuestSessionContextValue | null>(null);

interface GuestSessionProviderProps {
  customToken: string;
  context: GuestSessionContext;
  children: ReactNode;
}

export function GuestSessionProvider({ customToken, context, children }: GuestSessionProviderProps) {
  const [authReady, setAuthReady] = useState(false);
  const [authError, setAuthError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setAuthReady(false);
    setAuthError(null);

    signInWithCustomToken(auth, customToken)
      .then(() => {
        if (!cancelled) setAuthReady(true);
      })
      .catch((error: unknown) => {
        if (cancelled) return;
        setAuthError(error instanceof Error ? error.message : 'Sign-in failed.');
      });

    return () => {
      cancelled = true;
    };
    // `customToken` is the only real dependency -- a fresh token (e.g. a
    // future re-mint after expiry) should trigger a fresh sign-in.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [customToken]);

  const value: GuestSessionContextValue = { ...context, authReady, authError };

  return <Context.Provider value={value}>{children}</Context.Provider>;
}

export function useGuestSession(): GuestSessionContextValue {
  const value = useContext(Context);
  if (!value) {
    throw new Error('useGuestSession() must be called within a <GuestSessionProvider>.');
  }
  return value;
}
