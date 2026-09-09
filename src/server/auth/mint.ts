/**
 * src/server/auth/mint.ts
 *
 * SCOPE NARROWED FROM ARCHITECTURE.md §7.2 -- read this before adding
 * anything else to this file.
 *
 * §7.2 originally described this filename as "the ONE place guest
 * custom claims (gst, tid, bid, ses, did) are ever set" -- minting a
 * real Firebase Auth custom token, via the Admin SDK, carrying a
 * resolved session id. That responsibility needs Firestore access (to
 * resolve the scanned slug to a tenant/branch, and to create or wake a
 * session) and is therefore Node-only; it cannot live in a file
 * `middleware.ts` imports for its Edge-runtime path.
 *
 * What THIS file actually does, for this task, is narrower and fully
 * Edge-compatible: mint a brand-new DEVICE identity (not a guest
 * session) when middleware sees a request with no valid `tb_did`
 * cookie at all. It has nothing to do with Firestore, sessions, or
 * Firebase Auth.
 *
 * The original, broader responsibility -- minting the actual guest
 * custom-claim auth token -- still needs to exist somewhere. It does
 * not belong in this file anymore, to avoid exactly the confusion of
 * two unrelated things sharing one name; a reasonable home for it later
 * is `server/auth/mint-guest-session.ts`, Node runtime, called from
 * wherever the full session-resolution algorithm (ARCHITECTURE.md §3.3)
 * ends up living once `slug.service.ts`/`session.service.ts` exist.
 */

import { signDeviceToken } from './device-cookie';

export interface MintedDevice {
  deviceId: string;
  token: string;
}

/**
 * Called by `middleware.ts` exactly when a request has no existing,
 * valid device cookie. `crypto.randomUUID()` is a Web Crypto API
 * global, available on both Edge and Node -- not Node's `crypto`
 * module, which would not be.
 */
export async function mintDeviceToken(): Promise<MintedDevice> {
  const deviceId = `dev_${crypto.randomUUID()}`;
  const token = await signDeviceToken({ did: deviceId });
  return { deviceId, token };
}
