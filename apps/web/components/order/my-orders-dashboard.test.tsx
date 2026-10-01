// @vitest-environment jsdom

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import '@testing-library/jest-dom/vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MyOrdersDashboard } from './my-orders-dashboard';
import { rememberTrackedOrder } from '@/lib/order-tracking';

vi.mock('next/link', async () => {
    const react = await import('react');
    return {
        default: ({ href, children }: { href: string; children: React.ReactNode }) =>
            react.createElement('a', { href }, children),
    };
});

const pendingOrder = {
    reference: 'AF-2026-0001',
    status: 'pending',
    fish_type: 'clarias',
    size_label: '2 – 3kg',
    quantity_kg: 200,
    is_bulk: false,
    preferred_date: '2026-10-06',
    time_slot_label: '10 AM–12 PM',
    fulfilment: 'pickup',
    delivery_address: null,
    delivery_landmark: null,
    notes: null,
    customer_name: 'Ada Okafor',
    customer_phone_masked: '+234801***5678',
    customer_email: 'ada@example.com',
    submitted_at: '2026-10-01T10:00:00+00:00',
    events: [
        { type: 'created', from_status: null, to_status: 'pending', note: null, created_at: '2026-10-01T10:00:00+00:00' },
    ],
};

const completedOrder = { ...pendingOrder, reference: 'AF-2026-0002', status: 'completed' };

function json(body: unknown, ok = true): Response {
    return { ok, status: ok ? 200 : 404, json: async () => body } as Response;
}

beforeEach(() => {
    vi.stubGlobal('fetch', vi.fn());
    window.localStorage.clear();
});

afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
});

describe('MyOrdersDashboard (SPEC §5.4)', () => {
    it('looks an order up with reference and phone and shows the detail view', async () => {
        vi.mocked(fetch).mockImplementation((input: RequestInfo | URL) => {
            if (String(input).includes('/orders/lookup')) {
                return Promise.resolve(json({ order: pendingOrder, access_token: 'token-1' }));
            }
            return Promise.resolve(json({}, false));
        });
        render(<MyOrdersDashboard />);
        await waitFor(() => expect(screen.getByLabelText('Order reference')).toBeInTheDocument());

        fireEvent.change(screen.getByLabelText('Order reference'), { target: { value: 'AF-2026-0001' } });
        fireEvent.change(screen.getByLabelText('Phone number'), { target: { value: '08012345678' } });
        fireEvent.click(screen.getByRole('button', { name: 'Find order' }));

        expect(await screen.findByRole('heading', { name: 'Order AF-2026-0001' })).toBeInTheDocument();
        expect(screen.getByText('+234801***5678')).toBeInTheDocument();
        expect(window.localStorage.getItem('adesoba-tracked-orders:AF-2026-0001')).toBe('token-1');
    });

    it('separates active from completed orders for orders this device remembers', async () => {
        rememberTrackedOrder(pendingOrder.reference, 'token-1');
        rememberTrackedOrder(completedOrder.reference, 'token-2');
        vi.mocked(fetch).mockImplementation((input: RequestInfo | URL) => {
            if (String(input).includes(pendingOrder.reference)) return Promise.resolve(json(pendingOrder));
            if (String(input).includes(completedOrder.reference)) return Promise.resolve(json(completedOrder));
            return Promise.resolve(json({}, false));
        });
        render(<MyOrdersDashboard />);

        expect(await screen.findByText('AF-2026-0001')).toBeInTheDocument();
        expect(screen.queryByText('AF-2026-0002')).not.toBeInTheDocument();

        fireEvent.click(screen.getByRole('button', { name: 'Completed' }));

        expect(await screen.findByText('AF-2026-0002')).toBeInTheDocument();
        expect(screen.queryByText('AF-2026-0001')).not.toBeInTheDocument();
    });

    it('shows an empty state when nothing is tracked yet', async () => {
        vi.mocked(fetch).mockResolvedValue(json({}, false));
        render(<MyOrdersDashboard />);

        expect(await screen.findByText(/No active orders yet/)).toBeInTheDocument();
    });

    it('surfaces the API message when the lookup fails', async () => {
        vi.mocked(fetch).mockResolvedValue(json({ error: { message: 'Order not found or details do not match.' } }, false));
        render(<MyOrdersDashboard />);
        await waitFor(() => expect(screen.getByLabelText('Order reference')).toBeInTheDocument());

        fireEvent.change(screen.getByLabelText('Order reference'), { target: { value: 'AF-1999-0001' } });
        fireEvent.change(screen.getByLabelText('Phone number'), { target: { value: '08012345678' } });
        fireEvent.click(screen.getByRole('button', { name: 'Find order' }));

        expect(await screen.findByText('Order not found or details do not match.')).toBeInTheDocument();
    });
});
