// @vitest-environment jsdom

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import '@testing-library/jest-dom/vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import type { Catalog } from '@/lib/catalog-api';
import { useOrderDraftStore } from '@/lib/order-draft-store';
import { OrderFlow, SentPanel } from './order-flow';

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
        { slug: '2-3kg', label: '2 – 3kg', descriptor: 'Table size', min_kg: 2, max_kg: 3, image_path: '/images/size.svg', is_featured: true, is_smoking_size: false, sort_order: 1, status: 'main_stock', indicative_price_per_kg_kobo: 12_500, price_updated_at: '2026-10-04T09:30:00+00:00' },
    ],
    harvest_window: { starts_on: '2026-10-03', ends_on: '2026-10-12', notes: null },
    settings: {
        whatsapp_number: '+2348012345678',
        phone_number: '+2348012345678',
        farm_address: 'Ajebamidele, along Ikere Road, Ado-Ekiti, Ekiti State, Nigeria',
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
    return render(<OrderFlow catalog={catalog} initialSize={null} initialFishType={null} initialIntent={null} mode="review" />);
}

async function continueWithPhone() {
    fireEvent.click(screen.getByRole('button', { name: 'Continue with phone number' }));
    await waitFor(() => expect(screen.getByRole('heading', { name: 'Your details' })).toBeInTheDocument());
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

        expect(screen.queryByRole('heading', { name: 'Your details' })).not.toBeInTheDocument();
        await continueWithPhone();
        await waitFor(() => expect(screen.getByRole('heading', { name: 'Your details' })).toBeInTheDocument());
        expect(screen.getByLabelText('Full name')).toHaveFocus();
        expect(screen.queryByRole('button', { name: 'Continue with phone number' })).not.toBeInTheDocument();
        expect(screen.getByText(/haven.t been charged/i)).toBeInTheDocument();
        expect(screen.getByText('Estimated total: ₦25,000')).toBeInTheDocument();
        expect(screen.getByText('Price as of 4 Oct')).toBeInTheDocument();
        expect(screen.getAllByRole('heading', { name: 'Current Availability' })).toHaveLength(1);
        expect(screen.getByRole('list', { name: 'Order progress' }).children[1]).toHaveAttribute('aria-current', 'step');
        expect(replace).not.toHaveBeenCalled();
        expect(screen.queryByLabelText('Fish type')).not.toBeInTheDocument();
    });

    it('survives a refresh because the draft is persisted in sessionStorage', async () => {
        seedDraft();
        const first = renderCheckout();
        await continueWithPhone();
        await waitFor(() => expect(screen.getByRole('heading', { name: 'Your details' })).toBeInTheDocument());
        first.unmount();

        renderCheckout();
        await continueWithPhone();
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
                json: async () => ({ reference: 'AF-2026-0007', access_token: 'order-access-token', status: 'pending', indicative_unit_price_kobo: null, indicative_total_kobo: null }),
            } as Response);
        });
        renderCheckout();
        await continueWithPhone();
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
        expect(localStorage.getItem('adesoba-tracked-orders:AF-2026-0007')).toBe('order-access-token');
    });

    it('maps 422 API field errors back onto the checkout form', async () => {
        seedDraft();
        vi.mocked(fetch).mockImplementation((input: RequestInfo | URL) => Promise.resolve(
            String(input).includes('/api/v1/auth/me')
                ? { ok: false, json: async () => ({}) } as Response
                : { ok: false, status: 422, json: async () => ({ error: { message: 'Please correct the highlighted details.', fields: { phone: ['Enter a valid phone number.'] } } }) } as Response,
        ));
        renderCheckout();
        await continueWithPhone();
        fireEvent.change(screen.getByLabelText('Full name'), { target: { value: 'Ada Okafor' } });
        fireEvent.change(screen.getByLabelText('WhatsApp / phone number'), { target: { value: '08012345678' } });
        fireEvent.click(screen.getByRole('button', { name: 'Submit Order Request' }));

        expect(await screen.findByText('Enter a valid phone number.')).toBeInTheDocument();
        expect(screen.getByText('Please correct the highlighted details.')).toBeInTheDocument();
    });

    it('shows a clear 429 message and WhatsApp fallback', async () => {
        seedDraft();
        vi.mocked(fetch).mockImplementation((input: RequestInfo | URL) => Promise.resolve(
            String(input).includes('/api/v1/auth/me')
                ? { ok: false, json: async () => ({}) } as Response
                : { ok: false, status: 429, json: async () => ({ error: { message: 'Too many attempts.', fields: null } }) } as Response,
        ));
        renderCheckout();
        await continueWithPhone();
        fireEvent.change(screen.getByLabelText('Full name'), { target: { value: 'Ada Okafor' } });
        fireEvent.change(screen.getByLabelText('WhatsApp / phone number'), { target: { value: '08012345678' } });
        fireEvent.click(screen.getByRole('button', { name: 'Submit Order Request' }));

        expect(await screen.findByText(/Too many attempts\. Please wait a moment/)).toBeInTheDocument();
        expect(screen.getByRole('link', { name: 'Contact us on WhatsApp instead' })).toHaveAttribute('href', expect.stringContaining('https://wa.me/'));
    });

    it('offers retry and WhatsApp for 5xx API failures', async () => {
        seedDraft();
        vi.mocked(fetch).mockImplementation((input: RequestInfo | URL) => Promise.resolve(
            String(input).includes('/api/v1/auth/me')
                ? { ok: false, json: async () => ({}) } as Response
                : { ok: false, status: 503, json: async () => ({ error: { message: 'Unavailable.', fields: null } }) } as Response,
        ));
        renderCheckout();
        await continueWithPhone();
        fireEvent.change(screen.getByLabelText('Full name'), { target: { value: 'Ada Okafor' } });
        fireEvent.change(screen.getByLabelText('WhatsApp / phone number'), { target: { value: '08012345678' } });
        fireEvent.click(screen.getByRole('button', { name: 'Submit Order Request' }));

        expect(await screen.findByText(/server is temporarily unavailable/)).toBeInTheDocument();
        expect(screen.getByRole('link', { name: 'Contact us on WhatsApp instead' })).toBeInTheDocument();
    });

    it('shows the server-saved estimate on the sent page', async () => {
        localStorage.setItem('adesoba-tracked-orders', JSON.stringify(['AF-2026-0007']));
        localStorage.setItem('adesoba-tracked-orders:AF-2026-0007', 'order-access-token');
        vi.mocked(fetch).mockResolvedValue({
            ok: true,
            json: async () => ({
                reference: 'AF-2026-0007',
                status: 'pending',
                fish_type: 'clarias',
                size_label: '2 – 3kg',
                quantity_kg: 200,
                indicative_unit_price_kobo: 12_500,
                indicative_total_kobo: 2_500_000,
                is_bulk: false,
                preferred_date: '2026-10-06',
                time_slot_label: '10 AM–12 PM',
                fulfilment: 'pickup',
                delivery_address: null,
                delivery_landmark: null,
                notes: null,
                customer_name: 'Ada Okafor',
                customer_phone_masked: '+234801***5678',
                customer_email: null,
                submitted_at: '2026-10-04T09:30:00+00:00',
                events: [],
                quote: null,
            }),
        } as Response);

        render(<SentPanel catalog={catalog} reference="AF-2026-0007" />);

        expect(await screen.findByText('Estimated total: ₦25,000')).toBeInTheDocument();
        expect(screen.getByText(/Estimate only\. Excludes delivery/)).toBeInTheDocument();
        expect(screen.getByRole('list', { name: 'Order progress' }).children[2]).toHaveAttribute('aria-current', 'step');
    });
});
