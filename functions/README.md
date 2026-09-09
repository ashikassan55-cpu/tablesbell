# `functions/` — TableBells Cloud Functions v2

A genuinely separate npm package from the root Next.js app — its own
`package.json`, its own `node_modules` once installed, its own deploy
target (`firebase deploy --only functions`). Not a workspace of the root
package; Firebase Functions deployment zips up exactly this directory.

## Why this package needs to reach outside itself

The one real function here, `priceOrderRequestTrigger`
(`src/triggers/price-order-request.ts`), calls `priceOrderRequest()` —
which already lives in the main app, at
`../src/server/services/order.service.ts`, and stays there rather than
being duplicated into this package. Two reasons that's the right call, not
a shortcut:

1. `order.service.ts` is explicitly framework-free (its own header:
   "pure domain logic ... unit-tested") specifically so it can be called
   from either this trigger OR a future internal admin tool inside the
   Next.js server runtime, without two copies of pricing logic existing
   anywhere.
2. A second copy would be exactly the duplicated-business-logic problem
   RULES.md §4.9 exists to prevent — and for something this
   security/financial-sensitive (the sole price authority), a drift
   between two copies is a much worse failure mode than in most code.

That's why `functions/tsconfig.json`'s `rootDir` is set to `..` (the
workspace root) instead of `.` — a plain `tsc` compile refuses to emit a
file that imports something outside its configured `rootDir`, so the
config has to acknowledge this package's real dependency graph reaches
into `../src/server/services/`.

**The consequence**, so the compiled output layout isn't a surprise:
because `rootDir` is the workspace root, `tsc`'s output mirrors that full
path under `functions/lib/`, not a flat `functions/lib/`:

```
functions/lib/functions/src/index.js              <- functions/package.json's "main"
functions/lib/functions/src/triggers/price-order-request.js
functions/lib/src/server/services/order.service.js
functions/lib/src/server/services/pricing.service.js
functions/lib/src/lib/firebase/admin.js
```

This is a known, standard consequence of this pattern (a Cloud Functions
package importing shared TypeScript source from a sibling directory), not
a misconfiguration — `npm run build` from inside `functions/` reproduces
it every time, deterministically.

## Why the shared files use relative imports, not `@/*`

`order.service.ts` and this package's own files import each other and
`lib/firebase/admin.ts` via relative paths
(`../../../src/server/services/order.service`, etc.), NOT the `@/*` alias
every other file in `src/server/services/` uses. This package is compiled
by a plain `tsc` invocation, not bundled by Next.js/webpack — plain `tsc`
does not rewrite path aliases in its emitted JavaScript. An aliased import
would type-check fine and then fail at actual Cloud Function *runtime*
with `Cannot find module '@/lib/firebase/admin'` — a failure invisible
until the function is actually invoked in production, not caught by
`tsc --noEmit` or a local build. `order.service.ts`'s own header carries
the full version of this reasoning.

## What is NOT set up yet, named rather than assumed

- **`.firebaserc`** — the file that maps this local project to an actual
  Firebase/GCP project id. Not created here, deliberately: fabricating a
  plausible-looking project id risks it being copy-pasted into a real
  deploy unnoticed, the same reasoning `.env.local.example` was left
  templated rather than filled in. Create it with your real project id
  before running `firebase deploy` or any emulator command:
  ```json
  { "projects": { "default": "<your-real-firebase-project-id>" } }
  ```
- **`node_modules`** — this package has never been `npm install`ed; no
  Node/npm was available in the environment this was built in (same
  caveat as the rest of this repository — see the root `MEMORY.md`).
- **Nothing here has been compiled, emulated, or deployed.** Every claim
  above about the build's output layout is derived by careful, manual
  reasoning about `tsc`'s documented `rootDir`/`outDir` behavior, not
  verified by actually running `tsc`. Treat the first real
  `npm install && npm run build` in this directory as a genuine unknown,
  worth double-checking against this file's claims before deploying.

## Commands, once `node_modules` exists and `.firebaserc` is real

```bash
cd functions
npm install
npm run build      # tsc -> functions/lib/**
npm run serve       # local emulator
npm run deploy       # firebase deploy --only functions
```
