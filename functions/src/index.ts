/**
 * functions/src/index.ts
 *
 * The deployment entry point Firebase CLI actually loads (see
 * `functions/package.json`'s `main`, which points at this file's compiled
 * output). One re-export today -- ARCHITECTURE.md names several other
 * Cloud Functions this project will eventually need (`publishMenu`,
 * `syncTableParties`, among others catalogued in ARCHITECTURE.md's own
 * function table) -- this file is where each of those gets added as its
 * own trigger module and re-exported here, rather than every trigger's
 * logic living directly in this file.
 */

export { priceOrderRequestTrigger } from './triggers/price-order-request';
