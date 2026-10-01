// @vitest-environment jsdom

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import '@testing-library/jest-dom/vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import type { Catalog } from '@/lib/catalog-api';
import { useOrderDraftStore } from '@/lib/order-draft-store';
import { OrderFlow } from './order-flow';

const push = vi.fn();
const replace = vi.fn();

vi.mock('next/link', async () => {
    const react = await import('react');
    return {
        default: ({ href, children, ...props }: { href: string; children: React.ReactNode } & React.AnchorHTMLAttributes<HTMLAnchorElement>) =>
            react.createElement('a', { ...props, href }, children),
    };
});

vi.mock('next/image', async () => {
    const react = await import('react');
    return {
        default: ({ fill: _fill, priority: _priority, sizes: _sizes, ...props }: { fill?: boolean; priority?: boolean; sizes?: string } & React.ImgHTMLAttributes<HTMLImageElement>) =>
            react.createElement('img', props),
    };
});

vi.mock('next/navigation', () => ({
    useRouter: () => ({ push, replace, back: vi.fn(), refresh: vi.fn(), prefetch: vi.fn() }),
    usePathname: () => '/checkout',
    useSearchParams: () => new URLSearchParams(''),
    useParams: () => ({}),
}));

const catalog = {
    fish_types: [{ slug: 'clarias', name: 'Clarias', description: 'Common fish.', image_path: '/images/fish.svg', sort_order: 1 }],
    size_classes: [
        { slug: '2-3kg', label: '2 – 3kg', descriptor: 'Table size', min_kg: 2, max_kg: 3, image_path: '/images/size.svg', is_featured: true, is_smoking_size: false, sort_order: 1, status: 'main_stock' },
    ],
    harvest_window: { starts_on: '2026-10-03', ends_on: '2026-10-12', notes: null },
    settings: {
        whatsapp_number: '+2348012345678',
        phone_number: '+2348012345678',
        farm_address: '[EDIT ME] Farm address',
        farm_maps_url: null,
        business_hours: ['Mon-Sat, 8:00 AM-6:00 PM'],
        min_order_kg: 40,
        max_order_kg: 20_000,
        min_lead_days: 1,
        time_slots: [
            { key: '8-10', label: '8–10 AM' },
            { key: '10-12', label: '10 AM–12 PM' },
        ],
        delivery_notice: 'Delivery fee quoted by the farm.',
        announcement_banner: null,
    },
} satisfies Catalog;

function seedDraft() {
    const tomorrow = new Date(Date.now() + 3 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
    sessionStorage.setItem(
        'adesoba-order-draft',
        JSON.stringify({
            state: {
                draft: {
                    fish_type: 'clarias',
                    size: '2-3kg',
                    quantity_kg: 200,
                    preferred_date: tomorrow,
                    time_slot: '10-12',
                    fulfilment: 'pickup',
                    notes: '',
                    email: '',
                    delivery_address: '',
                    delivery_landmark: '',
                },
                sourceIntent: null,
                quantityPresetKg: null,
                tonnePlusCustom: false,
                mobileStep: 6,
                reviewOpen: true,
                idempotencyKey: '11111111-2222-3333-4444-555555555555',
            },
            version: 0,
        }),
    );
}

function renderCheckout() {
    return render(<OrderFlow catalog={catalog} initialSize={null} initialIntent={null} mode="review" />);
}

beforeEach(() => {
    push.mockReset();
    replace.mockReset();
    vi.stubGlobal('fetch', vi.fn());
    useOrderDraftStore.persist.clearStorage();
    useOrderDraftStore.setState({ hasHydrated: false, reviewOpen: false, idempotencyKey: null, draft: {} });
    sessionStorage.clear();
});

afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
});

describe('/checkout (Addendum §A1)', () => {
    it('redirects to /order when there is no saved order state', async () => {
        renderCheckout();

        await waitFor(() => expect(replace).toHaveBeenCalledWith('/order'));
    });

    it('renders Review & Confirm from the persisted draft and keeps the no-charge banner', async () => {
        seedDraft();
        renderCheckout();

        await waitFor(() => expect(screen.getByRole('heading', { name: 'Your details' })).toBeInTheDocument());
        expect(screen.getByText(/haven.t been charged/i)).toBeInTheDocument();
        expect(replace).not.toHaveBeenCalled();
        expect(screen.queryByLabelText('Fish type')).not.toBeInTheDocument();
    });

    it('survives a refresh because the draft is persisted in sessionStorage', async () => {
        seedDraft();
        const first = renderCheckout();
        await waitFor(() => expect(screen.getByRole('heading', { name: 'Your details' })).toBeInTheDocument());
        first.unmount();

        renderCheckout();
        await waitFor(() => expect(screen.getByRole('heading', { name: 'Your details' })).toBeInTheDocument());
        expect(screen.getByText('Check your request')).toBeInTheDocument();
    });

    it('submits with the stored idempotency key and routes to the confirmation page', async () => {
        seedDraft();
        // The sign-in probe and the order submission share the fetch mock, so route by URL.
        vi.mocked(fetch).mockImplementation((input: RequestInfo | URL) => {
            const url = String(input);
            if (url.includes('/api/v1/auth/me')) {
                return Promise.resolve({ ok: false, json: async () => ({}) } as Response);
            }
            return Promise.resolve({
                ok: true,
                json: async () => ({ reference: 'AF-2026-0007', status: 'pending' }),
            } as Response);
        });
        renderCheckout();
        await waitFor(() => expect(screen.getByRole('heading', { name: 'Your details' })).toBeInTheDocument());

        fireEvent.change(screen.getByLabelText('Full name'), { target: { value: 'Ada Okafor' } });
        fireEvent.change(screen.getByLabelText('WhatsApp / phone number'), { target: { value: '08012345678' } });
        fireEvent.click(screen.getByRole('button', { name: 'Submit Order Request' }));

        await waitFor(() => expect(push).toHaveBeenCalledWith('/order/sent/AF-2026-0007'));
        const orderCall = vi
            .mocked(fetch)
            .mock.calls.find(([input]) => String(input).includes('/api/v1/orders')) as [string, RequestInit];
        expect(orderCall).toBeDefined();
        const [url, options] = orderCall;
        expect(url).toContain('/api/v1/orders');
        expect((options.headers as Record<string, string>)['Idempotency-Key']).toBe('11111111-2222-3333-4444-555555555555');
    });
});
