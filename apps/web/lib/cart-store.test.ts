// @vitest-environment jsdom

import { beforeEach, describe, expect, it, vi } from 'vitest';
import { CartError, EMPTY_CART, type Cart, type CartLine } from './cart-api';
import { mergeLines, toLineInputs, useCartStore } from './cart-store';
import * as api from './cart-api';

vi.mock('./cart-api', async () => {
    const actual = await vi.importActual<typeof import('./cart-api')>('./cart-api');
    return {
        ...actual,
        isSignedIn: vi.fn(),
        fetchCart: vi.fn(),
        putCart: vi.fn(),
        deleteRemoteCart: vi.fn(),
    };
});

function line(overrides: Partial<CartLine> = {}): CartLine {
    return {
        fish_type: 'clarias',
        size: '2-3kg',
        size_label: '2 – 3kg',
        quantity_kg: 100,
        indicative_unit_price_kobo: 5000,
        line_total_kobo: 500_000,
        ...overrides,
    };
}

function cart(items: CartLine[], version = 1): Cart {
    return {
        items,
        version,
        updated_at: '2026-10-04T10:00:00+00:00',
        indicative_total_kobo: items.reduce((sum, item) => sum + (item.line_total_kobo ?? 0), 0),
    };
}

function resetStore() {
    window.localStorage.clear();
    useCartStore.setState({
        lines: [],
        version: 0,
        indicativeTotalKobo: null,
        signedIn: false,
        hydrated: false,
        status: 'idle',
        error: null,
        pendingRetry: null,
    });
}

beforeEach(() => {
    resetStore();
    vi.mocked(api.isSignedIn).mockReset().mockResolvedValue(false);
    vi.mocked(api.fetchCart).mockReset().mockResolvedValue(EMPTY_CART);
    vi.mocked(api.putCart).mockReset().mockResolvedValue(EMPTY_CART);
    vi.mocked(api.deleteRemoteCart).mockReset().mockResolvedValue(undefined);
});

describe('mergeLines', () => {
    it('sums duplicate fish and size lines and keeps the order', () => {
        expect(
            mergeLines([
                { fish_type: 'clarias', size: '2-3kg', quantity_kg: 30 },
                { fish_type: 'hybrid', size: '1-5-2kg', quantity_kg: 40 },
                { fish_type: 'clarias', size: '2-3kg', quantity_kg: 70 },
            ]),
        ).toEqual([
            { fish_type: 'clarias', size: '2-3kg', quantity_kg: 100 },
            { fish_type: 'hybrid', size: '1-5-2kg', quantity_kg: 40 },
        ]);
    });
});

describe('guest cart', () => {
    it('adds, edits and removes lines in localStorage without touching the API', async () => {
        await useCartStore.getState().hydrate();

        await useCartStore.getState().addLine({ fish_type: 'any', size: '2-3kg', quantity_kg: 40 });
        expect(useCartStore.getState().lines).toHaveLength(1);
        expect(JSON.parse(window.localStorage.getItem('adesoba-cart') ?? '[]')).toEqual([
            { fish_type: 'any', size: '2-3kg', quantity_kg: 40 },
        ]);

        await useCartStore.getState().setQuantity('any', '2-3kg', 120);
        expect(useCartStore.getState().lines[0].quantity_kg).toBe(120);

        await useCartStore.getState().removeLine('any', '2-3kg');
        expect(useCartStore.getState().lines).toEqual([]);
        expect(window.localStorage.getItem('adesoba-cart')).toBeNull();
        expect(api.putCart).not.toHaveBeenCalled();
    });

    it('merges a repeated add into the existing line', async () => {
        await useCartStore.getState().hydrate();
        await useCartStore.getState().addLine({ fish_type: 'clarias', size: '2-3kg', quantity_kg: 40 });
        await useCartStore.getState().addLine({ fish_type: 'clarias', size: '2-3kg', quantity_kg: 60 });

        const lines = useCartStore.getState().lines;
        expect(lines).toHaveLength(1);
        expect(lines[0].quantity_kg).toBe(100);
    });
});

describe('signed-in cart', () => {
    it('sends the new version back after a save', async () => {
        vi.mocked(api.isSignedIn).mockResolvedValue(true);
        vi.mocked(api.putCart).mockResolvedValue(cart([line()], 1));
        await useCartStore.getState().hydrate();

        await useCartStore.getState().addLine({ fish_type: 'clarias', size: '2-3kg', quantity_kg: 100 });

        expect(api.putCart).toHaveBeenCalledWith(
            [{ fish_type: 'clarias', size: '2-3kg', quantity_kg: 100 }],
            0,
        );
        expect(useCartStore.getState().version).toBe(1);
        expect(useCartStore.getState().status).toBe('synced');
    });

    it('merges the guest cart into the server cart once, then clears local storage', async () => {
        window.localStorage.setItem(
            'adesoba-cart',
            JSON.stringify([{ fish_type: 'any', size: '1-5-2kg', quantity_kg: 50 }]),
        );
        vi.mocked(api.isSignedIn).mockResolvedValue(true);
        vi.mocked(api.fetchCart).mockResolvedValue(cart([line()], 1));
        vi.mocked(api.putCart).mockResolvedValue(
            cart([line(), line({ fish_type: 'any', size: '1-5-2kg', size_label: '1.5 – 2kg', quantity_kg: 50 })], 2),
        );

        await useCartStore.getState().hydrate();

        expect(api.putCart).toHaveBeenCalledWith(
            [
                { fish_type: 'clarias', size: '2-3kg', quantity_kg: 100 },
                { fish_type: 'any', size: '1-5-2kg', quantity_kg: 50 },
            ],
            1,
        );
        expect(window.localStorage.getItem('adesoba-cart')).toBeNull();
        expect(useCartStore.getState().lines).toHaveLength(2);
    });

    it('refetches and re-applies the change when the version is stale', async () => {
        vi.mocked(api.isSignedIn).mockResolvedValue(true);
        vi.mocked(api.fetchCart).mockResolvedValue(EMPTY_CART);
        vi.mocked(api.putCart)
            // The first write races another device and is rejected.
            .mockRejectedValueOnce(new CartError('Cart version mismatch.', 409))
            // After the refetch the newer version is used.
            .mockResolvedValueOnce(cart([line({ quantity_kg: 250 })], 7));
        await useCartStore.getState().hydrate();
        useCartStore.setState({ signedIn: true, hydrated: true });

        await useCartStore.getState().addLine({ fish_type: 'clarias', size: '2-3kg', quantity_kg: 250 });

        expect(api.fetchCart).toHaveBeenCalledTimes(2);
        expect(api.putCart).toHaveBeenNthCalledWith(
            2,
            [{ fish_type: 'clarias', size: '2-3kg', quantity_kg: 250 }],
            0,
        );
        expect(useCartStore.getState().lines[0].quantity_kg).toBe(250);
        expect(useCartStore.getState().error).toBeNull();
    });

    it('surfaces a save failure with a retry that replays the same lines', async () => {
        vi.mocked(api.isSignedIn).mockResolvedValue(true);
        vi.mocked(api.fetchCart).mockResolvedValue(EMPTY_CART);
        vi.mocked(api.putCart)
            .mockRejectedValueOnce(new CartError('The farm is unreachable.', 503))
            .mockResolvedValueOnce(cart([line()], 1));
        await useCartStore.getState().hydrate();
        useCartStore.setState({ signedIn: true, hydrated: true });

        await useCartStore.getState().addLine({ fish_type: 'clarias', size: '2-3kg', quantity_kg: 100 });
        expect(useCartStore.getState().status).toBe('error');
        expect(useCartStore.getState().error).toBe('The farm is unreachable.');

        await useCartStore.getState().retrySave();

        expect(api.putCart).toHaveBeenCalledTimes(2);
        expect(useCartStore.getState().status).toBe('synced');
        expect(useCartStore.getState().error).toBeNull();
    });

    it('clears the server cart when the last line is removed', async () => {
        vi.mocked(api.isSignedIn).mockResolvedValue(true);
        vi.mocked(api.fetchCart).mockResolvedValue(cart([line()], 1));
        await useCartStore.getState().hydrate();
        expect(useCartStore.getState().lines).toHaveLength(1);

        await useCartStore.getState().removeLine('clarias', '2-3kg');

        expect(api.deleteRemoteCart).toHaveBeenCalledOnce();
        expect(useCartStore.getState().lines).toEqual([]);
        expect(useCartStore.getState().version).toBe(0);
    });
});

describe('toLineInputs', () => {
    it('drops the price fields the API computes itself', () => {
        expect(toLineInputs([line()])).toEqual([
            { fish_type: 'clarias', size: '2-3kg', quantity_kg: 100 },
        ]);
    });
});