'use client';

/**
 * src/components/ops/station-filter.tsx
 *
 * Functional station tabs — unlike the guest surface's category row
 * (decorative in this pass, ARCHITECTURE.md-approved as a follow-up),
 * this is core KDS behavior and filters the queue live. Per
 * ARCHITECTURE.md §2.3: "Station tabs filter the already-streamed set
 * client-side. A listener per tab would multiply reads for no benefit" —
 * this component never re-fetches on tab change, it only changes which
 * already-loaded tickets `kds-queue-view.tsx` renders.
 */

export interface StationOption {
  id: string;
  label: string;
  count: number;
}

interface StationFilterProps {
  stations: StationOption[];
  activeStationId: string;
  onChange: (stationId: string) => void;
}

export function StationFilter({ stations, activeStationId, onChange }: StationFilterProps) {
  return (
    <nav aria-label="Filter by station" className="flex gap-2 overflow-x-auto">
      {stations.map((station) => {
        const isActive = station.id === activeStationId;
        return (
          <button
            key={station.id}
            type="button"
            onClick={() => onChange(station.id)}
            aria-pressed={isActive}
            className={[
              'flex h-11 shrink-0 items-center gap-2 rounded-lg px-4 text-sm font-semibold transition-colors',
              isActive ? 'bg-[#14B8A6] text-[#04201C]' : 'border border-[#25324A] bg-[#151E2E] text-[#CBD5E1]',
            ].join(' ')}
          >
            {station.label}
            <span
              className={[
                'flex h-5 min-w-5 items-center justify-center rounded-full px-1 text-xs font-bold tabular-nums',
                isActive ? 'bg-[#04201C]/20 text-[#04201C]' : 'bg-[#25324A] text-[#94A3B8]',
              ].join(' ')}
            >
              {station.count}
            </span>
          </button>
        );
      })}
    </nav>
  );
}
