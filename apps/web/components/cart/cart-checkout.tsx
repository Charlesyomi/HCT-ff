'use client';

import { OrderFlow } from '@/components/order/order-flow';
import { toLineInputs, useCartStore } from '@/lib/cart-store';

/**
 * Checkout for a cart: the same Review & Confirm form as the single-line flow, but every cart
 * line is sent as ONE order with a single Idempotency-Key, and the cart is cleared on success.
 */
export function CartCheckout({ minOrderKg = 40 }: { minOrderKg?: number }) {
    const hydrated = useCartStore((state) => state.hydrated);
    const lines = useCartStore((state) => state.lines);

    if (!hydrated) {
        return (
            <div role="status" aria-live="polite" aria-busy="true" className="mt-8 min-h-40 border-y border-line-soft py-8 text-sm text-ink-muted">
                Loading your cart…
            </div>
        );
    }

    if (lines.length === 0) {
        return (
            <div className="mt-8 border-y border-line-soft py-10 text-center">
                <p className="font-display text-xl font-bold text-ink">There is nothing to request yet</p>
                <p className="mx-auto mt-2 max-w-md text-sm text-ink-muted">
                    Add a size to your cart and come back to send one request for everything.
                </p>
                <a href="/our-fish" className="mt-6 inline-flex min-h-11 items-center rounded-full bg-[color:var(--brand-700)] px-5 font-semibold text-white">
                    Browse sizes
                </a>
            </div>
        );
    }

    const items = toLineInputs(lines);
    const totalKg = lines.reduce((sum, line) => sum + line.quantity_kg, 0);

    return (
        <div>
            <section className="mt-8 border-y border-line-soft py-5">
                <h2 className="font-display text-xl font-bold text-ink">Your cart ({totalKg}kg)</h2>
                <ul className="mt-3 space-y-1 text-sm text-ink-muted">
                    {lines.map((line) => (
                        <li key={`${line.fish_type}:${line.size}`}>
                            {line.quantity_kg}kg · {line.size_label}
                        </li>
                    ))}
                </ul>
                {totalKg < minOrderKg ? (
                    <p role="status" className="mt-3 text-sm font-semibold text-brand-900">
                        Add at least {minOrderKg}kg in total so the farm can quote it.
                    </p>
                ) : null}
                <p className="mt-3 text-xs text-ink-muted">
                    All {items.length} line(s) are sent as one request.
                </p>
            </section>
            <OrderFlow
                mode="review"
                catalog={null}
                initialSize={null}
                initialFishType={null}
                initialIntent={null}
                cartItems={items}
            />
        </div>
    );
}