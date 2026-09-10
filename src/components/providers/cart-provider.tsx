'use client';

/**
 * src/components/providers/cart-provider.tsx
 *
 * TEMPORARY in-memory cart state for the guest ordering UI scaffold.
 *
 * This is NOT the production cart. ARCHITECTURE.md §7.2 names the real
 * implementation as `hooks/use-cart.ts` — localStorage-backed, keyed by
 * `sessionId`, and ultimately feeding the guest's `orderRequests` create
 * path (firestore.rules §1.10) — rather than holding state in a bare React
 * Context with no persistence. This provider exists so the interactive UI
 * built across the menu and cart pages has something real to react to;
 * any component that calls `useCart()` should not need to change when the
 * real hook replaces this provider's internals.
 *
 * EXTENDED while building the cart/checkout page: the original version
 * only supported `addItem`. Adjusting a quantity and removing a line are
 * both required there, so `updateQty` and `removeItem` were added, along
 * with `note` (the single order-level free-text field, ARCHITECTURE.md
 * §1.7) and `clearCart` (used once an order has actually been submitted).
 *
 * EDITED AGAIN: the `deviceCookiePresent`/`onMissingDeviceCookie` props
 * and the mount effect that used them are gone. They existed only to
 * bootstrap a device cookie client-side before `middleware.ts` existed;
 * now that it does, every request under `/t/*` already carries a valid,
 * signed cookie by the time this component ever mounts, so that entire
 * concern left this file rather than becoming permanently-true dead
 * code sitting alongside the real signer. This provider is back to
 * being about exactly one thing: cart state.
 *
 * EDITED AGAIN, live-wiring the checkout flow: added `clientRequestId`,
 * the idempotency key `cart-checkout-view.tsx`'s real `orderRequests`
 * write uses (DECISIONS.md ADR-1; ARCHITECTURE.md's server side
 * deterministically derives `orderId = sha256(sessionId:clientRequestId)`
 * from it). It lives HERE, not in the checkout view, for a correctness
 * reason, not a convenience one: it must be STABLE across a retried
 * submit of the SAME cart contents (a network blip, a "try again" tap
 * after a rejection) -- reusing the id is exactly what makes that retry
 * idempotent rather than a second, duplicate order -- but it MUST
 * change the moment the cart's actual contents change, or a guest who
 * edits their order after a failed attempt would have the NEW order
 * silently deduplicated against the OLD one's id. `cart-provider.tsx`
 * is the one place that already sees every cart mutation, so it's the
 * only place that can enforce both halves of that correctly: every
 * mutating action below (`addItem`, `updateQty`, `removeItem`) rotates
 * the id; `clearCart` (called once checkout actually succeeds) rotates
 * it too, so the NEXT order this guest places -- same table, same
 * session, a completely different cart -- never collides with the one
 * that just succeeded.
 */

import { createContext, useCallback, useContext, useMemo, useState, type ReactNode } from 'react';

export interface MenuItem {
  id: string;
  categoryId: string;
  name: string;
  priceFils: number;
  badge?: string;
  dietaryTag?: string;
  imageUrl?: string;
  description?: string;
}

export interface CartLine {
  item: MenuItem;
  qty: number;
}

interface CartContextValue {
  lines: CartLine[];
  itemCount: number;
  totalFils: number;
  note: string;
  addItem: (item: MenuItem) => void;
  /** Sets the line's quantity directly. Floors at 1 — decrementing to
   *  zero does NOT remove the line; that is `removeItem`'s job, kept as a
   *  deliberate, separate action rather than an implicit side effect. */
  updateQty: (itemId: string, nextQty: number) => void;
  removeItem: (itemId: string) => void;
  setNote: (note: string) => void;
  clearCart: () => void;
  /** The idempotency key for THIS cart's next `orderRequests` submission
   *  — see this file's header. Stable across retries of the same cart;
   *  rotates on any mutation. */
  clientRequestId: string;
}

const CartContext = createContext<CartContextValue | null>(null);

interface CartProviderProps {
  children: ReactNode;
}

export function CartProvider({ children }: CartProviderProps) {
  const [lines, setLines] = useState<CartLine[]>([]);
  const [note, setNote] = useState('');
  const [clientRequestId, setClientRequestId] = useState(() => crypto.randomUUID());

  // NOTE deliberately does NOT rotate `clientRequestId` — see this file's
  // header. A guest editing only their note text after a rejected
  // submission (lines unchanged) reusing the same id is exactly the
  // correct retry, not a bug: no `orders/{orderId}` was ever created for
  // a rejected attempt, so resubmitting under the same id simply prices
  // the corrected note fresh. Only `lines` changing invalidates it.
  const addItem = useCallback((item: MenuItem) => {
    setLines((prev) => {
      const existingIndex = prev.findIndex((line) => line.item.id === item.id);
      if (existingIndex === -1) return [...prev, { item, qty: 1 }];

      return prev.map((line, index) => (index === existingIndex ? { ...line, qty: line.qty + 1 } : line));
    });
    setClientRequestId(crypto.randomUUID());
  }, []);

  const updateQty = useCallback((itemId: string, nextQty: number) => {
    setLines((prev) =>
      prev.map((line) => (line.item.id === itemId ? { ...line, qty: Math.max(1, nextQty) } : line)),
    );
    setClientRequestId(crypto.randomUUID());
  }, []);

  const removeItem = useCallback((itemId: string) => {
    setLines((prev) => prev.filter((line) => line.item.id !== itemId));
    setClientRequestId(crypto.randomUUID());
  }, []);

  const clearCart = useCallback(() => {
    setLines([]);
    setNote('');
    // Rotated here too: the NEXT order this guest places (same table,
    // same session, a new cart) must never be able to collide with the
    // one that just succeeded, however unlikely that collision actually
    // is in practice.
    setClientRequestId(crypto.randomUUID());
  }, []);

  const itemCount = useMemo(() => lines.reduce((sum, line) => sum + line.qty, 0), [lines]);
  const totalFils = useMemo(() => lines.reduce((sum, line) => sum + line.item.priceFils * line.qty, 0), [lines]);

  const value = useMemo<CartContextValue>(
    () => ({
      lines,
      itemCount,
      totalFils,
      note,
      addItem,
      updateQty,
      removeItem,
      setNote,
      clearCart,
      clientRequestId,
    }),
    [lines, itemCount, totalFils, note, addItem, updateQty, removeItem, clearCart, clientRequestId],
  );

  return <CartContext.Provider value={value}>{children}</CartContext.Provider>;
}

export function useCart(): CartContextValue {
  const context = useContext(CartContext);
  if (!context) {
    throw new Error('useCart() must be called within a <CartProvider>.');
  }
  return context;
}
