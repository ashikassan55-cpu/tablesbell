'use client';

/**
 * src/components/marketing/savings-calculator.tsx
 *
 * The "UAE Payroll vs TableBells" estimator from the landing design.
 * A trigger button opens a modal with a table-count slider; the monthly
 * net-gain figure updates live. Pure illustration -- the assumptions
 * (servers needed, per-server cost, plan fee) are rounded rules of
 * thumb, shown as such.
 */

import { useMemo, useState } from 'react';
import { X, Calculator } from 'lucide-react';

const PER_SERVER_AED = 4500; // salary + visa + insurance, amortised
const TABLES_PER_SERVER = 6; // one server comfortably covers ~6 tables
const PLAN_FEE_AED = 349; // Bistro & Eatery plan

function planForTables(tables: number): number {
  if (tables <= 10) return 199;
  if (tables <= 25) return 349;
  return 549;
}

export function SavingsCalculator({
  trigger = 'button',
}: {
  /** `'button'` renders the standalone CTA; `'link'` renders an inline text link. */
  trigger?: 'button' | 'link';
}) {
  const [open, setOpen] = useState(false);
  const [tables, setTables] = useState(18);

  const { tradCost, planFee, net } = useMemo(() => {
    const serversNeeded = Math.max(1, Math.ceil(tables / TABLES_PER_SERVER));
    const traditional = serversNeeded * PER_SERVER_AED;
    const fee = planForTables(tables);
    return { tradCost: traditional, planFee: fee, net: traditional - fee };
  }, [tables]);

  const aed = (n: number) => `AED ${n.toLocaleString('en-AE')}`;

  return (
    <>
      {trigger === 'button' ? (
        <button
          type="button"
          onClick={() => setOpen(true)}
          className="inline-flex items-center justify-center gap-2 rounded-xl border border-guest-border-warm bg-white px-5 py-3.5 text-sm font-bold text-guest-primary shadow-sm transition-colors hover:bg-guest-primary-tint"
        >
          <Calculator className="h-5 w-5" />
          Calculate my savings
        </button>
      ) : (
        <button
          type="button"
          onClick={() => setOpen(true)}
          className="font-bold text-guest-primary underline underline-offset-2"
        >
          open the savings calculator
        </button>
      )}

      {open ? (
        <div
          className="fixed inset-0 z-[60] flex items-end justify-center bg-black/40 p-0 sm:items-center sm:p-4"
          role="dialog"
          aria-modal="true"
          aria-label="Payroll savings estimator"
          onClick={() => setOpen(false)}
        >
          <div
            className="w-full max-w-lg rounded-t-2xl bg-white p-5 shadow-2xl sm:rounded-2xl sm:p-6"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-start justify-between gap-3">
              <div className="flex items-center gap-2">
                <span className="flex h-9 w-9 items-center justify-center rounded-lg bg-guest-primary-tint text-guest-primary">
                  <Calculator className="h-5 w-5" />
                </span>
                <h3 className="font-heading text-lg font-bold text-guest-text">UAE payroll vs TableBells</h3>
              </div>
              <button
                type="button"
                onClick={() => setOpen(false)}
                aria-label="Close"
                className="rounded-lg p-1 text-guest-text-muted hover:bg-guest-canvas"
              >
                <X className="h-5 w-5" />
              </button>
            </div>

            <p className="mt-2 text-sm text-guest-text-muted">
              A rough monthly estimate. Assumes one extra server per {TABLES_PER_SERVER} tables at ~
              {aed(PER_SERVER_AED)}/mo including visa &amp; insurance.
            </p>

            <div className="mt-5">
              <div className="flex items-center justify-between">
                <label htmlFor="tables" className="text-sm font-semibold text-guest-text">
                  Dining tables
                </label>
                <span className="font-heading text-lg font-bold text-guest-primary">{tables} tables</span>
              </div>
              <input
                id="tables"
                type="range"
                min={4}
                max={60}
                value={tables}
                onChange={(e) => setTables(Number(e.target.value))}
                className="mt-2 w-full accent-guest-primary"
              />
              <div className="flex justify-between text-xs text-guest-text-muted">
                <span>4</span>
                <span>60</span>
              </div>
            </div>

            <div className="mt-4 grid grid-cols-2 gap-3">
              <div className="rounded-xl bg-guest-canvas p-4">
                <span className="text-xs font-bold uppercase tracking-wide text-guest-text-muted">
                  Traditional waiter cost
                </span>
                <p className="mt-1 font-heading text-xl font-bold text-guest-critical">{aed(tradCost)}</p>
                <span className="text-xs text-guest-text-muted">/ month</span>
              </div>
              <div className="rounded-xl bg-guest-canvas p-4">
                <span className="text-xs font-bold uppercase tracking-wide text-guest-tertiary">
                  With TableBells
                </span>
                <p className="mt-1 font-heading text-xl font-bold text-guest-tertiary">{aed(planFee)}</p>
                <span className="text-xs text-guest-text-muted">flat monthly fee</span>
              </div>
            </div>

            <div className="mt-3 rounded-xl bg-guest-primary-tint p-4 text-center">
              <span className="text-xs font-bold uppercase tracking-wide text-guest-primary">
                Estimated monthly net gain
              </span>
              <p className="font-heading text-2xl font-extrabold text-guest-primary">{aed(net)} / mo</p>
            </div>

            <a
              href="#demo"
              onClick={() => setOpen(false)}
              className="mt-4 flex w-full items-center justify-center rounded-xl bg-guest-primary px-4 py-3 text-sm font-bold text-white transition-colors hover:bg-[#d24e33]"
            >
              Lock in these savings
            </a>
          </div>
        </div>
      ) : null}
    </>
  );
}
