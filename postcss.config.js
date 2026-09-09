/**
 * postcss.config.js
 *
 * Not one of the four requested files -- added because it's a hard
 * requirement, not an optional companion: without this, Next.js's build
 * pipeline never invokes Tailwind at all, and tailwind.config.ts's
 * tokens compile to zero CSS. The project would still technically boot,
 * but render completely unstyled -- which fails "ready to boot" in any
 * meaningful sense.
 */
module.exports = {
  plugins: {
    tailwindcss: {},
    autoprefixer: {},
  },
};
