'use client';

/**
 * src/components/manager/qr-print-sheet.tsx
 *
 * The printable table-tent sheet for Manager Table Management. Given a
 * set of tables it renders one tent card each — restaurant name, a
 * "scan to order" prompt, the QR, the table label + zone, and a small
 * slug footer for physical verification — and an `@media print` block
 * that isolates just the sheet so the browser's own Print dialog
 * (`window.print()`) produces clean pages with nothing else on them.
 *
 * The QR encodes the REAL guest boot URL, `${appUrl}/t/{slug}` — the
 * opaque cryptographic slug, per ARCHITECTURE.md §8.1. No tenant name,
 * branch, or table id appears in it.
 *
 * SVG QR via `qrcode-generator` (pure JS, no `fs`, browser-safe) — vector
 * output prints crisp at any tent size.
 */

import { useEffect, useMemo, useState } from 'react';
import qrcode from 'qrcode-generator';

export interface QrPrintTable {
  id: string;
  code: string;
  label: string;
  zoneId: string;
  slug: string;
}

interface QrPrintSheetProps {
  restaurantName: string;
  appUrl: string;
  tables: QrPrintTable[];
  onClose: () => void;
}

function guestUrl(appUrl: string, slug: string): string {
  return `${appUrl}/t/${slug}`;
}

function qrSvg(text: string): string {
  const qr = qrcode(0, 'M');
  qr.addData(text);
  qr.make();
  return qr.createSvgTag({ cellSize: 4, margin: 1, scalable: true });
}

export function QrPrintSheet({ restaurantName, appUrl, tables, onClose }: QrPrintSheetProps) {
  const urls = useMemo(
    () => tables.map((t) => ({ ...t, url: guestUrl(appUrl, t.slug) })),
    [tables, appUrl],
  );

  const [svgs, setSvgs] = useState<Record<string, string>>({});
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    try {
      const next: Record<string, string> = {};
      for (const t of urls) next[t.id] = qrSvg(t.url);
      setSvgs(next);
      setFailed(false);
    } catch {
      setFailed(true);
    }
  }, [urls]);

  const ready = !failed && urls.every((t) => svgs[t.id]);

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label="Print table QR codes"
      className="fixed inset-0 z-50 flex flex-col bg-black/50"
    >
      <style>{`
        @media print {
          body { background: #ffffff !important; }
          body * { visibility: hidden !important; }
          #qr-print-area, #qr-print-area * { visibility: visible !important; }
          #qr-print-area { position: absolute; left: 0; top: 0; width: 100%; padding: 0; }
          .qr-no-print { display: none !important; }
          .qr-tent { break-inside: avoid; page-break-inside: avoid; }
        }
      `}</style>

      <div className="qr-no-print flex items-center justify-between border-b border-[#E5E7EB] bg-white px-4 py-3">
        <div>
          <p className="text-sm font-bold text-[#1F2937]">
            {tables.length === 1 ? `QR for ${tables[0].label}` : `${tables.length} table QR codes`}
          </p>
          <p className="text-xs text-[#6B7280]">Print, then trim and fold onto table tents / stickers.</p>
        </div>
        <div className="flex gap-2">
          <button
            type="button"
            onClick={onClose}
            className="h-10 rounded-lg border border-[#E5E7EB] bg-white px-3 text-sm font-semibold text-[#1F2937]"
          >
            Close
          </button>
          <button
            type="button"
            onClick={() => window.print()}
            disabled={!ready}
            className="h-10 rounded-lg bg-[#0F5257] px-4 text-sm font-semibold text-white disabled:opacity-50"
          >
            {ready ? 'Print' : 'Preparing…'}
          </button>
        </div>
      </div>

      <div className="flex-1 overflow-y-auto bg-[#F3F4F6] p-4">
        {failed ? (
          <p className="mx-auto max-w-md rounded-lg border border-[#E5484D]/30 bg-[#FDECEC] p-4 text-center text-sm text-[#7A1E22]">
            Couldn&apos;t generate the QR codes in this browser. Try again, or use a different browser.
          </p>
        ) : (
          <div id="qr-print-area" className="mx-auto grid max-w-4xl grid-cols-1 gap-4 sm:grid-cols-2">
            {urls.map((t) => (
              <div
                key={t.id}
                className="qr-tent flex flex-col items-center rounded-xl border border-[#E5E7EB] bg-white p-6 text-center"
              >
                <p className="text-xs font-semibold uppercase tracking-[0.15em] text-[#6B7280]">
                  {restaurantName}
                </p>
                <p className="mt-1 text-sm text-[#1F2937]">Scan to view the menu &amp; order</p>

                <div
                  className="mt-4 h-56 w-56"
                  aria-label={`QR code for ${t.label}`}
                  // trusted: markup produced locally by qrcode-generator from our own URL string
                  dangerouslySetInnerHTML={svgs[t.id] ? { __html: svgs[t.id] } : undefined}
                />

                <p className="mt-4 text-2xl font-bold text-[#1F2937]">{t.label}</p>
                {t.zoneId ? <p className="text-sm text-[#6B7280]">{t.zoneId}</p> : null}
                <p className="mt-3 break-all text-[10px] text-[#9CA3AF]">{t.url}</p>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
