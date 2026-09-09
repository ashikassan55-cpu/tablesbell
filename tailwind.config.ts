import type { Config } from 'tailwindcss';

/**
 * tailwind.config.ts
 *
 * Every color below was extracted directly from the actual 45-file
 * `src/` tree (grep, not memory) -- this is the exact raw-hex debt
 * `MEMORY.md` §4 has been tracking, made into real, named tokens.
 *
 * THREE PALETTES, NOT TWO. ARCHITECTURE.md §7.3 specifies a two-value
 * `data-surface="guest"|"ops"` runtime toggle. What actually got built
 * is three visually distinct systems: guest (coral), KDS (dark -- an
 * explicit, repeatedly-flagged deviation from the light ops palette the
 * original Stitch review specified), and Cashier/Waiter (light, the
 * palette that review actually described). Forcing KDS's dark mode into
 * the existing two-value `data-surface` toggle -- as a CSS-custom-
 * property runtime swap -- was a live option here and was deliberately
 * NOT taken: it would require deciding whether dark KDS is a permanent,
 * formally-approved third state of `data-surface` or a still-provisional
 * exception, and that's a product decision, not a config-file one. This
 * file instead defines three flatly-named, always-available color
 * groups (`guest.*`, `kds.*`, `ops.*`) -- every existing raw hex now has
 * an unambiguous semantic class to become (`bg-guest-primary`,
 * `bg-kds-canvas`, `text-ops-text-muted`, ...). The runtime-toggle
 * question stays open for whoever wires `data-surface` onto a real
 * layout; nothing here forecloses it either way.
 *
 * SCOPE NOTE: this defines the tokens. It does NOT, by itself, rewrite
 * the ~26 client components that still contain raw `bg-[#...]` calls --
 * that swap is a separate, mechanical follow-up pass, not bundled into
 * this file's creation. The tokens exist now specifically so that pass
 * has something correct to swap onto.
 */

const config: Config = {
  content: ['./src/**/*.{js,ts,jsx,tsx,mdx}'],
  theme: {
    extend: {
      colors: {
        // ---- Guest surface (coral) --------------------------------
        guest: {
          primary: '#E85D3F',
          'primary-tint': '#FFF5F2',
          tertiary: '#4E937A',
          success: '#10B981',
          critical: '#E5484D',
          canvas: '#FAF9F6',
          border: '#E5E7EB',
          'border-warm': '#ECE7E1',
          text: '#1F2937',
          'text-muted': '#6B7280',
          'text-faint': '#9CA3AF',
        },

        // ---- KDS (dark, flagged deviation -- see file header) -----
        kds: {
          canvas: '#0B1220',
          surface: '#151E2E',
          'surface-sunken': '#0F1826',
          border: '#25324A',
          primary: '#14B8A6',
          'on-primary': '#04201C',
          success: '#22C55E',
          'on-success': '#052E12',
          'success-bright': '#4ADE80',
          'success-container': '#0F2318',
          'success-container-alt': '#16351F',
          warning: '#FBBF24',
          'warning-container': '#3A2A0E',
          critical: '#F87171',
          'critical-container': '#3B1418',
          text: '#F1F5F9',
          'text-secondary': '#E2E8F0',
          'text-soft': '#CBD5E1',
          'text-muted': '#94A3B8',
          'text-faint': '#64748B',
        },

        // ---- Cashier / Waiter Floor (light) -- ARCHITECTURE.md §7.3
        //      and the original Stitch utilitarian_pos_floor_console
        //      review; the palette actually described there.
        ops: {
          canvas: '#F3F4F6',
          surface: '#FFFFFF',
          primary: '#0F5257',
          success: '#2E7D5B',
          warning: '#D97706',
          'warning-container': '#FEF3C7',
          'warning-text': '#92400E',
          critical: '#E5484D',
          'critical-container': '#FDECEC',
          'critical-text': '#7A1E22',
          border: '#E5E7EB',
          'border-light': '#D1D5DB',
          text: '#1F2937',
          'text-muted': '#6B7280',
          'text-faint': '#9CA3AF',
        },
      },

      // Loaded for real now: `app/layout.tsx` pulls both families via
      // `next/font/google` and sets `--font-heading` / `--font-body` on
      // <html>. These stacks lead with those CSS variables and keep the
      // named-family + system fallbacks for the pre-swap flash. Names
      // match RULES.md §3's guest ("Plus Jakarta Sans headings, Inter
      // body") and ops ("Inter throughout") requirement.
      fontFamily: {
        heading: ['var(--font-heading)', '"Plus Jakarta Sans"', 'ui-sans-serif', 'system-ui', 'sans-serif'],
        body: ['var(--font-body)', 'Inter', 'ui-sans-serif', 'system-ui', 'sans-serif'],
      },
    },
  },
  plugins: [],
};

export default config;
