'use server';

/**
 * src/server/actions/branch-settings.actions.ts
 *
 * `updateBranchSettings` (DECISIONS.md ADR-11) — the Manager Store
 * Settings write. `tb_staff`-cookie-verified, `canManageSettings`
 * (manager/owner), Admin SDK: `branches/{b}` is `allow read: isStaff` /
 * no client write in `firestore.rules`, so this is the only path to it.
 *
 * Writes a MERGE patch: `name` (branch display name) plus the `settings`
 * sub-object (`currency`, `vatPpm`, `receiptFooter`). `priceOrderRequest`
 * reads `settings.currency` / `settings.vatPpm` on the next order and
 * SNAPSHOTS them onto that ticket — an existing order / bill is never
 * re-priced by a settings change.
 */

import { cookies } from 'next/headers';
import { adminDb } from '@/lib/firebase/admin';
import { verifyStaffSessionToken, STAFF_SESSION_COOKIE_NAME } from '@/server/auth/staff-session-cookie';
import { canManageSettings } from '@/lib/console/staff-permissions';
import { CURRENCIES } from '@/lib/format/money';
import {
  MAX_RECEIPT_FOOTER,
  MAX_WIFI_SSID,
  MAX_WIFI_PASSWORD,
  MAX_ADDRESS,
  cleanImageUrl,
} from '@/lib/branch-settings';
import type { BranchSettings, KitchenStatus } from '@/types/firestore';

const MAX_NAME = 80;

function cleanText(value: unknown, max: number): string {
  if (typeof value !== 'string') return '';
  let out = '';
  for (const ch of value) {
    const code = ch.codePointAt(0) ?? 0;
    out += code < 0x20 || (code >= 0x7f && code <= 0x9f) ? ' ' : ch;
  }
  return out.replace(/\s+/g, ' ').trim().slice(0, max);
}

/** Receipt footers keep newlines (multi-line address blocks); only C0/C1
 *  controls other than `\n` are stripped, and the length is capped. */
function cleanMultiline(value: unknown, max: number): string {
  if (typeof value !== 'string') return '';
  let out = '';
  for (const ch of value) {
    const code = ch.codePointAt(0) ?? 0;
    if (code === 0x0a) out += '\n';
    else if (code < 0x20 || (code >= 0x7f && code <= 0x9f)) out += ' ';
    else out += ch;
  }
  return out.replace(/[ \t]+/g, ' ').replace(/\n{3,}/g, '\n\n').trim().slice(0, max);
}

export interface UpdateBranchSettingsInput {
  branchId: string;
  name: string;
  currency: string;
  /** VAT rate in parts-per-million (50_000 = 5%). The UI converts from a
   *  percent field. */
  vatPpm: number;
  receiptFooter: string;
  /** Guest-experience fields (Stitch guest ordering). All optional —
   *  blank turns the feature off on the landing screen. */
  wifiSsid?: string;
  wifiPassword?: string;
  heroImageUrl?: string;
  kitchenStatus?: KitchenStatus;
  address?: string;
}

export type UpdateBranchSettingsResult =
  | { outcome: 'saved'; settings: BranchSettings; name: string }
  | { outcome: 'rejected'; reason: string };

export async function updateBranchSettings(
  input: UpdateBranchSettingsInput,
): Promise<UpdateBranchSettingsResult> {
  const { branchId } = input;
  if (typeof branchId !== 'string' || branchId.length === 0 || branchId.length > 128) {
    return { outcome: 'rejected', reason: 'INVALID_BRANCH' };
  }

  const cookieStore = await cookies();
  const token = cookieStore.get(STAFF_SESSION_COOKIE_NAME)?.value;
  const session = token ? await verifyStaffSessionToken(token) : null;
  if (!session) return { outcome: 'rejected', reason: 'NOT_AUTHENTICATED' };
  if (!session.bids.includes(branchId)) return { outcome: 'rejected', reason: 'BRANCH_NOT_AUTHORIZED' };
  if (!canManageSettings({ role: session.role, overrideAuth: session.overrideAuth })) {
    return { outcome: 'rejected', reason: 'ROLE_NOT_PERMITTED' };
  }

  const name = cleanText(input.name, MAX_NAME);
  if (name.length < 2) return { outcome: 'rejected', reason: 'NAME_REQUIRED' };

  if (typeof input.currency !== 'string' || !CURRENCIES[input.currency]) {
    return { outcome: 'rejected', reason: 'UNSUPPORTED_CURRENCY' };
  }
  const currency = input.currency;

  const vatPpm = typeof input.vatPpm === 'number' ? Math.round(input.vatPpm) : NaN;
  if (!Number.isInteger(vatPpm) || vatPpm < 0 || vatPpm > 300_000) {
    // 300_000 ppm = 30% — a generous ceiling; nothing real is higher.
    return { outcome: 'rejected', reason: 'INVALID_VAT_RATE' };
  }

  const receiptFooter = cleanMultiline(input.receiptFooter, MAX_RECEIPT_FOOTER);

  const wifiSsid = cleanText(input.wifiSsid, MAX_WIFI_SSID);
  // Wi-Fi passwords can contain spaces and symbols; only strip control chars.
  const wifiPassword =
    typeof input.wifiPassword === 'string'
      ? [...input.wifiPassword]
          .filter((ch) => {
            const c = ch.codePointAt(0) ?? 0;
            return c >= 0x20 && !(c >= 0x7f && c <= 0x9f);
          })
          .join('')
          .slice(0, MAX_WIFI_PASSWORD)
      : '';
  const heroImageUrl = cleanImageUrl(input.heroImageUrl);
  const kitchenStatus: KitchenStatus =
    input.kitchenStatus === 'busy' || input.kitchenStatus === 'closed' ? input.kitchenStatus : 'live';
  const address = cleanText(input.address, MAX_ADDRESS);

  const settings: BranchSettings = {
    currency,
    vatPpm,
    receiptFooter,
    wifiSsid,
    wifiPassword,
    heroImageUrl,
    kitchenStatus,
    address,
  };

  await adminDb.doc(`tenants/${session.tid}/branches/${branchId}`).set(
    {
      name,
      settings,
      settingsUpdatedAt: Date.now(),
      settingsUpdatedByUid: session.uid,
    },
    { merge: true },
  );

  return { outcome: 'saved', settings, name };
}
