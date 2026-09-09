# `scripts/` — local operator tooling

Hand-run scripts. Not imported by the app, not part of any deploy artifact,
not an HTTP surface. Executed with `tsx` (dev dependency) via the root
`package.json` scripts.

> Same caveat as the rest of this repo: **nothing here has ever been run.**
> There is no `node_modules` and no Node in the environment this was built
> in. Treat the first real execution as a genuine unknown.

## `seed-staff-member.ts` — create / PIN-reset a real `members/{uid}`

Closes the MEMORY.md §4 gap "no staff-member seeding/PIN-reset tooling
exists." Hashes a plaintext PIN with `src/server/auth/staff-pin.ts`'s
`hashStaffPin` (argon2id, the exact function `staff-login.service.ts`
verifies against) and writes a `tenants/{tenantId}/members/{uid}` document
matching `ARCHITECTURE.md` §1.6. `members/{uid}` is `allow write: if false`
for every principal in `firestore.rules`, so only an Admin SDK caller —
this script — can create one.

### Prerequisites

The script reuses the one Admin SDK singleton (`src/lib/firebase/admin.ts`),
which authenticates with `applicationDefault()`. Before running, set up
**one** of:

```bash
gcloud auth application-default login        # simplest; writes short-lived ADC
# or
export GOOGLE_APPLICATION_CREDENTIALS=/path/to/key.json
```

Also export the project id (same var `admin.ts` reads):

```bash
export FIREBASE_PROJECT_ID=<your-firebase-project-id>
```

To target the **Firestore emulator** instead of the live project:

```bash
export FIRESTORE_EMULATOR_HOST=localhost:8080
```

(ADC still has to resolve even against the emulator, so keep the
`gcloud auth application-default login` step.)

### Usage

```bash
# create a cashier
npm run seed:staff -- \
  --tenant tb_0492 --code 11 --name "Omar Kassem" --role cashier \
  --branch br_alserkal --pin 4917

# create a manager who holds void / ban authority
npm run seed:staff -- \
  --tenant tb_0492 --code 01 --name "Sarah Koenig" --role manager \
  --branch br_alserkal --pin 220814 --override

# reset only the PIN on an existing member, clearing the lockout counters
npm run seed:staff -- --tenant tb_0492 --code 11 --pin 5540 --reset-pin

# see what would be written without writing it
npm run seed:staff -- --tenant tb_0492 --code 11 --name "Omar Kassem" \
  --role cashier --branch br_alserkal --pin 4917 --dry-run
```

The default member document id is `mbr_<tenant>_<code>`, so re-running with
the same `--tenant` / `--code` overwrites the same document (useful for
fixing a field you got wrong). Pass `--uid` to override.

The plaintext PIN is hashed immediately and **never** written or logged in
the clear; the script prints only a redacted hash prefix.

After a successful run, that member can sign in at `/<tenantSlug>/lock`
with their staff code and PIN.
