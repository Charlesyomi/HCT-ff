'use client';

import { useState } from 'react';
import { Minus, Plus } from 'lucide-react';
import type { CartLineInput } from '@/lib/cart-api';
import { useCartStore } from '@/lib/cart-store';

const FISH_CHOICES = [
    { value: 'any', label: 'Either' },
    { value: 'clarias', label: 'Clarias' },
    { value: 'hybrid', label: 'Hybrid' },
] as const;

const STEP_KG = 5;

export function AddToCartControl({
    sizeSlug,
    sizeLabel,
    defaultFishType = 'any',
    minOrderKg,
    maxOrderKg,
}: {
    sizeSlug: string;
    sizeLabel: string;
    defaultFishType?: CartLineInput['fish_type'];
    minOrderKg: number;
    maxOrderKg: number;
}) {
    const addLine = useCartStore((state) => state.addLine);
    const [fishType, setFishType] = useState<CartLineInput['fish_type']>(defaultFishType);
    // The stepper starts at the minimum order so the first add is always submittable.
    const [quantity, setQuantity] = useState(minOrderKg);
    const [added, setAdded] = useState(false);

    const clamp = (value: number) => Math.min(Math.max(value, minOrderKg), maxOrderKg);

    return (
        <div className="mt-4 space-y-3">
            <div className="flex flex-wrap items-center gap-2">
                <label className="text-xs font-semibold text-ink-muted" htmlFor={`fish-${sizeSlug}`}>
                    Fish
                </label>
                <select
                    id={`fish-${sizeSlug}`}
                    value={fishType}
                    onChange={(event) => setFishType(event.target.value as CartLineInput['fish_type'])}
                    className="min-h-11 rounded-full border border-line-soft bg-canvas px-3 text-sm"
                >
                    {FISH_CHOICES.map((choice) => (
                        <option key={choice.value} value={choice.value}>
                            {choice.label}
                        </option>
                    ))}
                </select>
                <div className="flex items-center gap-1 rounded-full border border-line-soft px-1">
                    <button
                        type="button"
                        aria-label={`Reduce ${sizeLabel} kilograms`}
                        onClick={() => setQuantity((value) => clamp(value - STEP_KG))}
                        disabled={quantity <= minOrderKg}
                        className="flex h-9 w-9 items-center justify-center rounded-full disabled:opacity-40"
                    >
                        <Minus aria-hidden="true" size={16} />
                    </button>
                    <input
                        type="number"
                        aria-label={`${sizeLabel} kilograms`}
                        value={quantity}
                        min={minOrderKg}
                        max={maxOrderKg}
                        step={STEP_KG}
                        onChange={(event) => setQuantity(clamp(Number(event.target.value) || minOrderKg))}
                        className="w-16 bg-transparent text-center text-sm"
                    />
                    <button
                        type="button"
                        aria-label={`Increase ${sizeLabel} kilograms`}
                        onClick={() => setQuantity((value) => clamp(value + STEP_KG))}
                        disabled={quantity >= maxOrderKg}
                        className="flex h-9 w-9 items-center justify-center rounded-full disabled:opacity-40"
                    >
                        <Plus aria-hidden="true" size={16} />
                    </button>
                </div>
            </div>
            <button
                type="button"
                onClick={() => {
                    void addLine({ fish_type: fishType, size: sizeSlug, quantity_kg: quantity });
                    setAdded(true);
                    window.setTimeout(() => setAdded(false), 1_500);
                }}
                className="inline-flex min-h-11 w-full items-center justify-center rounded-full bg-[color:var(--brand-700)] px-4 py-2.5 text-sm font-semibold text-white transition hover:bg-[color:var(--brand-900)]"
            >
                {added ? 'Added to cart' : 'Add to cart'}
            </button>
        </div>
    );
}