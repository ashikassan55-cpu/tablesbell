/**
 * src/lib/firebase/admin.ts
 *
 * The Firebase ADMIN SDK singleton. This is the file that finally gives
 * `order.service.ts`'s `firebase-admin/firestore` import somewhere real
 * to resolve against, and the file every not-yet-built Server Action in
 * `server/actions/*.ts` (ARCHITECTURE.md §2.7) will import instead of
 * `lib/firebase/client.ts` -- RULES.md §1.7/§1.8: Admin SDK only in
 * server code, one singleton, never re-initialized per file.
 *
 * CREDENTIALS -- the one decision in this file that had an existing,
 * binding answer to get right: ARCHITECTURE.md §8.6 states explicitly,
 * "No service-account key files anywhere; Cloud Run and Functions use
 * Workload Identity." This uses `applicationDefault()`, not `cert()`
 * with a downloaded JSON key, on purpose:
 *   - In Cloud Run / Cloud Functions, Application Default Credentials
 *     resolve automatically via the deployed service's Workload Identity
 *     -- no key file, ever, in production.
 *   - Locally, the same call resolves via `gcloud auth application-
 *     default login`, which writes short-lived credentials to a
 *     standard location OUTSIDE this repository -- never a project file
 *     that could be accidentally committed.
 * A version of this file that called `cert(require('./service-account.json'))`
 * would directly contradict an already-approved security decision, not
 * merely be a style choice.
 *
 * REGION NOTE: same as client.ts -- `me-central2` is fixed at Firestore
 * database creation time in the GCP console, not a parameter this SDK
 * call accepts. Nothing to configure here.
 */

import { initializeApp, getApps, applicationDefault, type App } from 'firebase-admin/app';
import { getFirestore, type Firestore } from 'firebase-admin/firestore';
import { getAuth, type Auth } from 'firebase-admin/auth';

function createAdminApp(): App {
  const existing = getApps();
  if (existing.length > 0) return existing[0];

  return initializeApp({
    credential: applicationDefault(),
    projectId: process.env.FIREBASE_PROJECT_ID,
  });
}

export const adminApp = createAdminApp();
export const adminDb: Firestore = getFirestore(adminApp);
export const adminAuth: Auth = getAuth(adminApp);
