/**
 * src/lib/firebase/admin.ts
 *
 * The Firebase ADMIN SDK singleton. This is the file that finally gives
 * `order.service.ts`'s `firebase-admin/firestore` import somewhere real
 * to resolve against, and the file every Server Action in
 * `server/actions/*.ts` (ARCHITECTURE.md §2.7) imports instead of
 * `lib/firebase/client.ts` -- RULES.md §1.7/§1.8: Admin SDK only in
 * server code, one singleton, never re-initialized per file.
 *
 * CREDENTIALS -- two supported paths, tried in this order:
 *
 *   1. EXPLICIT SERVICE ACCOUNT via env vars (`FIREBASE_CLIENT_EMAIL` +
 *      `FIREBASE_PRIVATE_KEY` + a project id). This is the unified
 *      local + Vercel setup: the same three variables live in
 *      `.env.local` (gitignored -- see `.gitignore` `.env*.local`) and
 *      in the Vercel project's Environment Variables. No `gcloud`, no
 *      JSON key file in the repo, no system-level login. The private key
 *      is stored with literal `\n` escapes (how Vercel and dotenv keep
 *      multi-line values) and un-escaped back to real newlines here.
 *
 *   2. APPLICATION DEFAULT CREDENTIALS (`applicationDefault()`) -- used
 *      automatically when the explicit vars are absent. Resolves via
 *      Workload Identity on Cloud Run / Cloud Functions, or via a local
 *      `gcloud auth application-default login`. If NEITHER path is
 *      available, the first Admin SDK call throws "Could not load the
 *      default credentials" -- that error means: populate the
 *      `FIREBASE_*` vars in `.env.local` (or the Vercel dashboard).
 *
 * DIVERGENCE FROM ARCHITECTURE.md §8.6, stated plainly rather than
 * hidden: that section says "No service-account key files anywhere;
 * Cloud Run and Functions use Workload Identity." Path 1 above is a
 * deliberate, operator-requested departure so the app runs on Vercel and
 * on a fresh machine without GCP tooling. The key material lives ONLY in
 * environment variables that are never committed -- it is not a key file
 * checked into the tree, which is the specific thing §8.6 guards
 * against. Path 2 is still here and still preferred wherever real
 * Workload Identity exists; a future move back to it needs only to unset
 * the `FIREBASE_CLIENT_EMAIL` / `FIREBASE_PRIVATE_KEY` vars.
 *
 * REGION NOTE: same as client.ts -- `me-central2` is fixed at Firestore
 * database creation time in the GCP console, not a parameter this SDK
 * call accepts. Nothing to configure here.
 */

import {
  initializeApp,
  getApps,
  cert,
  applicationDefault,
  type App,
  type Credential,
} from 'firebase-admin/app';
import { getFirestore, type Firestore } from 'firebase-admin/firestore';
import { getAuth, type Auth } from 'firebase-admin/auth';

const projectId =
  process.env.FIREBASE_PROJECT_ID ||
  process.env.GOOGLE_CLOUD_PROJECT ||
  process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID ||
  undefined;

const clientEmail = process.env.FIREBASE_CLIENT_EMAIL || undefined;

/**
 * `.env` files and the Vercel dashboard store a PEM as a single line with
 * literal `\n` (and often wrapped in quotes). Turn it back into a real
 * multi-line key. `undefined` when the var is unset, so the caller can
 * fall through to Application Default Credentials.
 */
const privateKey = process.env.FIREBASE_PRIVATE_KEY
  ? process.env.FIREBASE_PRIVATE_KEY.replace(/^["']|["']$/g, '').replace(/\\n/g, '\n')
  : undefined;

function resolveCredential(): Credential {
  if (clientEmail && privateKey && projectId) {
    return cert({ projectId, clientEmail, privateKey });
  }
  // No explicit service-account vars -- Workload Identity (Cloud Run /
  // Functions) or a local `gcloud auth application-default login`.
  return applicationDefault();
}

function createAdminApp(): App {
  const existing = getApps();
  if (existing.length > 0) return existing[0];

  return initializeApp({
    credential: resolveCredential(),
    projectId,
  });
}

export const adminApp = createAdminApp();
export const adminDb: Firestore = getFirestore(adminApp);
export const adminAuth: Auth = getAuth(adminApp);
