'use client';

import Link from 'next/link';
import { ShoppingBasket } from 'lucide-react';
import { useCartStore } from '@/lib/cart-store';

/** Header cart icon with a line count, plus the quiet save-state indicator. */
export function CartButton() {
    const lines = useCartStore((state) => state.lines);
    const status = useCartStore((state) => state.status);
    const error = useCartStore((state) => state.error);
    const retrySave = useCartStore((state) => state.retrySave);
    const count = lines.length;

    return (
        <div className="flex items-center gap-3">
            {error ? (
                <span role="alert" className="flex items-center gap-2 text-xs text-status-error">
                    <span>{error}</span>
                    <button
                        type="button"
                        onClick={() => void retrySave()}
                        className="rounded-full border border-current px-2 py-0.5 font-semibold"
                    >
                        Retry
                    </button>
                </span>
            ) : (
                <span aria-live="polite" className="hidden text-xs text-ink-muted sm:inline">
                    {status === 'saving' ? 'Saving…' : count > 0 ? 'Synced' : ''}
                </span>
            )}
            <Link
                href="/cart"
                aria-label={`Cart, ${count} ${count === 1 ? 'item' : 'items'}`}
                className="relative flex min-h-11 min-w-11 items-center justify-center rounded-full border border-line-soft text-ink transition hover:bg-[color:var(--brand-100)]"
            >
                <ShoppingBasket aria-hidden="true" size={20} />
                {count > 0 ? (
                    <span className="absolute -right-1 -top-1 flex h-5 min-w-5 items-center justify-center rounded-full bg-[color:var(--brand-700)] px-1 text-[10px] font-bold text-white">
                        {count}
                    </span>
                ) : null}
            </Link>
        </div>
    );
}