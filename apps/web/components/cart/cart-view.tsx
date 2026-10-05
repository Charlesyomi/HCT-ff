'use client';

import Link from 'next/link';
import { Minus, Plus, Trash2 } from 'lucide-react';
import { formatKobo } from '@/lib/money';
import { toLineInputs, useCartStore } from '@/lib/cart-store';

const STEP_KG = 5;

function fishLabel(fishType: string): string {
    if (fishType === 'clarias') return 'Clarias';
    if (fishType === 'hybrid') return 'Hybrid';
    return 'Either fish';
}

export function CartView({ minOrderKg = 40 }: { minOrderKg?: number }) {
    const lines = useCartStore((state) => state.lines);
    const totalKobo = useCartStore((state) => state.indicativeTotalKobo);
    const status = useCartStore((state) => state.status);
    const error = useCartStore((state) => state.error);
    const retrySave = useCartStore((state) => state.retrySave);
    const setQuantity = useCartStore((state) => state.setQuantity);
    const removeLine = useCartStore((state) => state.removeLine);

    const totalKg = lines.reduce((sum, line) => sum + line.quantity_kg, 0);
    const underMinimum = lines.length > 0 && totalKg < minOrderKg;

    if (lines.length === 0) {
        return (
            <div className="mt-8 border-y border-line-soft py-10 text-center">
                <p className="font-display text-xl font-bold text-ink">Your cart is empty</p>
                <p className="mx-auto mt-2 max-w-md text-sm text-ink-muted">
                    Add a size from Our Fish and we will keep it here while you decide.
                </p>
                <Link
                    href="/our-fish"
                    className="mt-6 inline-flex min-h-11 items-center rounded-full bg-[color:var(--brand-700)] px-5 font-semibold text-white"
                >
                    Browse sizes
                </Link>
            </div>
        );
    }

    return (
        <div className="mt-8 grid gap-8 lg:grid-cols-[minmax(0,1fr)_320px]">
            <div>
                {error ? (
                    <div role="alert" className="mb-4 flex items-center justify-between gap-3 border-l-4 border-[color:var(--status-error)] bg-[color:var(--brand-100)] px-4 py-3 text-sm text-brand-900">
                        <span>{error}</span>
                        <button type="button" onClick={() => void retrySave()} className="rounded-full border border-brand-700 px-3 py-1 font-semibold">
                            Retry
                        </button>
                    </div>
                ) : null}
                <ul className="divide-y divide-line-soft border-y border-line-soft">
                    {lines.map((line) => (
                        <li key={`${line.fish_type}:${line.size}`} className="flex flex-wrap items-center justify-between gap-4 py-4">
                            <div className="min-w-0">
                                <p className="font-display text-lg font-bold text-ink">{line.size_label}</p>
                                <p className="text-sm text-ink-muted">{fishLabel(line.fish_type)}</p>
                            </div>
                            <div className="flex items-center gap-3">
                                <div className="flex items-center gap-1 rounded-full border border-line-soft px-1">
                                    <button
                                        type="button"
                                        aria-label={`Reduce ${line.size_label} kilograms`}
                                        onClick={() =>
                                            void setQuantity(line.fish_type, line.size, Math.max(1, line.quantity_kg - STEP_KG))
                                        }
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
            </div>
            <aside className="h-fit border-l-4 border-[color:var(--brand-700)] bg-[color:var(--brand-100)] p-5">
                <h2 className="font-display text-xl font-bold text-ink">Estimated total</h2>
                <dl className="mt-3 space-y-2 text-sm">
                    <div className="flex justify-between">
                        <dt className="text-ink-muted">Total weight</dt>
                        <dd className="font-semibold text-ink">{totalKg}kg</dd>
                    </div>
                    <div className="flex justify-between">
                        <dt className="text-ink-muted">Estimate</dt>
                        <dd className="font-semibold text-ink">
                            {totalKobo != null ? formatKobo(totalKobo) : 'Price on request'}
                        </dd>
                    </div>
                </dl>
                <p className="mt-3 text-xs text-ink-muted">
                    {status === 'saving'
                        ? 'Saving…'
                        : 'Indicative only. The farm confirms your final price before anything is agreed.'}
                </p>
                {underMinimum ? (
                    <p role="status" className="mt-3 text-sm font-semibold text-brand-900">
                        Add at least {minOrderKg}kg in total to request a quote.
                    </p>
                ) : null}
                <Link
                    href="/checkout"
                    aria-disabled={underMinimum}
                    className={`mt-5 inline-flex min-h-11 w-full items-center justify-center rounded-full px-4 font-semibold text-white ${
                        underMinimum
                            ? 'pointer-events-none bg-[color:var(--ink-muted)]'
                            : 'bg-[color:var(--brand-700)]'
                    }`}
                >
                    Review &amp; request
                </Link>
                <p className="mt-3 text-center text-xs text-ink-muted">
                    {toLineInputs(lines).length} line(s) will be sent as one request.
                </p>
            </aside>
        </div>
    );
}