/**
 * scripts/seed-staff-member.ts
 *
 * The staff-onboarding / PIN-reset tooling MEMORY.md §4 flagged as
 * missing: "`hashStaffPin` can produce a real, correct `pinHash` -- but
 * nothing in this codebase actually calls it to create or update a real
 * `members/{uid}` document yet." This is that caller. It is a local
 * operator tool, run by hand -- NOT an HTTP endpoint, NOT imported by the
 * app, NOT part of any deploy artifact.
 *
 * WHAT IT DOES: takes a plaintext PIN on the command line, hashes it with
 * the exact same `hashStaffPin` (`src/server/auth/staff-pin.ts`,
 * argon2id via hash-wasm) that `staff-login.service.ts` verifies against,
 * and writes a `tenants/{tenantId}/members/{uid}` document matching
 * ARCHITECTURE.md §1.6 field-for-field. After this runs, the real staff
 * login (`/api/auth/pin`, staff code + PIN) can finally be exercised
 * against real data.
 *
 * WHY A SCRIPT, NOT A SERVER FUNCTION: `members/{uid}` is
 * `allow write: if false` for every principal in `firestore.rules`
 * (staff included) -- only the Admin SDK can create one. A local script
 * running under Application Default Credentials is the lowest-surface way
 * to do that; a network endpoint that mints staff accounts is a much
 * larger thing to secure and is a Manager Console feature (MEMORY.md §3),
 * not this.
 *
 * CREDENTIALS: reuses the ONE Admin SDK singleton (`src/lib/firebase/
 * admin.ts`) rather than initialising its own -- RULES.md §1.8. That file
 * uses `applicationDefault()`, so before running this you need either
 *   - `gcloud auth application-default login` (writes short-lived ADC), or
 *   - `GOOGLE_APPLICATION_CREDENTIALS` pointing at a key file, or
 *   - the Firestore emulator: set `FIRESTORE_EMULATOR_HOST=localhost:8080`
 *     (writes are routed to the emulator; ADC still has to resolve, so a
 *     `gcloud auth application-default login` is still the simplest path).
 * Set `FIREBASE_PROJECT_ID` too (same var `admin.ts` reads).
 *
 * NEVER RUN. Like the rest of this repo, this has never been executed --
 * no `node_modules`, no Node in the build environment. Treat the first
 * real run as a genuine unknown.
 *
 * USAGE
 *   npm run seed:staff -- \
 *     --tenant tb_0492 --code 11 --name "Omar Kassem" --role cashier \
 *     --branch br_alserkal --pin 4917
 *
 *   # add --override for a manager/owner who holds void/ban authority
 *   npm run seed:staff -- --tenant tb_0492 --code 01 --name "Sarah Koenig" \
 *     --role manager --branch br_alserkal --pin 220814 --override
 *
 *   # reset only the PIN on an existing member (leaves every other field)
 *   npm run seed:staff -- --tenant tb_0492 --code 11 --pin 5540 --reset-pin
 *
 * FLAGS
 *   --tenant <id>     (required) tenant document id, e.g. tb_0492
 *   --code <str>      (required) staffCode, [A-Za-z0-9]{1,10} -- the id a
 *                     member types first at the lock screen
 *   --pin <digits>    (required) plaintext PIN, 4-8 digits. Hashed, never
 *                     stored or logged in the clear.
 *   --name <str>      display name (required unless --reset-pin)
 *   --role <role>     one of: owner manager cashier server kitchen
 *                     (required unless --reset-pin)
 *   --branch <id>     branch id the member is scoped to. Repeatable.
 *                     At least one required unless --reset-pin.
 *   --uid <id>        member document id. Default: derived as
 *                     `mbr_<tenant>_<code>` so re-running is idempotent.
 *   --job-title <str> optional; defaults to a label derived from --role
 *   --override        sets overrideAuth:true (void, discount, refund,
 *                     ghost-order ban). Default false.
 *   --reset-pin       update ONLY pinHash/pinUpdatedAt and clear the
 *                     lockout counters on an already-existing member.
 *                     Requires --tenant, --code (or --uid) and --pin.
 *   --dry-run         print the document that WOULD be written, write
 *                     nothing.
 */

import { FieldValue } from 'firebase-admin/firestore';
import { adminDb } from '../src/lib/firebase/admin';
import { hashStaffPin } from '../src/server/auth/staff-pin';

type StaffRole = 'owner' | 'manager' | 'cashier' | 'server' | 'kitchen';
const VALID_ROLES: readonly StaffRole[] = ['owner', 'manager', 'cashier', 'server', 'kitchen'];

const STAFF_CODE_PATTERN = /^[A-Za-z0-9]{1,10}$/;
const PIN_PATTERN = /^\d{4,8}$/;

const ROLE_DEFAULT_TITLE: Record<StaffRole, string> = {
  owner: 'Owner',
  manager: 'Floor Manager',
  cashier: 'Cashier',
  server: 'Floor Server',
  kitchen: 'Kitchen',
};

interface Args {
  flags: Set<string>;
  values: Map<string, string>;
  multi: Map<string, string[]>;
}

function parseArgs(argv: string[]): Args {
  const flags = new Set<string>();
  const values = new Map<string, string>();
  const multi = new Map<string, string[]>();
  const KNOWN_FLAGS = new Set(['override', 'reset-pin', 'dry-run']);
  const MULTI_KEYS = new Set(['branch']);

  for (let i = 0; i < argv.length; i += 1) {
    const token = argv[i];
    if (!token.startsWith('--')) {
      throw new Error(`Unexpected argument "${token}" -- every option must be --key value or a known --flag.`);
    }
    const key = token.slice(2);
    if (KNOWN_FLAGS.has(key)) {
      flags.add(key);
      continue;
    }
    const next = argv[i + 1];
    if (next === undefined || next.startsWith('--')) {
      throw new Error(`Option "--${key}" expects a value.`);
    }
    i += 1;
    if (MULTI_KEYS.has(key)) {
      multi.set(key, [...(multi.get(key) ?? []), next]);
    } else {
      values.set(key, next);
    }
  }

  return { flags, values, multi };
}

function requireOpt(value: string | undefined, name: string): string {
  if (value === undefined || value.trim() === '') {
    throw new Error(`Missing required option --${name}.`);
  }
  return value.trim();
}

function redactHash(encoded: string): string {
  // The stored value IS a hash, but there is no reason to splash the full
  // argon2id string across a terminal / CI log -- a prefix is enough to
  // confirm it is a well-formed PHC string.
  const head = encoded.slice(0, encoded.lastIndexOf('$') + 1);
  return `${head}<redacted>`;
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));
  const isResetPin = args.flags.has('reset-pin');
  const isDryRun = args.flags.has('dry-run');

  const tenantId = requireOpt(args.values.get('tenant'), 'tenant');
  const staffCode = requireOpt(args.values.get('code'), 'code');
  if (!STAFF_CODE_PATTERN.test(staffCode)) {
    throw new Error(`--code "${staffCode}" is not valid (expected ${STAFF_CODE_PATTERN}).`);
  }

  const pin = requireOpt(args.values.get('pin'), 'pin');
  if (!PIN_PATTERN.test(pin)) {
    throw new Error('--pin must be 4-8 digits.');
  }

  const uid = args.values.get('uid')?.trim() || `mbr_${tenantId}_${staffCode}`;
  const memberRef = adminDb.doc(`tenants/${tenantId}/members/${uid}`);

  const pinHash = await hashStaffPin(pin);

  if (isResetPin) {
    const existing = await memberRef.get();
    if (!existing.exists) {
      throw new Error(
        `--reset-pin: no member at tenants/${tenantId}/members/${uid}. ` +
          'Run without --reset-pin to create one, or check --uid/--code.',
      );
    }
    const patch = {
      pinHash,
      pinUpdatedAt: FieldValue.serverTimestamp(),
      pinFailedAttempts: 0,
      pinLockedUntil: null,
    };
    if (isDryRun) {
      console.log(`[dry-run] would MERGE into tenants/${tenantId}/members/${uid}:`);
      console.log(JSON.stringify({ ...patch, pinHash: redactHash(pinHash) }, null, 2));
      return;
    }
    await memberRef.set(patch, { merge: true });
    console.log(`PIN reset for ${uid} (staffCode ${staffCode}) in tenant ${tenantId}. Lockout counters cleared.`);
    return;
  }

  const displayName = requireOpt(args.values.get('name'), 'name');
  const role = requireOpt(args.values.get('role'), 'role') as StaffRole;
  if (!VALID_ROLES.includes(role)) {
    throw new Error(`--role "${role}" is not one of: ${VALID_ROLES.join(' ')}.`);
  }
  const branchIds = args.multi.get('branch') ?? [];
  if (branchIds.length === 0) {
    throw new Error('At least one --branch is required.');
  }
  const jobTitle = args.values.get('job-title')?.trim() || ROLE_DEFAULT_TITLE[role];
  const overrideAuth = args.flags.has('override');

  // Field set is ARCHITECTURE.md §1.6, and `staff-login.service.ts`'s
  // `MemberDoc` reads a subset of exactly these names.
  const memberDoc = {
    uid,
    displayName,
    staffCode,
    role,
    jobTitle,
    branchIds,
    zoneIds: [] as string[],
    stationIds: [] as string[],
    pinHash,
    pinUpdatedAt: FieldValue.serverTimestamp(),
    pinFailedAttempts: 0,
    pinLockedUntil: null,
    overrideAuth,
    status: 'active' as const,
    lastActiveAt: null,
    createdAt: FieldValue.serverTimestamp(),
    createdBy: `seed-script:${process.env.USER ?? process.env.USERNAME ?? 'unknown'}`,
  };

  if (isDryRun) {
    console.log(`[dry-run] would WRITE tenants/${tenantId}/members/${uid}:`);
    console.log(JSON.stringify({ ...memberDoc, pinHash: redactHash(pinHash) }, null, 2));
    return;
  }

  // merge:false -- a full create/replace. Re-running with the same
  // --tenant/--code (hence same derived uid) deliberately overwrites,
  // so this doubles as "fix the fields I got wrong last time."
  await memberRef.set(memberDoc, { merge: false });

  console.log('Wrote staff member:');
  console.log(
    JSON.stringify(
      {
        path: `tenants/${tenantId}/members/${uid}`,
        displayName,
        staffCode,
        role,
        jobTitle,
        branchIds,
        overrideAuth,
        pinHash: redactHash(pinHash),
      },
      null,
      2,
    ),
  );
  console.log(`\nThis member can now sign in at /<tenantSlug>/lock with staff code ${staffCode} and the PIN you supplied.`);
}

main()
  .then(() => process.exit(0))
  .catch((error: unknown) => {
    console.error(`\nseed-staff-member failed: ${error instanceof Error ? error.message : String(error)}`);
    process.exit(1);
  });
