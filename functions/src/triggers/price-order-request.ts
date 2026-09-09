/**
 * functions/src/triggers/price-order-request.ts
 *
 * The single blocking gap MEMORY.md has named since the Live Data phase
 * began: a Cloud Functions v2 Firestore trigger that actually calls
 * `priceOrderRequest()` when a guest creates an `orderRequests` document.
 * Before this file existed, `cart-checkout-view.tsx`'s write was fully
 * real and rules-compliant, but nothing would ever flip a request's
 * `status` away from `'pending'` -- this is that missing link, and (with
 * `order.service.ts` now relocated into `src/`) the last piece needed for
 * a guest order to travel end-to-end into a real KDS ticket.
 *
 * MATCHES `order.service.ts`'s OWN WIRING COMMENT almost verbatim -- that
 * file's tail has carried the exact shape of this trigger since before
 * this file existed, specifically so building this would mean transcribing
 * an already-reviewed design rather than inventing a new one. The two
 * differences from that comment: a relative import (see below) in place of
 * the alias notation used there for readability, and a real `logger`
 * import instead of an implied one.
 *
 * WHY A RELATIVE IMPORT, not `@/server/services/order.service`: this file
 * is compiled by a PLAIN `tsc` invocation (`functions/tsconfig.json`), not
 * bundled by Next.js -- plain `tsc` does not rewrite `@/*`-style path
 * aliases in its emitted JavaScript. Using the alias here would type-check
 * successfully but fail at actual Cloud Function runtime with "Cannot find
 * module '@/server/services/order.service'" the first time this function
 * is ever invoked -- a failure invisible until deployment, not before it.
 * `order.service.ts` itself carries the identical reasoning for the same
 * reason (see that file's header).
 *
 * `minInstances: 1` (§8.5's own reasoning, restated): a guest ordering
 * food is latency-sensitive in a way most Cloud Functions traffic isn't --
 * a cold start here is a guest staring at "Sending to kitchen..." for
 * several extra seconds. Kept warm during service hours is the tradeoff
 * this project already decided on; NOT re-litigated here.
 *
 * ERROR HANDLING, the one thing worth being precise about: `priceOrderRequest`
 * NEVER throws for a business-invalid request -- every rejection path
 * inside it returns a typed `{ outcome: 'rejected', ... }` AND already
 * writes that outcome back to the `orderRequests` document itself, inside
 * the same transaction. This trigger's `if (result.outcome === 'rejected')`
 * branch below exists ONLY for structured logging -- it does not, and must
 * not, attempt to write anything back to Firestore itself; that already
 * happened. A genuine thrown exception from `priceOrderRequest` (a real
 * infra failure -- a malformed Firestore read, a permissions
 * misconfiguration) is deliberately NOT caught here: letting it propagate
 * is what makes Cloud Functions v2 retry the event automatically, which is
 * the correct behavior for an unanticipated failure and the wrong one for
 * an expected business rejection (RULES.md §4.4's distinction, applied at
 * the trigger boundary this time rather than inside a service function).
 */

import { onDocumentCreated } from 'firebase-functions/v2/firestore';
import * as logger from 'firebase-functions/logger';
import { priceOrderRequest } from '../../../src/server/services/order.service';

export const priceOrderRequestTrigger = onDocumentCreated(
  {
    document: 'tenants/{tenantId}/branches/{branchId}/orderRequests/{requestId}',
    region: 'me-central2',
    minInstances: 1, // service hours only, per a scheduled scaler -- ARCHITECTURE.md §8.5
    maxInstances: 40, // §8.5 -- caps the invoice under load
  },
  async (event) => {
    const { tenantId, branchId, requestId } = event.params;

    const result = await priceOrderRequest({ tenantId, branchId, requestId });

    if (result.outcome === 'rejected') {
      // Business-invalid request, already resolved and already written
      // back to Firestore by priceOrderRequest() itself -- logged here
      // purely for operational visibility, NOT retried and NOT re-thrown.
      // Cloud Functions would otherwise redeliver a permanently-invalid
      // request forever.
      logger.info('orderRequest rejected', {
        tenantId,
        branchId,
        requestId,
        reason: result.reason,
        detail: result.detail,
      });
      return;
    }

    if (result.outcome === 'duplicate') {
      // Expected under at-least-once delivery or a guest's retried write
      // -- not an error, not logged as a warning.
      logger.info('orderRequest resolved as duplicate', {
        tenantId,
        branchId,
        requestId,
        orderId: result.orderId,
      });
      return;
    }

    logger.info('orderRequest priced', {
      tenantId,
      branchId,
      requestId,
      orderId: result.orderId,
      grossFils: result.grossFils,
    });
  },
);
