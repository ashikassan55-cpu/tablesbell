/**
 * src/server/auth/staff-pin.ts
 *
 * `hashStaffPin`/`verifyStaffPin` — the real argon2id implementation
 * ARCHITECTURE.md §1.6 names (`lib/auth/pin.ts` in its own directory
 * listing: "argon2id + device secret"; the device-secret half is a
 * separate, NOT-YET-BUILT factor — see this file's own security note
 * below and `staff-login.service.ts`'s header for exactly what that
 * means for what this pass actually secures).
 *
 * LIBRARY CHOICE: `hash-wasm`, not the more commonly-reached-for `argon2`
 * npm package. `argon2` wraps NATIVE bindings that have to be compiled
 * for the exact target OS/architecture at install time -- a real,
 * concrete deployment risk in a serverless/Cloud Functions context where
 * the build environment and the runtime environment aren't guaranteed to
 * match. `hash-wasm` runs the same argon2id algorithm as pure WebAssembly
 * -- no native compilation step, works identically wherever Node runs.
 * The trade-off is real (WASM argon2 is measurably slower than a tuned
 * native binding) but acceptable here: a PIN pad tolerates a few hundred
 * extra milliseconds far better than a production deploy tolerates a
 * native-module build failure.
 *
 * A REAL SCHEMA CORRECTION, not a silent deviation: ARCHITECTURE.md §1.6
 * lists `pinHash, pinSalt` as two separate fields ("argon2id, per-user
 * salt"). The standard, well-tested way to store an argon2id hash is a
 * single self-describing PHC-format string
 * (`$argon2id$v=19$m=...,t=...,p=...$<salt>$<hash>`) -- the salt is
 * embedded in that string, generated fresh per call by the algorithm
 * itself. Splitting it into a separate `pinSalt` field would mean
 * hand-managing raw salt/hash byte encoding independently, a strictly
 * more error-prone path for zero real benefit -- `hash-wasm`'s own
 * `argon2Verify` only ever wants the password and that one encoded
 * string back. `pinHash` below IS that encoded string; `pinSalt` is not
 * written or read anywhere in this codebase as a result. ARCHITECTURE.md
 * §1.6 should be patched to drop `pinSalt` as its own field -- flagged
 * here and in MEMORY.md rather than done silently, since it's a genuine
 * correction to an already-reviewed schema, not a typo fix.
 *
 * SECURITY NOTE, worth restating precisely rather than assumed:
 * ARCHITECTURE.md frames a PIN as "a second factor, never a credential
 * ... alone it is worthless" -- true ONLY once the third factor (a
 * registered terminal's device secret) also gates every attempt. That
 * factor is NOT built anywhere in this codebase yet (`devices/{deviceId}`
 * registration doesn't exist). Until it does, THIS hash and the
 * lockout policy below are the entire defense against a brute-forced
 * 4-digit PIN, not one layer of three. The parameters chosen here lean
 * deliberately conservative for exactly that reason -- see the constants
 * below.
 */

import { argon2id, argon2Verify } from 'hash-wasm';

/**
 * Deliberately on the stronger end of common argon2id guidance (broadly
 * in the neighborhood of OWASP's baseline recommendation, adjusted
 * upward given the missing third factor noted above) -- NOT benchmarked
 * against real hardware in this environment (no Node runtime available
 * here at all, let alone one to time a WASM hash against). Treat these
 * as a documented starting point that MUST be measured against real
 * request latency before this ships, not a tuned final answer.
 */
const ARGON2ID_PARAMS = {
  parallelism: 1,
  iterations: 3,
  memorySize: 65536, // 64 MiB
  hashLength: 32,
} as const;

/**
 * Produces the full, self-contained PHC-format string to store as
 * `members/{uid}.pinHash`. Never called from a live PIN-entry request --
 * only from staff onboarding/PIN-reset tooling (not built this pass; see
 * MEMORY.md for what's still needed to actually seed real `members`
 * documents).
 */
export async function hashStaffPin(pin: string): Promise<string> {
  return argon2id({
    password: pin,
    salt: crypto.getRandomValues(new Uint8Array(16)),
    ...ARGON2ID_PARAMS,
    outputType: 'encoded',
  });
}

/**
 * Verifies a candidate PIN against a stored, encoded argon2id hash.
 * Returns `false` for a malformed/foreign-format `storedHash` rather
 * than throwing -- a corrupted or manually-edited Firestore document
 * should fail closed (login rejected) exactly like a wrong PIN, not
 * surface as a 500.
 */
export async function verifyStaffPin(pin: string, storedHash: string): Promise<boolean> {
  try {
    return await argon2Verify({ password: pin, hash: storedHash });
  } catch {
    return false;
  }
}
