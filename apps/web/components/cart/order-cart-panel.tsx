'use client';

import Link from 'next/link';
import type { SizeClass } from '@/lib/catalog-api';
import { AddToCartControl } from './add-to-cart-control';

/**
 * "Add to cart" entry point on /order. The order form still handles a single-line request,
 * so the cart sits beside it as the multi-size path.
 */
export function OrderCartPanel({
    sizes,
    minOrderKg,
    maxOrderKg,
}: {
    sizes: SizeClass[];
    minOrderKg: number;
    maxOrderKg: number;
}) {
    const available = sizes.filter(
        (size) => size.status !== 'sold_out' && size.status !== 'unavailable',
    );
    if (available.length === 0) return null;

    return (
        <section className="mt-10 border-t border-line-soft pt-8">
            <h2 className="font-display text-2xl font-bold text-ink">Need more than one size?</h2>
            <p className="mt-2 max-w-2xl text-sm text-ink-muted">
                Add each size to your cart, then review everything together and send it as one request.
            </p>
            <ul className="mt-5 grid gap-5 sm:grid-cols-2 xl:grid-cols-4">
                {available.map((size) => (
                    <li key={size.slug} className="rounded-xl border border-line-soft bg-canvas p-4">
                        <p className="font-display text-lg font-bold text-ink">{size.label}</p>
                        <p className="mt-1 text-sm text-ink-muted">{size.descriptor}</p>
                        <AddToCartControl
                            sizeSlug={size.slug}
                            sizeLabel={size.label}
                            minOrderKg={minOrderKg}
                            maxOrderKg={maxOrderKg}
                        />
                    </li>
                ))}
            </ul>
            <Link href="/cart" className="mt-6 inline-flex min-h-11 items-center rounded-full border border-[color:var(--brand-700)] px-5 font-semibold text-[color:var(--brand-700)]">
                Go to cart
            </Link>
        </section>
    );
}