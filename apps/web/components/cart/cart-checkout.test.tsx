// @vitest-environment jsdom

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import '@testing-library/jest-dom/vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import type { Catalog } from '@/lib/catalog-api';
import { useCartStore } from '@/lib/cart-store';
import type { CartLine } from '@/lib/cart-api';
import { useOrderDraftStore } from '@/lib/order-draft-store';
import { defaultPreferredDate } from '@/lib/order-form';
import { CartCheckout } from './cart-checkout';

/** Fake the farm's order response so the submit path can be exercised end to end. */
function mockOrderFetch(order: { reference: string; access_token: string }) {
    vi.mocked(fetch).mockImplementation(async (input) => {
        const url = String(input);
        if (url.includes('/api/v1/auth/me')) {
            return { ok: false, json: async () => null } as Response;
        }
        if (url.includes('/api/v1/orders')) {
            return {
                ok: true,
                json: async () => ({
                    reference: order.reference,
                    access_token: order.access_token,
                    status: 'pending',
                    submitted_at: '2026-10-04T10:00:00+00:00',
                    indicative_unit_price_kobo: null,
                    indicative_total_kobo: null,
                    items: [],
                }),
            } as Response;
        }
        return { ok: false, json: async () => null } as Response;
    });
}

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
        farm_address: 'Ajebamidele, Ekiti State, Nigeria',
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

function cartLine(overrides: Partial<CartLine> = {}): CartLine {
    return {
        fish_type: 'any',
        size: '2-3kg',
        size_label: '2 – 3kg',
        quantity_kg: 120,
        indicative_unit_price_kobo: 12_500,
        line_total_kobo: 1_500_000,
        ...overrides,
    };
}

function renderCheckout() {
    return render(<CartCheckout catalog={catalog} />);
}

beforeEach(() => {
    push.mockReset();
    replace.mockReset();
    vi.stubGlobal('fetch', vi.fn());
    // No order-form draft: this is the "arrived from /cart" case.
    useOrderDraftStore.persist.clearStorage();
    useOrderDraftStore.setState({ hasHydrated: false, reviewOpen: false, idempotencyKey: null, draft: {} });
    sessionStorage.clear();
    useCartStore.setState({
        lines: [],
        version: 0,
        indicativeTotalKobo: null,
        signedIn: false,
        hydrated: true,
        status: 'synced',
        error: null,
        pendingRetry: null,
    });
});

afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
});

describe('CartCheckout', () => {
    it('renders the review from a non-empty cart without a draft and never redirects', async () => {
        useCartStore.setState({ lines: [cartLine()], hydrated: true });

        renderCheckout();

        // The cart is the source of truth, so no order draft is required.
        expect(screen.getByRole('heading', { name: 'Your request (1 item)' })).toBeInTheDocument();
        fireEvent.click(screen.getByRole('button', { name: 'Continue with phone number' }));
        await waitFor(() => {
            expect(screen.getByRole('heading', { name: 'Your details' })).toBeInTheDocument();
        });
        expect(replace).not.toHaveBeenCalled();
        expect(push).not.toHaveBeenCalled();
    });

    /** Walk past the sign-in step so the full one-form checkout is visible. */
    async function openReviewForm() {
        fireEvent.click(screen.getByRole('button', { name: 'Continue with phone number' }));
        await waitFor(() => expect(screen.getByRole('heading', { name: 'Your details' })).toBeInTheDocument());
    }

    function fillContactDetails() {
        fireEvent.change(screen.getByLabelText('Full name'), { target: { value: 'Ada Okafor' } });
        fireEvent.change(screen.getByLabelText('WhatsApp / phone number'), { target: { value: '08012345678' } });
    }

    function fillOrderFields() {
        fireEvent.change(screen.getByLabelText('Preferred date'), { target: { value: defaultPreferredDate(1) } });
        fireEvent.change(screen.getByLabelText('Preferred time slot'), { target: { value: '10-12' } });
        fireEvent.click(screen.getByRole('radio', { name: /Pickup/ }));
        fireEvent.change(screen.getByLabelText(/Notes/), { target: { value: 'Please call first.' } });
    }

    function acceptConsent() {
        fireEvent.click(screen.getByRole('checkbox', { name: /I agree the farm may contact me/ }));
    }

    function ordersRequestBody() {
        const call = vi.mocked(fetch).mock.calls.find(([input]) => String(input).includes('/api/v1/orders'));
        return call ? JSON.parse(String((call[1] as RequestInit).body)) : null;
    }

    it('sends one items[] request with every order-level field when a cart visitor fills the form', async () => {
        useCartStore.setState({
            lines: [
                cartLine(),
                cartLine({ fish_type: 'clarias', size: '2-3kg', quantity_kg: 80 }),
            ],
            hydrated: true,
        });
        mockOrderFetch({ reference: 'AF-2026-0042', access_token: 'tok-42' });

        renderCheckout();
        await openReviewForm();
        fillContactDetails();
        fillOrderFields();
        acceptConsent();
        fireEvent.click(screen.getByRole('button', { name: 'Submit Order Request' }));

        await waitFor(() => expect(ordersRequestBody()).not.toBeNull());
        const body = ordersRequestBody();
        expect(body.items).toHaveLength(2);
        expect(body.items[0]).toMatchObject({ fish_type: 'any', size: '2-3kg', quantity_kg: 120 });
        expect(body.items[1]).toMatchObject({ fish_type: 'clarias', size: '2-3kg', quantity_kg: 80 });
        expect(body.time_slot).toBe('10-12');
        expect(body.fulfilment).toBe('pickup');
        expect(body.customer_name).toBe('Ada Okafor');
        expect(body.notes).toBe('Please call first.');
        expect(push).toHaveBeenCalledWith('/order/sent/AF-2026-0042');
    });

    it('shows the wizard item plus the items already in the cart', async () => {
        useCartStore.setState({
            lines: [
                cartLine({ fish_type: 'clarias', size: '2-3kg', size_label: '2 – 3kg', quantity_kg: 200 }),
                cartLine({ fish_type: 'any', size: '1-5-2kg', size_label: '1.5 – 2kg', quantity_kg: 60 }),
            ],
            hydrated: true,
        });

        renderCheckout();

        expect(screen.getByRole('heading', { name: 'Your request (2 items)' })).toBeInTheDocument();
        // Both the wizard item and the pre-existing cart line are listed, editable.
        expect(screen.getByLabelText('2 – 3kg kilograms')).toHaveValue(200);
        expect(screen.getByLabelText('1.5 – 2kg kilograms')).toHaveValue(60);
    });

    it('marks and names a missing field and focuses it instead of showing an inert banner', async () => {
        useCartStore.setState({ lines: [cartLine()], hydrated: true });
        mockOrderFetch({ reference: 'AF-2026-0007', access_token: 'tok' });

        renderCheckout();
        await openReviewForm();
        fillContactDetails();
        acceptConsent();
        fireEvent.click(screen.getByRole('button', { name: 'Submit Order Request' }));

        // The time slot was never chosen: it is highlighted, named and focused.
        await waitFor(() => expect(screen.getByText(/Preferred time slot/)).toBeInTheDocument());
        const slot = screen.getByLabelText('Preferred time slot');
        expect(slot).toHaveAttribute('aria-invalid', 'true');
        await waitFor(() => expect(document.activeElement).toBe(slot));
        // No request is sent while the form is invalid.
        expect(ordersRequestBody()).toBeNull();
        // The old generic banner is gone.
        expect(screen.queryByText(/Complete the highlighted details/)).not.toBeInTheDocument();
    });

    it('never shows the missing-fields banner without a highlighted field', async () => {
        useCartStore.setState({ lines: [cartLine()], hydrated: true });
        mockOrderFetch({ reference: 'AF-2026-0008', access_token: 'tok' });

        renderCheckout();
        await openReviewForm();
        acceptConsent();
        fireEvent.click(screen.getByRole('button', { name: 'Submit Order Request' }));

        const banner = await screen.findByText(/Please complete these before sending/);
        const bannerText = banner.parentElement?.textContent ?? '';
        // Every named field is one that has a visible, invalid input.
        for (const label of ['Full name', 'Phone number', 'Preferred time slot']) {
            expect(bannerText).toContain(label);
        }
        expect(screen.getByLabelText('Full name')).toHaveAttribute('aria-invalid', 'true');
        expect(screen.getByLabelText('Preferred time slot')).toHaveAttribute('aria-invalid', 'true');
    });

    it('redirects to /cart exactly once when the cart and the draft are both empty', async () => {
        renderCheckout();

        await waitFor(() => expect(replace).toHaveBeenCalledWith('/cart'));
        expect(replace).toHaveBeenCalledTimes(1);
        // It must never bounce through /order, which redirects back here.
        expect(replace).not.toHaveBeenCalledWith('/order');
        expect(push).not.toHaveBeenCalled();
    });
});