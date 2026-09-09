/**
 * scripts/seed-demo.ts
 *
 * One-shot demo-data seeder for LOCAL PREVIEW / manual UI testing.
 *
 * Unlike `seed-staff-member.ts` (which uses the Admin SDK and needs
 * `gcloud auth application-default login`), this script talks to Firestore
 * through the **Firebase Web SDK** using only the public `NEXT_PUBLIC_*`
 * keys from `.env.local`. That works because the project is in Firestore
 * **Test Mode** (open read/write until the 30-day expiry). It is NOT a
 * production tool — once real `firestore.rules` are deployed, `members/`,
 * `tableSlugs/` and friends go back to `allow write: if false` and this
 * script stops working by design. Re-run any time before then; every
 * write is a full `set()` on a fixed document id, so it is idempotent.
 *
 * WHAT IT WRITES (tenant id is fixed to `tb_0492` — the hardcoded
 * `PLACEHOLDER_TENANT_ID` in `src/app/api/auth/pin/route.ts`; the URL
 * slug `demo` is cosmetic only):
 *
 *   tenants/tb_0492                                 (status: active)
 *   tenants/tb_0492/branches/br_demo                (menuVersion 1, settings)
 *   tenants/tb_0492/branches/br_demo/menuPublished/v1
 *   tenants/tb_0492/branches/br_demo/menuDraft/current
 *   tenants/tb_0492/branches/br_demo/live/availability
 *   tenants/tb_0492/branches/br_demo/tables/tbl_01 .. tbl_08
 *   tableSlugs/{slug}                               (one per table)
 *   tenants/tb_0492/members/mbr_tb_0492_{code}      (5 staff, hashed PINs)
 *   tenants/tb_0492/branches/br_demo/sessions/sess_demo_1 .. 2
 *   tenants/tb_0492/branches/br_demo/orders/ord_demo_1 .. 3
 *   tenants/tb_0492/branches/br_demo/staffAlerts/alert_demo_1
 *
 * USAGE
 *   npm run seed:demo
 */

import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { randomInt } from 'node:crypto';
import { initializeApp } from 'firebase/app';
import {
  initializeFirestore,
  writeBatch,
  doc,
  type Firestore,
} from 'firebase/firestore';
import { hashStaffPin } from '../src/server/auth/staff-pin';

// --- env ---------------------------------------------------------------

function loadEnvLocal(): void {
  const path = resolve(process.cwd(), '.env.local');
  let raw: string;
  try {
    raw = readFileSync(path, 'utf8');
  } catch {
    throw new Error(`seed-demo: cannot read ${path}. Run this from the project root (C:\\Tablesbell).`);
  }
  for (const line of raw.split(/\r?\n/)) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
    if (!m) continue;
    const key = m[1];
    let val = m[2];
    if ((val.startsWith('"') && val.endsWith('"')) || (val.startsWith("'") && val.endsWith("'"))) {
      val = val.slice(1, -1);
    }
    if (!(key in process.env)) process.env[key] = val;
  }
}

loadEnvLocal();

const firebaseConfig = {
  apiKey: process.env.NEXT_PUBLIC_FIREBASE_API_KEY,
  authDomain: process.env.NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN,
  projectId: process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID,
  storageBucket: process.env.NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET,
  messagingSenderId: process.env.NEXT_PUBLIC_FIREBASE_MESSAGING_SENDER_ID,
  appId: process.env.NEXT_PUBLIC_FIREBASE_APP_ID,
};

const missing = Object.entries(firebaseConfig)
  .filter(([, v]) => !v)
  .map(([k]) => k);
if (missing.length > 0) {
  throw new Error(`seed-demo: missing Firebase config in .env.local: ${missing.join(', ')}`);
}

// --- constants -------------------------------------------------------

const TENANT_ID = 'tb_0492';
const BRANCH_ID = 'br_demo';
const BRANCH_PATH = `tenants/${TENANT_ID}/branches/${BRANCH_ID}`;
const NOW = Date.now();

const VAT_PPM = 50_000; // 5%
const CURRENCY = 'AED';

/** Inclusive VAT split — mirrors pricing.service.ts `splitInclusive`. */
function splitInclusive(grossFils: number): { grossFils: number; netFils: number; vatFils: number } {
  const netFils = Math.round((grossFils * 1_000_000) / (1_000_000 + VAT_PPM));
  return { grossFils, netFils, vatFils: grossFils - netFils };
}

const SLUG_ALPHABET = '123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz';
function generateTableSlug(): string {
  let out = '';
  for (let i = 0; i < 12; i += 1) out += SLUG_ALPHABET[randomInt(0, SLUG_ALPHABET.length)];
  return out;
}

function pin(digits: number): string {
  const max = 10 ** digits;
  return String(randomInt(0, max)).padStart(digits, '0');
}

const t = (en: string, ar: string) => ({ en, ar });

// --- menu ------------------------------------------------------------

const MG_MILK = {
  id: 'mg_milk',
  name: t('Milk', 'الحليب'),
  minSelect: 1,
  maxSelect: 1,
  required: true,
  options: [
    { id: 'opt_full', name: t('Full fat', 'كامل الدسم'), priceDeltaFils: 0, isDefault: true, available: true },
    { id: 'opt_oat', name: t('Oat milk', 'حليب الشوفان'), priceDeltaFils: 300, isDefault: false, available: true },
    { id: 'opt_skim', name: t('Skimmed', 'خالي الدسم'), priceDeltaFils: 0, isDefault: false, available: true },
  ],
};

const MG_EGG = {
  id: 'mg_egg',
  name: t('Add egg', 'إضافة بيضة'),
  minSelect: 0,
  maxSelect: 2,
  required: false,
  options: [
    { id: 'opt_egg', name: t('Fried egg', 'بيضة مقلية'), priceDeltaFils: 500, isDefault: false, available: true },
  ],
};

const item = (
  id: string,
  categoryId: string,
  sku: string,
  name: { en: string; ar: string },
  priceFils: number,
  stationId: string,
  modifierGroups: unknown[] = [],
) => ({ id, categoryId, sku, name, priceFils, stationId, status: 'active', modifierGroups });

const CATEGORIES = [
  {
    id: 'cat_coffee',
    name: t('Coffee', 'قهوة'),
    sortIndex: 0,
    items: [
      item('itm_espresso', 'cat_coffee', 'COF-ESP', t('Espresso', 'إسبريسو'), 1200, 'stn_bar'),
      item('itm_flatwhite', 'cat_coffee', 'COF-FW', t('Flat White', 'فلات وايت'), 1800, 'stn_bar', [MG_MILK]),
      item('itm_cortado', 'cat_coffee', 'COF-COR', t('Cortado', 'كورتادو'), 1600, 'stn_bar', [MG_MILK]),
    ],
  },
  {
    id: 'cat_brunch',
    name: t('All-Day Brunch', 'فطور طوال اليوم'),
    sortIndex: 1,
    items: [
      item('itm_avotoast', 'cat_brunch', 'FD-AVO', t('Avocado Toast', 'توست أفوكادو'), 3800, 'stn_kitchen', [MG_EGG]),
      item('itm_shakshuka', 'cat_brunch', 'FD-SHK', t('Shakshuka', 'شكشوكة'), 4200, 'stn_kitchen'),
      item('itm_halloumi', 'cat_brunch', 'FD-HAL', t('Halloumi Wrap', 'راب حلومي'), 3500, 'stn_kitchen'),
    ],
  },
  {
    id: 'cat_cold',
    name: t('Cold Drinks', 'مشروبات باردة'),
    sortIndex: 2,
    items: [
      item('itm_oj', 'cat_cold', 'CD-OJ', t('Fresh Orange Juice', 'عصير برتقال طازج'), 2200, 'stn_bar'),
      item('itm_icedlatte', 'cat_cold', 'CD-ICL', t('Iced Latte', 'لاتيه مثلج'), 2000, 'stn_bar', [MG_MILK]),
      item('itm_sparkling', 'cat_cold', 'CD-SPK', t('Sparkling Water', 'مياه غازية'), 900, 'stn_bar'),
    ],
  },
];

// --- tables ---------------------------------------------------------

interface SeedTable {
  id: string;
  code: string;
  label: string;
  zoneId: string;
  seats: number;
  sortIndex: number;
  slug: string;
}

const TABLES: SeedTable[] = Array.from({ length: 8 }, (_, i) => {
  const n = i + 1;
  return {
    id: `tbl_${String(n).padStart(2, '0')}`,
    code: `T${n}`,
    label: `Table ${n}`,
    zoneId: n <= 5 ? 'indoor' : 'terrace',
    seats: n % 3 === 0 ? 6 : n % 2 === 0 ? 4 : 2,
    sortIndex: n * 10,
    slug: generateTableSlug(),
  };
});

function tableDoc(tbl: SeedTable, party: unknown | null) {
  const parties = party ? [party] : [];
  const openTabFils = party ? (party as { openTabFils: number }).openTabFils : 0;
  return {
    code: tbl.code,
    label: tbl.label,
    zoneId: tbl.zoneId,
    seats: tbl.seats,
    sortIndex: tbl.sortIndex,
    status: party ? 'occupied' : 'available',
    slug: tbl.slug,
    slugVersion: 1,
    slugRotatedAt: null,
    parties,
    partyCount: parties.length,
    openTabFils,
    activeCall: null,
    assignedServerUid: null,
    lastSanitizedAt: null,
    nfcTagId: null,
  };
}

// --- staff --------------------------------------------------------

interface SeedStaff {
  code: string;
  displayName: string;
  role: 'owner' | 'manager' | 'cashier' | 'server' | 'kitchen';
  jobTitle: string;
  overrideAuth: boolean;
  pinDigits: number;
}

const STAFF: SeedStaff[] = [
  { code: '99', displayName: 'Sam Rivera', role: 'owner', jobTitle: 'Superadmin / Owner', overrideAuth: true, pinDigits: 6 },
  { code: '10', displayName: 'Nadia Haddad', role: 'manager', jobTitle: 'Floor Manager', overrideAuth: true, pinDigits: 6 },
  { code: '20', displayName: 'Omar Kassem', role: 'cashier', jobTitle: 'Cashier', overrideAuth: false, pinDigits: 4 },
  { code: '30', displayName: 'Priya Nair', role: 'server', jobTitle: 'Floor Server', overrideAuth: false, pinDigits: 4 },
  { code: '40', displayName: 'Chef Marco', role: 'kitchen', jobTitle: 'Kitchen', overrideAuth: false, pinDigits: 4 },
];

function memberDoc(s: SeedStaff, pinHash: string) {
  const uid = `mbr_${TENANT_ID}_${s.code}`;
  return {
    uid,
    displayName: s.displayName,
    staffCode: s.code,
    role: s.role,
    jobTitle: s.jobTitle,
    branchIds: [BRANCH_ID],
    zoneIds: [],
    stationIds: [],
    pinHash,
    pinUpdatedAt: NOW,
    pinFailedAttempts: 0,
    pinLockedUntil: null,
    overrideAuth: s.overrideAuth,
    status: 'active',
    lastActiveAt: null,
    createdAt: NOW,
    createdBy: 'seed-demo',
  };
}

// --- sessions + orders (populate the dashboards) -----------------

function sessionDoc(opts: {
  sessionId: string;
  table: SeedTable;
  status: 'active' | 'billing';
  guestName: string | null;
  totals: { grossFils: number; netFils: number; vatFils: number };
  orderCount: number;
  itemCount: number;
  billingRequestedAt: number | null;
}) {
  return {
    partyLabel: 'A',
    tableId: opts.table.id,
    tableCode: opts.table.code,
    zoneId: opts.table.zoneId,
    status: opts.status,
    hostUid: `anon_${opts.sessionId}`,
    joinedUids: [],
    deviceIds: [`demo-device-${opts.sessionId}`],
    joinPin: pin(4),
    guestCount: 2,
    openedAt: NOW - 40 * 60_000,
    lastActivityAt: NOW - 3 * 60_000,
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
    runningTotals: opts.totals,
    orderCount: opts.orderCount,
    itemCount: opts.itemCount,
    billId: null,
    moveHistory: [],
    locale: 'en',
    source: 'qr',
    openedByStaffUid: null,
    billingRequestedAt: opts.billingRequestedAt,
    printCount: 0,
    lastPrintedAt: null,
    guestName: opts.guestName,
  };
}

interface SeedLine {
  menuItemId: string;
  sku: string;
  name: { en: string; ar: string };
  qty: number;
  basePriceFils: number;
  stationId: string;
  modifiers?: { groupId: string; optionId: string; name: { en: string; ar: string }; priceDeltaFils: number }[];
}

function buildLine(l: SeedLine, idx: number) {
  const mods = (l.modifiers ?? []).map((m) => ({
    groupId: m.groupId,
    optionId: m.optionId,
    nameSnapshot: m.name,
    priceDeltaFils: m.priceDeltaFils,
  }));
  const unitPriceFils = l.basePriceFils + mods.reduce((a, m) => a + m.priceDeltaFils, 0);
  return {
    lineId: `ln_${idx}`,
    menuItemId: l.menuItemId,
    sku: l.sku,
    nameSnapshot: l.name,
    qty: l.qty,
    unitPriceFils,
    modifiers: mods,
    stationId: l.stationId,
    status: 'active',
    lineStatus: 'queued',
    lineTotalFils: unitPriceFils * l.qty,
    void: null,
  };
}

function orderDoc(opts: {
  code: string;
  orderId: string;
  session: ReturnType<typeof sessionDoc>;
  sessionId: string;
  table: SeedTable;
  status: 'new' | 'prep' | 'ready';
  lines: SeedLine[];
  guestName: string | null;
  placedAt: number;
  prepStartedAt: number | null;
  readyAt: number | null;
}) {
  const items = opts.lines.map(buildLine);
  const grossFils = items.reduce((a, it) => a + it.lineTotalFils, 0);
  const { netFils, vatFils } = splitInclusive(grossFils);
  const stationIds = Array.from(new Set(items.map((it) => it.stationId)));
  return {
    code: opts.code,
    requestId: `req_${opts.orderId}`,
    clientRequestId: `cli_${opts.orderId}`,
    sessionId: opts.sessionId,
    partyLabel: 'A',
    tableId: opts.table.id,
    tableCode: opts.table.code,
    zoneId: opts.table.zoneId,
    status: opts.status,
    stationIds,
    items,
    grossFils,
    netFils,
    vatFils,
    voidedFils: 0,
    covers: 2,
    placedAt: opts.placedAt,
    prepStartedAt: opts.prepStartedAt,
    readyAt: opts.readyAt,
    servedAt: null,
    slaTargetSec: 900,
    slaBreached: false,
    priority: 'normal',
    placedBy: { kind: 'guest', uid: `anon_${opts.sessionId}` },
    placedByName: null,
    guestName: opts.guestName,
    currency: CURRENCY,
    vatPpm: VAT_PPM,
    guestNote: '',
    requiresStaffApproval: false,
    billId: null,
    riskScore: 0,
    adjustments: [],
    paymentStatus: 'UNPAID',
    receiptPrintedAt: null,
    updatedAt: null,
    updatedBy: null,
  };
}

// --- main --------------------------------------------------------

async function main(): Promise<void> {
  const app = initializeApp(firebaseConfig as Record<string, string>);
  const db: Firestore = initializeFirestore(app, { experimentalForceLongPolling: true });

  const batch = writeBatch(db);

  // tenant + branch
  batch.set(doc(db, `tenants/${TENANT_ID}`), {
    name: 'TableBells Demo',
    displayName: 'TableBells Demo Bistro',
    status: 'active',
    limits: { orderApprovalThresholdFils: 50_000, maxNoteChars: 280 },
    createdAt: NOW,
  });
  batch.set(doc(db, BRANCH_PATH), {
    name: 'Downtown',
    displayName: 'TableBells Demo — Downtown',
    status: 'active',
    menuVersion: 1,
    settings: {
      currency: CURRENCY,
      vatPpm: VAT_PPM,
      receiptFooter: 'Thank you for dining with us!  •  TRN 100123456700003',
    },
    session: { maxPartiesPerTable: 6 },
    sla: { ticketPrepSec: 900 },
    createdAt: NOW,
  });

  // menu (published + draft) + availability
  batch.set(doc(db, `${BRANCH_PATH}/menuPublished/v1`), {
    version: 1,
    publishedAt: NOW,
    publishedByUid: 'seed-demo',
    categories: CATEGORIES,
  });
  batch.set(doc(db, `${BRANCH_PATH}/menuDraft/current`), {
    updatedAt: NOW,
    updatedByUid: 'seed-demo',
    lastPublishedVersion: 1,
    categories: CATEGORIES,
  });
  batch.set(doc(db, `${BRANCH_PATH}/live/availability`), {
    updatedAt: NOW,
    unavailableItems: {},
    unavailableModifierOptions: {},
  });

  // sessions + their orders (tbl_01 active, tbl_02 billing)
  const t1 = TABLES[0];
  const t2 = TABLES[1];

  const t1Orders = [
    orderDoc({
      code: 'A-101',
      orderId: 'ord_demo_1',
      sessionId: 'sess_demo_1',
      session: {} as ReturnType<typeof sessionDoc>,
      table: t1,
      status: 'new',
      guestName: 'Layla',
      placedAt: NOW - 12 * 60_000,
      prepStartedAt: null,
      readyAt: null,
      lines: [
        {
          menuItemId: 'itm_flatwhite',
          sku: 'COF-FW',
          name: t('Flat White', 'فلات وايت'),
          qty: 1,
          basePriceFils: 1800,
          stationId: 'stn_bar',
          modifiers: [
            { groupId: 'mg_milk', optionId: 'opt_oat', name: t('Oat milk', 'حليب الشوفان'), priceDeltaFils: 300 },
          ],
        },
        {
          menuItemId: 'itm_avotoast',
          sku: 'FD-AVO',
          name: t('Avocado Toast', 'توست أفوكادو'),
          qty: 1,
          basePriceFils: 3800,
          stationId: 'stn_kitchen',
          modifiers: [
            { groupId: 'mg_egg', optionId: 'opt_egg', name: t('Fried egg', 'بيضة مقلية'), priceDeltaFils: 500 },
          ],
        },
      ],
    }),
    orderDoc({
      code: 'A-102',
      orderId: 'ord_demo_2',
      sessionId: 'sess_demo_1',
      session: {} as ReturnType<typeof sessionDoc>,
      table: t1,
      status: 'prep',
      guestName: 'Layla',
      placedAt: NOW - 8 * 60_000,
      prepStartedAt: NOW - 6 * 60_000,
      readyAt: null,
      lines: [
        {
          menuItemId: 'itm_shakshuka',
          sku: 'FD-SHK',
          name: t('Shakshuka', 'شكشوكة'),
          qty: 1,
          basePriceFils: 4200,
          stationId: 'stn_kitchen',
        },
      ],
    }),
  ];

  const t2Orders = [
    orderDoc({
      code: 'B-201',
      orderId: 'ord_demo_3',
      sessionId: 'sess_demo_2',
      session: {} as ReturnType<typeof sessionDoc>,
      table: t2,
      status: 'ready',
      guestName: null,
      placedAt: NOW - 25 * 60_000,
      prepStartedAt: NOW - 22 * 60_000,
      readyAt: NOW - 15 * 60_000,
      lines: [
        {
          menuItemId: 'itm_espresso',
          sku: 'COF-ESP',
          name: t('Espresso', 'إسبريسو'),
          qty: 2,
          basePriceFils: 1200,
          stationId: 'stn_bar',
        },
        {
          menuItemId: 'itm_oj',
          sku: 'CD-OJ',
          name: t('Fresh Orange Juice', 'عصير برتقال طازج'),
          qty: 1,
          basePriceFils: 2200,
          stationId: 'stn_bar',
        },
      ],
    }),
  ];

  const sum = (orders: ReturnType<typeof orderDoc>[]) =>
    orders.reduce(
      (a, o) => ({
        grossFils: a.grossFils + o.grossFils,
        netFils: a.netFils + o.netFils,
        vatFils: a.vatFils + o.vatFils,
      }),
      { grossFils: 0, netFils: 0, vatFils: 0 },
    );

  const t1Totals = sum(t1Orders);
  const t2Totals = sum(t2Orders);

  const sess1 = sessionDoc({
    sessionId: 'sess_demo_1',
    table: t1,
    status: 'active',
    guestName: 'Layla',
    totals: t1Totals,
    orderCount: t1Orders.length,
    itemCount: t1Orders.reduce((a, o) => a + o.items.length, 0),
    billingRequestedAt: null,
  });
  const sess2 = sessionDoc({
    sessionId: 'sess_demo_2',
    table: t2,
    status: 'billing',
    guestName: null,
    totals: t2Totals,
    orderCount: t2Orders.length,
    itemCount: t2Orders.reduce((a, o) => a + o.items.length, 0),
    billingRequestedAt: NOW - 4 * 60_000,
  });

  batch.set(doc(db, `${BRANCH_PATH}/sessions/sess_demo_1`), sess1);
  batch.set(doc(db, `${BRANCH_PATH}/sessions/sess_demo_2`), sess2);
  for (const o of t1Orders) batch.set(doc(db, `${BRANCH_PATH}/orders/${o.code === 'A-101' ? 'ord_demo_1' : 'ord_demo_2'}`), o);
  batch.set(doc(db, `${BRANCH_PATH}/orders/ord_demo_3`), t2Orders[0]);

  // one open bill-request alert for the billing table (ADR-7)
  batch.set(doc(db, `${BRANCH_PATH}/staffAlerts/alert_demo_1`), {
    id: 'alert_demo_1',
    type: 'bill_request',
    tableCode: t2.code,
    orderCode: null,
    sessionId: 'sess_demo_2',
    note: 'Guest tapped Request Bill',
    reportedByRole: 'guest',
    createdAt: NOW - 4 * 60_000,
    status: 'open',
  });

  // tables + slug mappings
  const t1Party = {
    sessionId: 'sess_demo_1',
    label: 'A',
    guestCount: 2,
    openTabFils: t1Totals.grossFils,
    status: 'active',
    riskFlagged: false,
    openedAt: NOW - 40 * 60_000,
  };
  const t2Party = {
    sessionId: 'sess_demo_2',
    label: 'A',
    guestCount: 2,
    openTabFils: t2Totals.grossFils,
    status: 'billing',
    riskFlagged: false,
    openedAt: NOW - 40 * 60_000,
  };

  for (const tbl of TABLES) {
    const party = tbl.id === t1.id ? t1Party : tbl.id === t2.id ? t2Party : null;
    batch.set(doc(db, `${BRANCH_PATH}/tables/${tbl.id}`), tableDoc(tbl, party));
    batch.set(doc(db, `tableSlugs/${tbl.slug}`), {
      tenantId: TENANT_ID,
      branchId: BRANCH_ID,
      tableId: tbl.id,
      version: 1,
      active: true,
    });
  }

  // staff members (hash PINs first — outside the batch)
  const credentials: { role: string; name: string; staffCode: string; pin: string }[] = [];
  for (const s of STAFF) {
    const plain = pin(s.pinDigits);
    const hash = await hashStaffPin(plain);
    batch.set(doc(db, `tenants/${TENANT_ID}/members/mbr_${TENANT_ID}_${s.code}`), memberDoc(s, hash));
    credentials.push({ role: s.role, name: s.displayName, staffCode: s.code, pin: plain });
  }

  await batch.commit();

  // --- report ---
  const line = '─'.repeat(64);
  console.log(`\n${line}`);
  console.log('  TableBells demo data seeded into project tablesbell-5ee62');
  console.log(line);
  console.log(`  Tenant : ${TENANT_ID}   (URL slug "demo" — cosmetic)`);
  console.log(`  Branch : ${BRANCH_ID}`);
  console.log(`  Menu   : v1 · 3 categories · 9 items`);
  console.log(`  Tables : ${TABLES.length}  (tbl_01 active, tbl_02 requesting bill)`);
  console.log(`  Orders : 3 live tickets (new / prep / ready)`);
  console.log(line);
  console.log('  STAFF LOGINS   →   http://localhost:3000/demo/lock');
  console.log(line);
  for (const c of credentials) {
    console.log(
      `  ${c.role.padEnd(8)}  ${c.name.padEnd(16)}  staff code ${c.staffCode.padEnd(3)}  PIN ${c.pin}`,
    );
  }
  console.log(line);
  console.log('  Console routes (any signed-in staff, role-gated inside):');
  console.log('    /demo/cashier          Cashier dashboard  (owner/manager/cashier)');
  console.log('    /demo/floor            Waiter floor       (owner/manager/server)');
  console.log('    /demo/kds              Kitchen display    (owner/manager/kitchen)');
  console.log('    /demo/manager/menu     Menu Maker         (owner/manager)');
  console.log('    /demo/manager/tables   Tables & QR codes  (owner/manager)');
  console.log('    /demo/manager/staff    Staff management   (owner/manager)');
  console.log('    /demo/manager/settings Store settings     (owner/manager)');
  console.log(line);
  console.log('  GUEST ordering — open a table QR target directly:');
  for (const tbl of TABLES.slice(0, 3)) {
    console.log(`    ${tbl.label.padEnd(9)}  http://localhost:3000/t/${tbl.slug}`);
  }
  console.log('    (all 8 slugs are printable from /demo/manager/tables)');
  console.log(`${line}\n`);
  console.log('  NOTE: guest QR scan runs a composite-index query on /sessions.');
  console.log('  If the guest page errors with a Firestore index link, either');
  console.log('  click it once (~1 min to build) or run:');
  console.log('     firebase deploy --only firestore:indexes --project tablesbell-5ee62');
  console.log('');
  console.log('  NOTE: guest-placed orders stay "pending" until the priceOrderRequest');
  console.log('  Cloud Function is deployed — the 3 seeded tickets above are already');
  console.log('  priced so the KDS / Cashier / Waiter screens have live content.\n');
}

main()
  .then(() => process.exit(0))
  .catch((err: unknown) => {
    console.error(`\nseed-demo failed: ${err instanceof Error ? err.stack ?? err.message : String(err)}`);
    process.exit(1);
  });
