/**
 * src/lib/firebase/client.ts
 *
 * The Firebase CLIENT SDK singleton -- ARCHITECTURE.md §7.2's named path.
 * This is the file every "simulated transport" comment across the
 * codebase (`cart-checkout-view.tsx`, `waiter-menu-entry.tsx`, and every
 * KDS/Cashier mock action handler -- see MEMORY.md §4) has been pointing
 * at: it doesn't exist until this pass, which is why none of them could
 * be wired for real before now.
 *
 * RULES.md §1.7: "The Firebase client SDK is used exclusively inside
 * 'use client' components running in the browser." This file is that
 * boundary's single entry point -- nothing here should ever be imported
 * from a Server Component, a Server Action, or a Route Handler; those
 * import `lib/firebase/admin.ts` instead.
 *
 * REGION NOTE: ARCHITECTURE.md fixes the Firestore region at
 * `me-central2`, immutable once set -- but that is a property of the
 * actual Firestore DATABASE, chosen once at creation time in the
 * Firebase/GCP console. The client SDK's `getFirestore(app)` call takes
 * no region argument for a project's default database; there is no
 * client-side knob to set or verify it here. Do not add one -- the SDK
 * has no parameter that would do anything with it.
 *
 * SSR GUARD, the one genuinely non-obvious correctness issue in this
 * file: Next.js evaluates the module graph of a 'use client' component
 * on the SERVER too, during the initial render pass, before hydration.
 * `persistentLocalCache` (IndexedDB-backed) and Firebase App Check
 * (reCAPTCHA, needs the DOM) both throw or misbehave outside a real
 * browser. Every browser-only initialization below is gated behind
 * `typeof window !== 'undefined'`, with a plain memory-cache Firestore
 * instance as the SSR-safe fallback.
 */

import { initializeApp, getApps, getApp, type FirebaseApp } from 'firebase/app';
import { getAuth, type Auth } from 'firebase/auth';
import {
  initializeFirestore,
  getFirestore,
  persistentLocalCache,
  persistentMultipleTabManager,
  type Firestore,
} from 'firebase/firestore';

const firebaseConfig = {
  apiKey: process.env.NEXT_PUBLIC_FIREBASE_API_KEY,
  authDomain: process.env.NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN,
  projectId: process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID,
  storageBucket: process.env.NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET,
  messagingSenderId: process.env.NEXT_PUBLIC_FIREBASE_MESSAGING_SENDER_ID,
  appId: process.env.NEXT_PUBLIC_FIREBASE_APP_ID,
};

function assertConfigPresent() {
  const missing = Object.entries(firebaseConfig)
    .filter(([, value]) => !value)
    .map(([key]) => key);

  if (missing.length > 0) {
    // Thrown, not silently defaulted: a half-configured Firebase client
    // fails in confusing, hard-to-diagnose ways deep inside the SDK.
    // Failing loudly here, at the one place config is read, is cheaper
    // to debug than a stack trace from inside `initializeApp`.
    throw new Error(
      `lib/firebase/client.ts: missing required env var(s): ${missing.join(', ')}. ` +
        'Copy .env.local.example to .env.local and fill in your Firebase project config.',
    );
  }
}

function createApp(): FirebaseApp {
  if (getApps().length > 0) return getApp();
  assertConfigPresent();
  return initializeApp(firebaseConfig);
}

export const app = createApp();
export const auth: Auth = getAuth(app);

/**
 * Persistent, multi-tab-aware local cache in the browser (ARCHITECTURE.md
 * §2.8: "enable persistentLocalCache with persistentMultipleTabManager on
 * staff consoles") -- this is what lets a KDS/Cashier/Waiter screen keep
 * showing its last-known state, read-only, when a tablet drops Wi-Fi mid-
 * shift. In any non-browser evaluation (SSR), falls back to the default
 * in-memory Firestore instance, since IndexedDB doesn't exist there.
 */
export const db: Firestore =
  typeof window !== 'undefined'
    ? initializeFirestore(app, {
        localCache: persistentLocalCache({ tabManager: persistentMultipleTabManager() }),
      })
    : getFirestore(app);

/**
 * Firebase App Check (ARCHITECTURE.md §8.5) -- mandatory before any
 * client write reaches Firestore in production, but deliberately NOT
 * auto-initialized at module load here. Two reasons:
 *   1. It needs a real reCAPTCHA v3 site key
 *      (NEXT_PUBLIC_RECAPTCHA_SITE_KEY), which does not exist in this
 *      scaffold and must not be silently no-op'd past.
 *   2. §8.5's own rollout order matters: register the app, ship every
 *      client with this initialized, watch the "unverified requests"
 *      metric fall to ~0, THEN flip enforcement on server-side.
 *      Enforcing before every client has this wired strands already-
 *      loaded sessions. Call `initClientAppCheck()` explicitly, once,
 *      from the root layout or a top-level provider -- not from this
 *      module's own load -- so that sequencing stays a deliberate choice
 *      made in one visible place, not a side effect of importing `db`.
 */
export async function initClientAppCheck() {
  if (typeof window === 'undefined') return;

  const siteKey = process.env.NEXT_PUBLIC_RECAPTCHA_SITE_KEY;
  if (!siteKey) {
    console.warn('[App Check] NEXT_PUBLIC_RECAPTCHA_SITE_KEY not set -- App Check not initialized.');
    return;
  }

  const { initializeAppCheck, ReCaptchaV3Provider } = await import('firebase/app-check');
  initializeAppCheck(app, {
    provider: new ReCaptchaV3Provider(siteKey),
    isTokenAutoRefreshEnabled: true,
  });
}
