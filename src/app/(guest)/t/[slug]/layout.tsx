import type { ReactNode } from 'react';
import { CartProvider } from '@/components/providers/cart-provider';

/**
 * src/app/(guest)/t/[slug]/layout.tsx
 *
 * ARCHITECTURE.md §7.2 names this file's job explicitly: "guest theme
 * scope, session bootstrap, cart provider." An earlier pass placed
 * `<CartProvider>` inside `page.tsx` instead — a bug, since page-scoped
 * state doesn't survive navigating to a sibling route like `cart/`. That
 * was fixed by moving the provider here (a layout's tree persists across
 * navigation, a page's doesn't).
 *
 * EDITED AGAIN, fulfilling a promise made in this file's own previous
 * comment: the temporary client-side device-cookie bootstrap
 * (`initializeGuestDevice`, an unsigned-UUID fallback) is now deleted,
 * exactly as that comment said it should be "the moment middleware.ts
 * exists" — `src/middleware.ts` now runs on every `/t/*` request and
 * always sets a real, signed `tb_did` cookie (`server/auth/{device-cookie,
 * mint}.ts`) before this layout ever renders. Leaving the old fallback
 * running alongside the real signer would have meant two different code
 * paths that could both mint a device id — exactly what that comment
 * warned against.
 */

export default function GuestTableLayout({ children }: { children: ReactNode }) {
  return <CartProvider>{children}</CartProvider>;
}
