'use client';

/**
 * src/components/manager/overview-chart.tsx
 *
 * "Order Volume & Peak Rush Hours" — the 7-day area/line chart from the
 * Stitch design, drawn as inline SVG (no chart library). Toggles between
 * order count and gross revenue; "Dine-In vs Takeaway" is shown but
 * disabled (that split isn't recorded on an order yet). Renders fine
 * with all-zero data — it just draws a flat baseline.
 */

import { useMemo, useState } from 'react';
import { formatMoney } from '@/lib/format/money';

type Series = 'count' | 'revenue';

interface Day {
  label: string;
  date: string;
  count: number;
  revenueFils: number;
  isToday: boolean;
}

const W = 740;
const H = 240;
const PAD_L = 40;
const PAD_R = 40;
const PAD_T = 20;
const PAD_B = 30;

export function OverviewChart({ week, currency }: { week: Day[]; currency: string }) {
  const [series, setSeries] = useState<Series>('count');

  const values = week.map((d) => (series === 'count' ? d.count : d.revenueFils));
  const max = Math.max(1, ...values);
  const peak = week.reduce((a, b) => (b.count > a.count ? b : a), week[0]);
  const low = week.reduce((a, b) => (b.count < a.count ? b : a), week[0]);

  const points = useMemo(() => {
    const innerW = W - PAD_L - PAD_R;
    const innerH = H - PAD_T - PAD_B;
    return values.map((v, i) => {
      const x = PAD_L + (week.length === 1 ? 0 : (i / (week.length - 1)) * innerW);
      const y = PAD_T + innerH - (v / max) * innerH;
      return { x, y };
    });
  }, [values, max, week.length]);

  const linePath = points.map((p, i) => `${i === 0 ? 'M' : 'L'} ${p.x.toFixed(1)} ${p.y.toFixed(1)}`).join(' ');
  const areaPath =
    points.length > 0
      ? `${linePath} L ${points[points.length - 1].x.toFixed(1)} ${H - PAD_B} L ${points[0].x.toFixed(1)} ${H - PAD_B} Z`
      : '';

  const gridYs = [0, 0.25, 0.5, 0.75, 1].map((f) => PAD_T + (H - PAD_T - PAD_B) * f);

  const fmt = (v: number) => (series === 'count' ? String(v) : formatMoney(v, currency));

  return (
    <div className="rounded-lg border border-[#E5E7EB] bg-white p-5 shadow-sm">
      <div className="flex flex-col gap-3 pb-3 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <div className="flex items-center gap-2">
            <h2 className="text-base font-bold text-[#1F2937]">Order Volume &amp; Peak Rush Hours</h2>
            <span className="rounded bg-[#E5E7EB] px-2 py-0.5 text-[10px] font-bold uppercase text-[#4B5563]">
              Past 7 days
            </span>
          </div>
          <p className="mt-0.5 text-xs text-[#6B7280]">Rolling throughput from table calls and POS terminals</p>
        </div>
        <div className="flex shrink-0 items-center gap-3 rounded-lg bg-[#F3F4F6] px-3 py-1.5">
          <div>
            <span className="block text-[10px] text-[#6B7280]">Peak record</span>
            <span className="text-sm font-bold text-[#1F2937]">
              {peak.label}: {peak.count}
            </span>
          </div>
          <span className="h-6 w-px bg-[#D9E3F6]" />
          <div>
            <span className="block text-[10px] text-[#6B7280]">Base floor</span>
            <span className="text-sm font-bold text-[#1F2937]">
              {low.label}: {low.count}
            </span>
          </div>
        </div>
      </div>

      <div className="w-full overflow-x-auto">
        <svg viewBox={`0 0 ${W} ${H}`} className="h-[240px] w-full min-w-[560px]" role="img" aria-label="7-day order volume">
          <defs>
            <linearGradient id="tbChartFill" x1="0" x2="0" y1="0" y2="1">
              <stop offset="0%" stopColor="#0F5257" stopOpacity="0.28" />
              <stop offset="90%" stopColor="#0F5257" stopOpacity="0.02" />
            </linearGradient>
          </defs>

          {gridYs.map((y, i) => (
            <line key={i} x1={PAD_L} x2={W - PAD_R} y1={y} y2={y} stroke="#EFF4FF" strokeWidth="1.5" strokeDasharray="4 4" />
          ))}

          {areaPath ? <path d={areaPath} fill="url(#tbChartFill)" /> : null}
          {linePath ? (
            <path d={linePath} fill="none" stroke="#0F5257" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" />
          ) : null}

          {points.map((p, i) => (
            <g key={i}>
              {week[i].isToday ? (
                <>
                  <line x1={p.x} x2={p.x} y1={PAD_T} y2={H - PAD_B} stroke="#0F5257" strokeWidth="1.5" strokeDasharray="3 3" opacity="0.5" />
                  <circle cx={p.x} cy={p.y} r="8" fill="#A1F0C7" fillOpacity="0.5" />
                  <circle cx={p.x} cy={p.y} r="5" fill="#0F5257" stroke="#fff" strokeWidth="2.5" />
                </>
              ) : (
                <circle cx={p.x} cy={p.y} r="4" fill="#fff" stroke="#0F5257" strokeWidth="2.5" />
              )}
              <text x={p.x} y={H - 10} textAnchor="middle" fontSize="12" fontFamily="Inter" fill={week[i].isToday ? '#003A3E' : '#707979'} fontWeight={week[i].isToday ? 700 : 400}>
                {week[i].label}
              </text>
              <title>
                {week[i].label}: {fmt(values[i])}
              </title>
            </g>
          ))}
        </svg>
      </div>

      <div className="mt-3 flex flex-wrap items-center justify-between gap-3 border-t border-[#EFF4FF] pt-3">
        <div className="flex items-center gap-1 rounded-lg bg-[#F3F4F6] p-1">
          <Pill active={series === 'count'} onClick={() => setSeries('count')}>
            Order count
          </Pill>
          <Pill active={series === 'revenue'} onClick={() => setSeries('revenue')}>
            Net revenue
          </Pill>
          <Pill active={false} disabled>
            Dine-in vs takeaway
          </Pill>
        </div>
        <div className="flex items-center gap-4 text-xs text-[#6B7280]">
          <span className="flex items-center gap-1.5">
            <span className="h-1 w-3 rounded-full bg-[#0F5257]" /> Current cycle
          </span>
          <span className="flex items-center gap-1.5">
            <span className="h-1 w-3 rounded-full bg-[#BFC8C9]" /> 4-wk avg baseline
          </span>
        </div>
      </div>
    </div>
  );
}

function Pill({
  children,
  active,
  disabled,
  onClick,
}: {
  children: React.ReactNode;
  active: boolean;
  disabled?: boolean;
  onClick?: () => void;
}) {
  return (
    <button
      type="button"
      disabled={disabled}
      onClick={onClick}
      className={`rounded-md px-3 py-1.5 text-sm font-semibold transition-colors ${
        active
          ? 'bg-white text-[#0F5257] shadow-sm'
          : disabled
            ? 'cursor-not-allowed text-[#9CA3AF]'
            : 'text-[#4B5563] hover:text-[#1F2937]'
      }`}
    >
      {children}
    </button>
  );
}
