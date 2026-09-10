'use client';

/**
 * src/components/cashier/alarm-bar.tsx
 *
 * The full-width red "Audio & Haptic Sensor Telemetry Strip" from the
 * Stitch "Alerts & Pagers" screen. It sits directly under the console
 * top bar on EVERY tab and stays until a staff member acknowledges
 * ("attending") or resolves ("attended") the alert from the Alerts &
 * Pagers view — clicking the bar jumps there.
 */

import { useNow } from '@/components/providers/clock-provider';
import { getElapsedSec } from '@/lib/time';
import { BellRing } from 'lucide-react';

function mmss(sec: number): string {
  if (sec >= 3600) return '60:00+';
  const m = Math.floor(sec / 60);
  const s = sec % 60;
  return `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
}

const BARS = ['h-2', 'h-5', 'h-3', 'h-4', 'h-5', 'h-2', 'h-4'];
const DELAYS = ['', 'delay-75', 'delay-150', 'delay-100', 'delay-200', 'delay-75', 'delay-150'];

export function AlarmBar({
  count,
  sinceMs,
  terminalLabel,
  onOpen,
}: {
  count: number;
  sinceMs: number;
  terminalLabel: string;
  onOpen: () => void;
}) {
  const now = useNow();
  const elapsed = getElapsedSec(sinceMs, now);

  return (
    <button
      type="button"
      onClick={onOpen}
      className="flex w-full items-center justify-between gap-4 border-b border-[#F19999] bg-[#FFDAD6] px-6 py-3 text-left text-[#93000A] shadow-sm transition-colors hover:bg-[#FFCFCB]"
    >
      <div className="flex min-w-0 items-center gap-3">
        <span className="relative flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-[#BA1A1A] text-white">
          <BellRing className="h-4 w-4" />
          <span className="absolute inset-0 animate-ping rounded-full bg-[#BA1A1A] opacity-60" />
        </span>
        <div className="flex min-w-0 flex-col">
          <span className="flex flex-wrap items-center gap-x-2 gap-y-0.5 text-xs font-bold uppercase tracking-wider text-[#BA1A1A]">
            Alarm sounding (looping: beep-chime 98dB)
            <span className="inline-block h-1.5 w-1.5 rounded-full bg-[#BA1A1A]" />
            Taptic pulse active [dual vibration motors]
          </span>
          <span className="truncate text-[11px] font-medium text-[#7A1E22]">
            Terminal Node: {terminalLabel} · {mmss(elapsed)} elapsed · Auto-Escalate at 01:00m
            {count > 1 ? ` · ${count} alerts queued` : ''}
          </span>
        </div>
      </div>

      <div className="flex shrink-0 items-center gap-4">
        <span className="hidden items-end gap-1 rounded-lg bg-[#BA1A1A]/10 px-3 py-1 sm:flex" aria-hidden="true">
          {BARS.map((h, i) => (
            <span key={i} className={`w-1 animate-pulse rounded-full bg-[#BA1A1A] ${h} ${DELAYS[i]}`} />
          ))}
        </span>
        <span className="rounded bg-[#BA1A1A] px-3 py-1 text-[10px] font-bold uppercase tracking-widest text-white">
          Priority 1 SLA Critical
        </span>
      </div>
    </button>
  );
}
