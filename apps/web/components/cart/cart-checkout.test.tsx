// @vitest-environment jsdom

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import '@testing-library/jest-dom/vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import type { Catalog } from '@/lib/catalog-api';
import { useCartStore } from '@/lib/cart-store';
import type { CartLine } from '@/lib/cart-api';
import { useOrderDraftStore } from '@/lib/order-draft-store';
import { CartCheckout } from './cart-checkout';

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

        // The cart summary is the review source, so no order draft is required.
        expect(screen.getByRole('heading', { name: /Your cart \(120kg\)/ })).toBeInTheDocument();
        // The details form collects the customer's own details, as on the single-line flow.
        fireEvent.click(screen.getByRole('button', { name: 'Continue with phone number' }));
        await waitFor(() => {
            expect(screen.getByRole('heading', { name: 'Your details' })).toBeInTheDocument();
        });
        expect(replace).not.toHaveBeenCalled();
        expect(push).not.toHaveBeenCalled();
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