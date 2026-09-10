/**
 * scripts/grant-platform-admin.ts
 *
 * Grants (or revokes) the `plat: true` Firebase Auth custom claim that
 * `/api/admin/session` and `firestore.rules`' `isPlatform()` check — the
 * one thing that turns an ordinary Firebase account into the founder
 * super-admin. Run once, by hand.
 *
 * Needs the Admin SDK, so `FIREBASE_CLIENT_EMAIL` + `FIREBASE_PRIVATE_KEY`
 * (+ `FIREBASE_PROJECT_ID`) must be in `.env.local` — the same vars
 * `src/lib/firebase/admin.ts` reads. This script loads `.env.local`
 * itself (tsx doesn't).
 *
 * USAGE
 *   npm run grant:admin -- --email you@example.com --password 'a-strong-one'
 *     → creates the Firebase user if it doesn't exist, then sets plat:true
 *
 *   npm run grant:admin -- --email you@example.com
 *     → user must already exist; just sets plat:true
 *
 *   npm run grant:admin -- --email you@example.com --revoke
 *     → removes the claim
 *
 * After running, sign in at /admin/login with that email + password.
 * (An existing signed-in session must sign out and back in for a new
 * claim to appear in its ID token.)
 */

import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

function loadEnvLocal(): void {
  let raw: string;
  try {
    raw = readFileSync(resolve(process.cwd(), '.env.local'), 'utf8');
  } catch {
    throw new Error('grant-platform-admin: run this from the project root (C:\\Tablesbell); .env.local not found.');
  }
  for (const line of raw.split(/\r?\n/)) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
    if (!m) continue;
    let val = m[2];
    if ((val.startsWith('"') && val.endsWith('"')) || (val.startsWith("'") && val.endsWith("'"))) {
      val = val.slice(1, -1);
    }
    if (!(m[1] in process.env)) process.env[m[1]] = val;
  }
}

function arg(name: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? process.argv[i + 1] : undefined;
}
const hasFlag = (name: string) => process.argv.includes(`--${name}`);

async function main(): Promise<void> {
  loadEnvLocal();

  const email = arg('email');
  const password = arg('password');
  const revoke = hasFlag('revoke');
  if (!email) throw new Error('Missing --email.');

  if (!process.env.FIREBASE_CLIENT_EMAIL || !process.env.FIREBASE_PRIVATE_KEY) {
    throw new Error(
      'FIREBASE_CLIENT_EMAIL / FIREBASE_PRIVATE_KEY not set in .env.local — this script needs the Admin SDK.',
    );
  }

  // Import AFTER env is loaded (admin.ts reads process.env at module load).
  const { adminAuth } = await import('../src/lib/firebase/admin');

  let user;
  try {
    user = await adminAuth.getUserByEmail(email);
  } catch {
    if (!password) {
      throw new Error(
        `No Firebase user for ${email}. Re-run with --password '…' to create one, or add the user in the Firebase console first.`,
      );
    }
    user = await adminAuth.createUser({ email, password, emailVerified: true });
    console.log(`Created Firebase user ${email} (uid ${user.uid}).`);
  }

  const nextClaims = { ...(user.customClaims ?? {}) };
  if (revoke) {
    delete (nextClaims as Record<string, unknown>).plat;
  } else {
    (nextClaims as Record<string, unknown>).plat = true;
  }
  await adminAuth.setCustomUserClaims(user.uid, nextClaims);
  await adminAuth.revokeRefreshTokens(user.uid);

  console.log(
    revoke
      ? `Revoked platform claim from ${email}.`
      : `Granted plat:true to ${email} (uid ${user.uid}). Sign in at /admin/login.`,
  );
}

main()
  .then(() => process.exit(0))
  .catch((err: unknown) => {
    console.error(`\ngrant-platform-admin failed: ${err instanceof Error ? err.message : String(err)}`);
    process.exit(1);
  });
