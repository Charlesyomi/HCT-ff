'use client';

import { Minus, Plus, Trash2 } from 'lucide-react';
import { OrderFlow } from '@/components/order/order-flow';
import type { Catalog } from '@/lib/catalog-api';
import { formatKobo } from '@/lib/money';
import { toLineInputs, useCartStore } from '@/lib/cart-store';

const STEP_KG = 5;

/**
 * Checkout for a cart: the cart owns the items and the review form collects every order-level
 * field in one place. All lines go out as ONE order with a single Idempotency-Key, and the
 * cart is cleared once the farm accepts it.
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
    const totalKobo = useCartStore((state) => state.indicativeTotalKobo);
    const setQuantity = useCartStore((state) => state.setQuantity);
    const removeLine = useCartStore((state) => state.removeLine);

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
    const underMinimum = hasCartLines && totalKg < minOrderKg;

    return (
        <div>
            {hasCartLines ? (
                <section className="mt-8 border-y border-line-soft py-5" aria-labelledby="request-heading">
                    <h2 id="request-heading" className="font-display text-xl font-bold text-ink">
                        Your request ({lines.length} {lines.length === 1 ? 'item' : 'items'})
                    </h2>
                    <ul className="mt-4 divide-y divide-line-soft">
                        {lines.map((line) => (
                            <li key={`${line.fish_type}:${line.size}`} className="flex flex-wrap items-center justify-between gap-3 py-3">
                                <div className="min-w-0">
                                    <p className="font-semibold text-ink">{line.size_label}</p>
                                    <p className="text-sm text-ink-muted">
                                        {line.fish_type === 'any' ? 'Either fish' : line.fish_type === 'clarias' ? 'Clarias' : 'Hybrid'}
                                    </p>
                                </div>
                                <div className="flex items-center gap-3">
                                    <div className="flex items-center gap-1 rounded-full border border-line-soft px-1">
                                        <button
                                            type="button"
                                            aria-label={`Reduce ${line.size_label} kilograms`}
                                            onClick={() => void setQuantity(line.fish_type, line.size, Math.max(1, line.quantity_kg - STEP_KG))}
                                            className="flex h-9 w-9 items-center justify-center rounded-full"
                                        >
                                            <Minus aria-hidden="true" size={16} />
                                        </button>
                                        <input
                                            type="number"
                                            aria-label={`${line.size_label} kilograms`}
                                            value={line.quantity_kg}
                                            min={1}
                                            step={STEP_KG}
                                            onChange={(event) => {
                                                const next = Number(event.target.value);
                                                if (Number.isFinite(next) && next > 0) {
                                                    void setQuantity(line.fish_type, line.size, next);
                                                }
                                            }}
                                            className="w-20 bg-transparent text-center text-sm"
                                        />
                                        <button
                                            type="button"
                                            aria-label={`Increase ${line.size_label} kilograms`}
                                            onClick={() => void setQuantity(line.fish_type, line.size, line.quantity_kg + STEP_KG)}
                                            className="flex h-9 w-9 items-center justify-center rounded-full"
                                        >
                                            <Plus aria-hidden="true" size={16} />
                                        </button>
                                    </div>
                                    <span className="w-28 text-right text-sm font-semibold text-ink">
                                        {line.line_total_kobo != null ? formatKobo(line.line_total_kobo) : 'Price on request'}
                                    </span>
                                    <button
                                        type="button"
                                        onClick={() => void removeLine(line.fish_type, line.size)}
                                        aria-label={`Remove ${line.size_label}`}
                                        className="flex h-11 w-11 items-center justify-center rounded-full border border-line-soft text-ink-muted"
                                    >
                                        <Trash2 aria-hidden="true" size={16} />
                                    </button>
                                </div>
                            </li>
                        ))}
                    </ul>
                    <p className="mt-4 text-sm font-semibold text-ink">
                        {totalKg}kg total ·{' '}
                        {totalKobo != null ? `estimated ${formatKobo(totalKobo)}` : 'Price on request'}
                    </p>
                    {underMinimum ? (
                        <p role="status" className="mt-2 text-sm font-semibold text-brand-900">
                            Add at least {minOrderKg}kg in total so the farm can quote it.
                        </p>
                    ) : null}
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