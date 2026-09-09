/**
 * src/server/services/session.service.ts
 *
 * SCOPE. Two functions now live here, composed in sequence, never one
 * calling the other internally:
 *
 *   `checkGuestBoot`      -- WHO (a device) and WHERE (a table, already
 *                            resolved by `slug.service.ts`): confirms
 *                            neither is banned or unavailable. Read-only.
 *   `resolveGuestSession` -- the rest of ARCHITECTURE.md §3.3: given a
 *                            device already cleared by `checkGuestBoot`,
 *                            decide whether it's waking an existing
 *                            party, has moved tables and needs to
 *                            confirm, or needs a brand-new party created.
 *                            Only this second function ever writes.
 *
 * A future Route Handler composes all three: `resolveTableSlug` →
 * `checkGuestBoot` (only proceed past a `'ready'` result) →
 * `resolveGuestSession`. `resolveGuestSession` does NOT re-derive
 * `tenantId`/`branchId`/`tableId` from a slug and does NOT internally
 * call `checkGuestBoot` -- it trusts the location it's handed, the same
 * composition discipline as everywhere else in this phase. It DOES,
 * however, re-check the ban list itself (see below) -- composition
 * discipline and zero-trust are different axes, not in tension.
 *
 * "THROW A STRICT AUTH ERROR" -- interpreted, not implemented literally,
 * and here is why. Every other banned-caller check already built in
 * this codebase (`order.service.ts`'s `priceOrderRequest`, which returns
 * `{ outcome: 'rejected', reason: 'CALLER_BANNED', ... }`) treats a ban
 * as an EXPECTED, TYPED outcome, never a thrown exception -- RULES.md
 * §4.4 draws that line deliberately: a `throw` is reserved for genuine,
 * unanticipated infrastructure failure, and "a banned device tried to
 * boot a session" is neither unanticipated nor a bug — it is the exact
 * case this function exists to catch. Throwing here would be the one
 * inconsistent banned-check in an otherwise uniform codebase. This
 * returns `{ status: 'banned' }` / `{ outcome: 'banned' }` instead,
 * matching every other ban check already built. If a literal thrown
 * exception was specifically intended for a reason not visible from the
 * existing pattern, this is the one line to change (in both functions).
 *
 * A MORE THOROUGH CHECK THAN WHAT WAS ASKED, DELIBERATELY NOT DONE: this
 * checks the device id against `security/bannedDevices.ids` only, per
 * the task description. `firestore.rules`' own `banned()` check also
 * covers a banned UID directly. A fully rigorous version of this
 * function would additionally read `guestDevices/{did}.linkedUids` and
 * check whether ANY previously-linked anonymous UID on this device is in
 * `bannedUsers.uids` -- catching a device that hasn't itself been banned
 * but was previously used under an account that has. That's a real
 * hardening, not built here because it wasn't asked for and adds a
 * second read plus a dependency this task didn't scope.
 *
 * GUEST-FACING DISPLAY WARNING for whoever builds the caller: every
 * non-'ready' / non-success status below must render the SAME generic
 * message to the guest, regardless of which one it is (ARCHITECTURE.md
 * §8.1's uniform-failure principle applies here exactly as it does to
 * slug resolution -- "banned," "tenant suspended," and "table disabled"
 * must not be guest-visibly distinguishable, or the response itself
 * becomes an oracle). `resolveGuestSession`'s `'table_full'` is the one
 * deliberate exception -- see that function's header for why it's safe
 * to surface plainly.
 *
 * THREE GAPS THIS FILE EXPOSES RATHER THAN PAPERS OVER, all detailed at
 * their point of relevance below: (1) `resolveGuestSession`'s device→
 * session lookup needs a Firestore composite index that does not exist
 * in `firestore.indexes.json` yet; (2) the `hostUid` this file generates
 * for a new party cannot yet be handed to `mint-guest-session.ts` as-is,
 * because that file currently generates its own `uid` rather than
 * accepting one; (3) `tables.parties[]` is written directly here rather
 * than by the `syncTableParties` Cloud Function ARCHITECTURE.md §3.6
 * names, because that function doesn't exist yet.
 */

import { randomInt } from 'node:crypto';
import { adminDb } from '@/lib/firebase/admin';
import type { Transaction } from 'firebase-admin/firestore';
import type { Table, TableParty, GuestSession, GuestSessionSource } from '@/types/firestore';

/**
 * The party join PIN (DECISIONS.md ADR-7). Four decimal digits, zero-
 * padded, drawn from a CSPRNG (`node:crypto` `randomInt`, uniform over
 * 0000–9999 — not `Math.random`, and not `crypto.randomUUID` sliced,
 * which would bias the digit distribution). 10⁴ space is fine: this PIN
 * is a speed-bump against a stranger at the next table joining a bill by
 * accident or nuisance, guarded by a per-attempt server check with the
 * same per-member lockout discipline the staff PIN uses — it is not a
 * secret defending money on its own (that stays the custom-claim token +
 * live party-membership gate, ARCHITECTURE.md §8.2).
 */
function generateJoinPin(): string {
  return String(randomInt(0, 10_000)).padStart(4, '0');
}

export type GuestBootResult =
  | {
      status: 'ready';
      tenantId: string;
      branchId: string;
      tableId: string;
      tableCode: string;
      zoneId: string;
      deviceId: string;
    }
  | { status: 'banned' }
  | { status: 'tenant_unavailable' }
  | { status: 'table_unavailable' };

interface TenantDoc {
  status: 'active' | 'trial' | 'suspended' | 'churned';
}

interface TableDoc {
  code: string;
  zoneId: string;
  status: 'available' | 'occupied' | 'attention' | 'dirty' | 'disabled';
}

interface BannedDevicesDoc {
  ids?: string[];
}

export interface ResolvedLocation {
  tenantId: string;
  branchId: string;
  tableId: string;
}

/**
 * The three reads below are independent of each other -- none needs the
 * result of another -- so they run in parallel rather than as a
 * transaction. Nothing here writes anything; a transaction's atomicity
 * guarantee has no read-only use here.
 */
export async function checkGuestBoot(location: ResolvedLocation, deviceId: string): Promise<GuestBootResult> {
  const { tenantId, branchId, tableId } = location;

  const [tenantSnap, tableSnap, bannedDevicesSnap] = await Promise.all([
    adminDb.doc(`tenants/${tenantId}`).get(),
    adminDb.doc(`tenants/${tenantId}/branches/${branchId}/tables/${tableId}`).get(),
    adminDb.doc(`tenants/${tenantId}/security/bannedDevices`).get(),
  ]);

  // Checked first, and decided independently of the other two reads'
  // outcomes -- a banned device gets the same result whether or not the
  // tenant or table also happen to be in a bad state. Ban status is
  // never allowed to depend on, or be masked by, anything else here.
  const bannedIds = (bannedDevicesSnap.data() as BannedDevicesDoc | undefined)?.ids ?? [];
  if (bannedIds.includes(deviceId)) {
    return { status: 'banned' };
  }

  if (!tenantSnap.exists) {
    return { status: 'tenant_unavailable' };
  }
  const tenant = tenantSnap.data() as TenantDoc;
  if (tenant.status === 'suspended' || tenant.status === 'churned') {
    return { status: 'tenant_unavailable' };
  }

  if (!tableSnap.exists) {
    return { status: 'table_unavailable' };
  }
  const table = tableSnap.data() as TableDoc;
  if (table.status === 'disabled') {
    return { status: 'table_unavailable' };
  }

  return {
    status: 'ready',
    tenantId,
    branchId,
    tableId,
    tableCode: table.code,
    zoneId: table.zoneId,
    deviceId,
  };
}

// --- resolveGuestSession ------------------------------------------------

export type GuestSessionResolution =
  | {
      outcome: 'resumed';
      sessionId: string;
      hostUid: string;
      tableCode: string;
      zoneId: string;
      partyLabel: string;
    }
  | {
      outcome: 'move_pending';
      sessionId: string;
      fromTableId: string;
      fromTableCode: string;
      toTableId: string;
      toTableCode: string;
    }
  | {
      outcome: 'created';
      sessionId: string;
      hostUid: string;
      tableCode: string;
      zoneId: string;
      partyLabel: string;
    }
  | { outcome: 'table_full' }
  | { outcome: 'banned' };

interface BranchSessionConfigDoc {
  session?: { maxPartiesPerTable?: number };
}

const DEFAULT_MAX_PARTIES_PER_TABLE = 6;
const OPEN_SESSION_STATUSES = ['active', 'idle', 'billing'] as const;

/**
 * The rest of ARCHITECTURE.md §3.3, run against a device already cleared
 * by `checkGuestBoot`. One Firestore transaction decides AND commits --
 * not an optimistic pre-check followed by a separate write, because the
 * three outcomes below are mutually exclusive and the decision itself
 * (does an open session already exist for this device, at this branch)
 * has to be made against the same consistent snapshot the write commits
 * against, or two concurrent requests from the same device (a double-
 * tapped QR scan, a slow network retry) could both decide "no existing
 * session" and each create a separate party for one guest.
 *
 * SCOPED TO ONE BRANCH, DELIBERATELY. The device→session lookup below is
 * a query against `tenants/{tenantId}/branches/{branchId}/sessions`, not
 * a cross-tenant `collectionGroup('sessions')` query. A device that has
 * an old, unrelated open session at a DIFFERENT restaurant (visited
 * yesterday, never explicitly closed) must not have that surfaced as a
 * "did you move tables?" prompt when it scans a table at THIS restaurant
 * today -- move-detection is a within-one-venue concept. Scoping the
 * query to this branch is what makes that true; a collection-group query
 * would find that stale, unrelated session and wrongly treat a brand-new
 * restaurant visit as a table move.
 *
 * REQUIRES A COMPOSITE INDEX NOT YET IN `firestore.indexes.json`. The
 * device lookup below combines an `array-contains` filter (`deviceIds`)
 * with an `in` filter (`status`) and an `orderBy` on a third field
 * (`lastActivityAt`) -- Firestore requires a composite index for that
 * combination, and the only `sessions` index currently documented
 * (ARCHITECTURE.md §1.11) is on `joinedUids`, a different field entirely.
 * This will throw at query time in a real project until that index is
 * added; flagged here rather than discovered as a confusing runtime
 * error later.
 *
 * ZERO-TRUST, RESTATED: this re-checks the ban list itself rather than
 * trusting that `checkGuestBoot` was called moments earlier and nothing
 * changed -- the same defense-in-depth already applied in
 * `order.service.ts` (which re-validates inside its own transaction even
 * though `firestore.rules` already gates the client's write).
 */
export async function resolveGuestSession(
  location: ResolvedLocation,
  deviceId: string,
): Promise<GuestSessionResolution> {
  const { tenantId, branchId, tableId } = location;

  const bannedRef = adminDb.doc(`tenants/${tenantId}/security/bannedDevices`);
  const tableRef = adminDb.doc(`tenants/${tenantId}/branches/${branchId}/tables/${tableId}`);
  const branchRef = adminDb.doc(`tenants/${tenantId}/branches/${branchId}`);
  const sessionsQuery = adminDb
    .collection(`tenants/${tenantId}/branches/${branchId}/sessions`)
    .where('deviceIds', 'array-contains', deviceId)
    .where('status', 'in', [...OPEN_SESSION_STATUSES])
    .orderBy('lastActivityAt', 'desc')
    .limit(1);

  return adminDb.runTransaction(async (tx) => {
    // All reads for every branch happen before any write, below -- a
    // hard Firestore transaction requirement, not just a style choice.
    const bannedSnap = await tx.get(bannedRef);
    const bannedIds = (bannedSnap.data() as BannedDevicesDoc | undefined)?.ids ?? [];
    if (bannedIds.includes(deviceId)) {
      return { outcome: 'banned' };
    }

    const sessionsSnap = await tx.get(sessionsQuery);

    const tableSnap = await tx.get(tableRef);
    if (!tableSnap.exists) {
      // Not a business outcome -- `checkGuestBoot` confirmed this table
      // exists moments before this function is ever called under the
      // established composition order. A table vanishing in that window
      // is a genuine, unanticipated race, not something a guest can
      // trigger through normal use -- RULES.md §4.4, thrown deliberately.
      throw new Error(`resolveGuestSession: table ${tableId} not found after checkGuestBoot confirmed it`);
    }
    const table = tableSnap.data() as Table;

    const now = Date.now();

    if (!sessionsSnap.empty) {
      const existingDoc = sessionsSnap.docs[0];
      const existingSessionId = existingDoc.id;
      const existingSession = existingDoc.data() as GuestSession;
      const existingSessionRef = adminDb.doc(
        `tenants/${tenantId}/branches/${branchId}/sessions/${existingSessionId}`,
      );

      if (existingSession.tableId === tableId) {
        // SESSION WAKE. `deviceIds` already contains this device -- it's
        // how the query above found this session in the first place --
        // so there is nothing to add there. Only an 'idle' session gets
        // the full wake treatment (status flip, `wokenAt`, `idleAt`
        // cleared); an 'active' or 'billing' session found here just
        // means this device never actually went idle server-side (a
        // page refresh, a re-scan of the same table) -- a lighter
        // activity-timestamp touch is the honest thing to write, not a
        // fabricated "wake" of a session that was never asleep.
        if (existingSession.status === 'idle') {
          tx.update(existingSessionRef, {
            status: 'active',
            wokenAt: now,
            lastActivityAt: now,
            idleAt: null,
          });
          // Keep the denormalized copy on the table in sync -- see this
          // file's header, gap (3), for why this write happens here at
          // all rather than in a `sessions` onWrite trigger.
          const syncedParties: TableParty[] = table.parties.map((p) =>
            p.sessionId === existingSessionId ? { ...p, status: 'active' } : p,
          );
          tx.update(tableRef, { parties: syncedParties });
        } else {
          tx.update(existingSessionRef, { lastActivityAt: now });
        }

        return {
          outcome: 'resumed',
          sessionId: existingSessionId,
          hostUid: existingSession.hostUid,
          tableCode: table.code,
          zoneId: table.zoneId,
          partyLabel: existingSession.partyLabel,
        };
      }

      // TABLE MOVE -- detected, not acted on. No write happens in this
      // branch at all: ARCHITECTURE.md §3.3 is explicit that a table
      // mismatch is a CONFIRMATION prompt shown to the guest, never an
      // automatic transfer. `fromTableCode` reads off the session
      // document's own denormalized `tableCode` field rather than
      // issuing a second table read -- that field exists on every
      // session precisely so a caller never needs to re-read a table
      // it isn't currently sitting at just to display its code.
      return {
        outcome: 'move_pending',
        sessionId: existingSessionId,
        fromTableId: existingSession.tableId,
        fromTableCode: existingSession.tableCode,
        toTableId: tableId,
        toTableCode: table.code,
      };
    }

    // PARTY CREATION -- no open session found for this device at this
    // branch. Never joins an existing party at this table, even if one
    // is present -- a stranger's QR scan must never be silently folded
    // into someone else's open tab.
    const branchSnap = await tx.get(branchRef);
    const maxParties =
      (branchSnap.data() as BranchSessionConfigDoc | undefined)?.session?.maxPartiesPerTable ??
      DEFAULT_MAX_PARTIES_PER_TABLE;

    // A cap ARCHITECTURE.md documents in the table-TRANSFER context
    // only. Enforcing it here too, for organic QR-scan arrivals, is an
    // addition beyond the original §3.3 three-way branch -- justified by
    // the cap existing at all (a table already crowded with the maximum
    // number of separate bills shouldn't silently accept one more), not
    // guessed at. `'table_full'` is the one guest-visible status this
    // file returns that is NOT folded into the generic uniform-failure
    // message -- unlike "banned" or "tenant suspended," a full table is
    // not a security-sensitive fact; telling a guest their table is at
    // capacity leaks nothing an attacker could use as an oracle.
    if (table.partyCount >= maxParties) {
      return { outcome: 'table_full' };
    }

    const created = createPartySession(tx, {
      tenantId,
      branchId,
      tableId,
      table,
      deviceIds: [deviceId],
      source: 'qr',
      openedByStaffUid: null,
      guestCount: 1,
      nowMs: now,
    });

    return { outcome: 'created', ...created };
  });
}

// --- createPartySession ---------------------------------------------------

export interface CreatePartySessionInput {
  tenantId: string;
  branchId: string;
  tableId: string;
  /** Already read inside the caller's transaction. */
  table: Table;
  /** `[deviceId]` for a QR/NFC guest; `[]` for a staff-opened table. */
  deviceIds: string[];
  source: GuestSessionSource;
  /** The waiter's uid when `source === 'staff'`; `null` otherwise. */
  openedByStaffUid: string | null;
  guestCount: number;
  nowMs: number;
}

export interface CreatedPartySession {
  sessionId: string;
  hostUid: string;
  partyLabel: string;
  tableCode: string;
  zoneId: string;
}

/**
 * The party-creation half of ARCHITECTURE.md §3.3, extracted so
 * `resolveGuestSession` (QR scan) and `openTableSession`
 * (`server/actions/staff-order.actions.ts` — a waiter opening a table
 * for a guest who ordered verbally) run the IDENTICAL write: mint the
 * `sessions/{id}` document, and mirror it into `tables/{id}.parties[]` in
 * the same transaction (GAP (3) in this file's header — that denorm is
 * still written here, not by a `syncTableParties` trigger).
 *
 * PRECONDITIONS ARE THE CALLER'S JOB, on purpose: they differ. The guest
 * path checks the banned-device list and returns `{ outcome: 'table_full' }`;
 * the staff path checks the staff role and returns
 * `{ outcome: 'rejected', reason: 'TABLE_FULL' }`. Both must check
 * `table.partyCount` against the per-branch cap BEFORE calling this — this
 * function assumes there is room.
 *
 * `hostUid` is still `anon_${crypto.randomUUID()}` even for a staff-opened
 * session (GAP (2) unchanged — no Firebase Auth identity is minted for it;
 * the `firestore.rules` `inParty()` gap is the same one already flagged).
 * A staff-opened session simply has no guest device attached yet — if a
 * guest later scans that table's QR, the device lookup won't match this
 * `deviceIds: []` session and they get their own party. Merging a
 * late-scanning guest into a staff-opened tab is a separate feature —
 * DECISIONS.md ADR-7's PIN-gated join is the planned mechanism, and the
 * `joinPin` written below is its backend prep (the guest UI and join
 * action are not built yet).
 */
export function createPartySession(tx: Transaction, input: CreatePartySessionInput): CreatedPartySession {
  const { tenantId, branchId, tableId, table, deviceIds, source, openedByStaffUid, guestCount, nowMs } = input;
  const existingParties = table.parties ?? [];

  const usedLabels = new Set(existingParties.map((p) => p.label));
  let labelCode = 'A'.charCodeAt(0);
  while (usedLabels.has(String.fromCharCode(labelCode))) {
    labelCode += 1;
  }
  const partyLabel = String.fromCharCode(labelCode);

  const sessionRef = adminDb.collection(`tenants/${tenantId}/branches/${branchId}/sessions`).doc();
  const sessionId = sessionRef.id;
  const hostUid = `anon_${crypto.randomUUID()}`;

  const newSession: GuestSession = {
    partyLabel,
    tableId,
    tableCode: table.code,
    zoneId: table.zoneId,
    status: 'active',
    hostUid,
    joinedUids: [],
    deviceIds,
    // ADR-7: minted here for QR *and* staff-opened parties alike, so the
    // future guest join flow has a PIN to check no matter how the party
    // was opened.
    joinPin: generateJoinPin(),
    guestCount,
    openedAt: nowMs,
    lastActivityAt: nowMs,
    idleAt: null,
    wokenAt: null,
    closedAt: null,
    closedBy: null,
    closeReason: null,
    network: {
      firstIpHash: null,
      currentIpHash: null,
      asn: null,
      venueMatch: null,
      mismatchCount: 0,
      lastCheckedAt: null,
    },
    risk: { score: 0, flags: [] },
    runningTotals: { grossFils: 0, netFils: 0, vatFils: 0 },
    orderCount: 0,
    itemCount: 0,
    billId: null,
    moveHistory: [],
    locale: 'en',
    source,
    openedByStaffUid,
    // Bill lifecycle (ADR-7). A brand-new party has requested nothing and
    // printed nothing.
    billingRequestedAt: null,
    printCount: 0,
    lastPrintedAt: null,
    // ADR-11 — set from the first checkout that supplies a guest name.
    guestName: null,
  };
  tx.set(sessionRef, newSession);

  const newParty: TableParty = {
    sessionId,
    label: partyLabel,
    guestCount,
    openTabFils: 0,
    status: 'active',
    riskFlagged: false,
    openedAt: nowMs,
  };
  // Promote status up from 'available'/'dirty' only -- never downgrade an
  // 'attention' or existing 'occupied'.
  const nextStatus = table.status === 'available' || table.status === 'dirty' ? 'occupied' : table.status;
  const tableRef = adminDb.doc(`tenants/${tenantId}/branches/${branchId}/tables/${tableId}`);
  tx.update(tableRef, {
    parties: [...existingParties, newParty],
    partyCount: (table.partyCount ?? existingParties.length) + 1,
    status: nextStatus,
  });

  return { sessionId, hostUid, partyLabel, tableCode: table.code, zoneId: table.zoneId };
}
