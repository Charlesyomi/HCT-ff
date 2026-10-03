import { afterEach, describe, expect, it, vi } from 'vitest';
import { AdminApiError, adminFetch, statusLabel } from './admin-api';

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
