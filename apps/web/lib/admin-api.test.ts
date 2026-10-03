import { afterEach, describe, expect, it, vi } from 'vitest';
import {
    AdminApiError,
    adminFetch,
    createQuote,
    quoteTotalKobo,
    recordPayment,
    statusLabel,
    transitionOrder,
} from './admin-api';

afterEach(() => vi.unstubAllGlobals());

function stubFetch(response: Partial<Response> & { json?: () => Promise<unknown> }) {
    const stub = vi.fn().mockResolvedValue({
        ok: true,
        status: 200,
        json: async () => ({}),
        ...response,
    });
    vi.stubGlobal('fetch', stub);
    return stub;
}

describe('adminFetch', () => {
    it('sends the CSRF token when one is supplied', async () => {
        const stub = stubFetch({ json: async () => ({ ok: true }) });
        await adminFetch('/orders', { method: 'POST', csrfToken: 'token-123' });
        const init = stub.mock.calls[0][1] as RequestInit & { headers: Record<string, string> };
        expect(init.headers['X-CSRF-Token']).toBe('token-123');
        expect(init.credentials).toBe('same-origin');
    });

    it('omits the CSRF header on a read', async () => {
        const stub = stubFetch({ json: async () => ({}) });
        await adminFetch('/orders');
        const init = stub.mock.calls[0][1] as RequestInit & { headers: Record<string, string> };
        expect(init.headers['X-CSRF-Token']).toBeUndefined();
    });

    it('turns a 401 into a session-expired error', async () => {
        stubFetch({ ok: false, status: 401, json: async () => ({}) });
        await expect(adminFetch('/orders')).rejects.toMatchObject({ status: 401 });
    });

    it('surfaces the API detail message on other errors', async () => {
        stubFetch({ ok: false, status: 409, json: async () => ({ detail: 'Order was updated by someone else.' }) });
        await expect(adminFetch('/orders')).rejects.toThrow('Order was updated by someone else.');
    });

    it('falls back to a generic message when the body is unreadable', async () => {
        stubFetch({
            ok: false,
            status: 500,
            json: async () => {
                throw new Error('not json');
            },
        });
        await expect(adminFetch('/orders')).rejects.toThrow('Something went wrong. Please try again.');
    });
});

describe('statusLabel', () => {
    it('gives every customer-facing status a readable label', () => {
        // SPEC §9: a status must never be communicated by colour alone.
        expect(statusLabel('ready')).toBe('Ready for pickup/delivery');
        expect(statusLabel('pending')).toBe('Pending');
    });

    it('passes an unknown status through unchanged', () => {
        expect(statusLabel('mystery')).toBe('mystery');
    });
});

describe('AdminApiError', () => {
    it('carries the status code', () => {
        expect(new AdminApiError('nope', 403).status).toBe(403);
    });
});

describe('quoteTotalKobo', () => {
    it('computes the preview total in integer kobo', () => {
        // 500 naira/kg x 40kg + 2500 delivery = 22500 naira = 2_250_000 kobo
        expect(
            quoteTotalKobo({ unit_price_kobo: 50_000, quantity_kg: 40, delivery_fee_kobo: 250_000, discount_kobo: 0 }),
        ).toBe(2_250_000);
    });

    it('subtracts a discount', () => {
        expect(
            quoteTotalKobo({ unit_price_kobo: 33_333, quantity_kg: 7, delivery_fee_kobo: 0, discount_kobo: 1_166 }),
        ).toBe(33_333 * 7 - 1_166);
    });
});

describe('mutations send the CSRF token and the current version', () => {
    it('transitionOrder posts to_status with the version that was read', async () => {
        const stub = stubFetch({ json: async () => ({ id: 'o1' }) });
        await transitionOrder('o1', 'quoted', 4, 'csrf-abc');
        const [path, init] = stub.mock.calls[0] as [string, RequestInit & { headers: Record<string, string> }];
        expect(path).toBe('/api/v1/admin/orders/o1/transition');
        expect(init.method).toBe('POST');
        expect(init.headers['X-CSRF-Token']).toBe('csrf-abc');
        expect(JSON.parse(init.body as string)).toEqual({ to_status: 'quoted', version: 4 });
    });

    it('createQuote posts the quote draft as kobo', async () => {
        const stub = stubFetch({ json: async () => ({ quote: {} }) });
        await createQuote(
            'o1',
            {
                unit_price_kobo: 50_000,
                quantity_kg: 40,
                delivery_fee_kobo: 250_000,
                discount_kobo: 0,
                deposit_kobo: 500_000,
                valid_until: '2099-01-01',
            },
            'csrf-abc',
        );
        const init = stub.mock.calls[0][1] as RequestInit & { headers: Record<string, string> };
        expect(init.headers['X-CSRF-Token']).toBe('csrf-abc');
        expect(JSON.parse(init.body as string).deposit_kobo).toBe(500_000);
    });

    it('recordPayment sends the amount in kobo', async () => {
        const stub = stubFetch({ json: async () => ({ payment: {} }) });
        await recordPayment('o1', { amount_kobo: 1_000_000, method: 'transfer' }, 'csrf-abc');
        const init = stub.mock.calls[0][1] as RequestInit;
        expect(JSON.parse(init.body as string)).toEqual({ amount_kobo: 1_000_000, method: 'transfer' });
    });

    it('a stale version surfaces the API conflict message', async () => {
        stubFetch({ ok: false, status: 409, json: async () => ({ detail: 'This order was updated by someone else. Reload it and try again.' }) });
        await expect(transitionOrder('o1', 'confirmed', 1, 'csrf-abc')).rejects.toThrow(/updated by someone else/);
    });
});
