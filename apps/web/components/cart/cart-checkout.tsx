'use client';

import { OrderFlow } from '@/components/order/order-flow';
import type { Catalog } from '@/lib/catalog-api';
import { toLineInputs, useCartStore } from '@/lib/cart-store';

/**
 * Checkout for a cart: the same Review & Confirm form as the single-line flow, but every cart
 * line is sent as ONE order with a single Idempotency-Key, and the cart is cleared on success.
 *
 * The cart is the source of truth here: when it has lines the review is built from the cart and
 * no order-form draft is needed, so arriving from /cart never bounces through /order. Only a
 * completely empty cart falls back to the draft flow.
 */
export function CartCheckout({
    catalog,
    minOrderKg = 40,
}: {
    catalog: Catalog | null;
    minOrderKg?: number;
}) {
    const hydrated = useCartStore((state) => state.hydrated);
    const lines = useCartStore((state) => state.lines);

    if (!hydrated) {
        return (
            <div role="status" aria-live="polite" aria-busy="true" className="mt-8 min-h-40 border-y border-line-soft py-8 text-sm text-ink-muted">
                Loading your cart…
            </div>
        );
    }

    const items = toLineInputs(lines);
    const totalKg = lines.reduce((sum, line) => sum + line.quantity_kg, 0);
    const hasCartLines = items.length > 0;

    return (
        <div>
            {hasCartLines ? (
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
            ) : null}
            <OrderFlow
                mode="review"
                catalog={catalog}
                initialSize={null}
                initialFishType={null}
                initialIntent={null}
                cartItems={hasCartLines ? items : undefined}
            />
        </div>
    );
}