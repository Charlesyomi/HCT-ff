// @vitest-environment jsdom

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import '@testing-library/jest-dom/vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { createElement } from 'react';
import type { Catalog } from '@/lib/catalog-api';
import { useOrderDraftStore } from '@/lib/order-draft-store';
import { OrderFlow } from './order-flow';

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

// The app router is not mounted in jsdom; the stub keeps navigation a no-op for these tests.
vi.mock('next/navigation', async () => {
    const react = await import('react');
    return {
        useRouter: () => ({
            push: vi.fn(),
            replace: vi.fn(),
            back: vi.fn(),
            refresh: vi.fn(),
            prefetch: vi.fn(),
        }),
        usePathname: () => '/order',
        useSearchParams: () => new URLSearchParams(''),
        useParams: () => ({}),
        redirect: (href: string) => react.createElement('div', { 'data-redirect': href }),
    };
});

const testCatalog = {
    fish_types: [
        { slug: 'clarias', name: 'Clarias', description: 'Common fish.', image_path: '/images/fish.svg', sort_order: 1 },
        { slug: 'hybrid', name: 'Hybrid', description: 'Bulk fish.', image_path: '/images/fish.svg', sort_order: 2 },
    ],
    size_classes: [
        { slug: '1-1-5kg', label: '1 – 1.5kg', descriptor: 'Smoking / BBQ size', min_kg: 1, max_kg: 1.5, image_path: '/images/size.svg', is_featured: false, is_smoking_size: true, sort_order: 1, status: 'limited' },
        { slug: '1-5-2kg', label: '1.5 – 2kg', descriptor: 'Medium size', min_kg: 1.5, max_kg: 2, image_path: '/images/size.svg', is_featured: false, is_smoking_size: false, sort_order: 2, status: 'available' },
        { slug: '2-3kg', label: '2 – 3kg', descriptor: 'Table / wholesale size', min_kg: 2, max_kg: 3, image_path: '/images/size.svg', is_featured: true, is_smoking_size: false, sort_order: 3, status: 'main_stock' },
        { slug: '3kg-plus', label: '3kg+', descriptor: 'Large size', min_kg: 3, max_kg: null, image_path: '/images/size.svg', is_featured: false, is_smoking_size: false, sort_order: 4, status: 'sold_out' },
    ],
    harvest_window: { starts_on: '2026-10-03', ends_on: '2026-10-12', notes: null },
    settings: {
        whatsapp_number: '+2348012345678',
        phone_number: '+2348012345678',
        farm_address: 'Adesoba Catfish Farm, Ogun State, Nigeria',
        farm_maps_url: null,
        business_hours: ['Mon-Sat, 8:00 AM-6:00 PM'],
        min_order_kg: 40,
        max_order_kg: 20_000,
        min_lead_days: 1,
        time_slots: [
            { key: '8-10', label: '8–10 AM' },
            { key: '10-12', label: '10 AM–12 PM' },
            { key: '12-2', label: '12–2 PM' },
            { key: '2-4', label: '2–4 PM' },
            { key: '4-6', label: '4–6 PM' },
        ],
        delivery_notice: 'Delivery fee quoted by the farm.',
        announcement_banner: null,
    },
} satisfies Catalog;

function renderFlow(intent: string | null = null) {
    return render(<OrderFlow catalog={testCatalog} initialIntent={intent} initialSize={null} />);
}

async function advanceToQuestion(questionNumber: number) {
    fireEvent.click(screen.getByRole('button', { name: 'Next' }));
    await waitFor(() => expect(screen.getByLabelText(`Question ${questionNumber} of 6`)).toBeInTheDocument());
}

beforeEach(() => {
    vi.stubGlobal('fetch', vi.fn());
    useOrderDraftStore.persist.clearStorage();
    useOrderDraftStore.setState({
        draft: {},
        sourceIntent: null,
        quantityPresetKg: null,
        tonnePlusCustom: false,
        mobileStep: 0,
        reviewOpen: false,
        idempotencyKey: null,
        hasHydrated: false,
    });
});

afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
});

describe('OrderFlow', () => {
    it('applies the bulk quantity preset and keeps chip and custom input in sync', async () => {
        renderFlow('bulk');
        await waitFor(() => expect(screen.getByRole('button', { name: '500kg' })).toHaveAttribute('aria-pressed', 'true'));

        fireEvent.click(screen.getByRole('radio', { name: /Hybrid Fast growing/ }));
        await advanceToQuestion(2);
        fireEvent.click(screen.getByRole('radio', { name: /2 – 3kg Main stock/ }));
        await advanceToQuestion(3);

        const customAmount = screen.getByLabelText('Custom amount (kg)');
        expect(customAmount).toHaveValue(null);
        expect(screen.getByText('For 1 tonne+ choose 1 tonne+.')).toBeVisible();

        fireEvent.click(screen.getByRole('button', { name: '100kg' }));
        expect(customAmount).toHaveValue(null);
        fireEvent.change(customAmount, { target: { value: '640' } });
        expect(customAmount).toHaveValue(640);
        expect(screen.getByRole('button', { name: '100kg' })).toHaveAttribute('aria-pressed', 'false');

        fireEvent.click(screen.getByRole('button', { name: '1 tonne+' }));
        expect(customAmount).toHaveValue(1000);
        expect(customAmount).toHaveAttribute('min', '1000');
        fireEvent.change(customAmount, { target: { value: '900' } });
        expect(screen.getByRole('button', { name: '1 tonne+' })).toHaveAttribute('aria-pressed', 'false');
        fireEvent.click(screen.getByRole('button', { name: 'Next' }));
        await waitFor(() => expect(screen.getByText('For 1 tonne+, enter at least 1000kg.')).toBeInTheDocument());
        expect(screen.getByLabelText('Custom amount (kg)')).toHaveFocus();
    });

    it('blocks delivery without an address and focuses the invalid field', async () => {
        renderFlow();
        await waitFor(() => expect(screen.getByRole('radio', { name: /Clarias/ })).toBeInTheDocument());

        fireEvent.click(screen.getByRole('radio', { name: /Clarias/ }));
        await advanceToQuestion(2);
        fireEvent.click(screen.getByRole('radio', { name: /1.5 – 2kg Available/ }));
        await advanceToQuestion(3);
        fireEvent.click(screen.getByRole('button', { name: '40kg' }));
        await advanceToQuestion(4);
        fireEvent.change(screen.getByLabelText('Preferred time slot'), { target: { value: '8-10' } });
        await advanceToQuestion(5);
        fireEvent.click(screen.getByRole('radio', { name: /Delivery/ }));
        fireEvent.click(screen.getByRole('button', { name: 'Next' }));

        await waitFor(() => expect(screen.getByText('Enter a delivery address or area of at least 8 characters.')).toBeInTheDocument());
        expect(screen.getByRole('heading', { name: 'Pickup or delivery?' })).toBeVisible();
        expect(screen.getByLabelText('Delivery address / area')).toHaveFocus();
    });

    it('restores the draft and active mobile question after remount', async () => {
        const firstRender = renderFlow();
        await waitFor(() => expect(screen.getByRole('radio', { name: /Hybrid Fast growing/ })).toBeInTheDocument());
        fireEvent.click(screen.getByRole('radio', { name: /Hybrid Fast growing/ }));
        await advanceToQuestion(2);
        firstRender.unmount();

        renderFlow();
        await waitFor(() => expect(screen.getByLabelText('Question 2 of 6')).toBeInTheDocument());
        expect(screen.getByRole('radio', { name: /Hybrid Fast growing/ })).toBeChecked();
    });

    it('restores Review and its idempotency key after remount', async () => {
        const firstRender = renderFlow();
        await waitFor(() => expect(screen.getByRole('radio', { name: /Clarias/ })).toBeInTheDocument());
        fireEvent.click(screen.getByRole('radio', { name: /Clarias/ }));
        await advanceToQuestion(2);
        fireEvent.click(screen.getByRole('radio', { name: /1.5 – 2kg Available/ }));
        await advanceToQuestion(3);
        fireEvent.click(screen.getByRole('button', { name: '40kg' }));
        await advanceToQuestion(4);
        fireEvent.change(screen.getByLabelText('Preferred time slot'), { target: { value: '8-10' } });
        await advanceToQuestion(5);
        await advanceToQuestion(6);
        fireEvent.click(screen.getByRole('button', { name: 'Review & Confirm' }));
        await waitFor(() => expect(screen.getByRole('heading', { name: 'Your details' })).toBeInTheDocument());

        const savedState = JSON.parse(sessionStorage.getItem('adesoba-order-draft') ?? '{}') as {
            state?: { idempotencyKey?: string; reviewOpen?: boolean };
        };
        const savedKey = savedState.state?.idempotencyKey;
        expect(savedState.state?.reviewOpen).toBe(true);
        expect(savedKey).toMatch(/^[0-9a-f-]{36}$/i);
        firstRender.unmount();

        renderFlow();
        await waitFor(() => expect(screen.getByRole('heading', { name: 'Your details' })).toBeInTheDocument());
        const restoredState = JSON.parse(sessionStorage.getItem('adesoba-order-draft') ?? '{}') as {
            state?: { idempotencyKey?: string; reviewOpen?: boolean };
        };
        expect(restoredState.state?.idempotencyKey).toBe(savedKey);
        expect(restoredState.state?.reviewOpen).toBe(true);
    });

    it('requires customer details on Review before attempting submission', async () => {
        renderFlow();
        await waitFor(() => expect(screen.getByRole('radio', { name: /Clarias/ })).toBeInTheDocument());

        fireEvent.click(screen.getByRole('radio', { name: /Clarias/ }));
        await advanceToQuestion(2);
        fireEvent.click(screen.getByRole('radio', { name: /1.5 – 2kg Available/ }));
        await advanceToQuestion(3);
        fireEvent.click(screen.getByRole('button', { name: '40kg' }));
        await advanceToQuestion(4);
        fireEvent.change(screen.getByLabelText('Preferred time slot'), { target: { value: '8-10' } });
        await advanceToQuestion(5);
        await advanceToQuestion(6);
        fireEvent.click(screen.getByRole('button', { name: 'Review & Confirm' }));
        await waitFor(() => expect(screen.getByRole('heading', { name: 'Your details' })).toBeInTheDocument());
        fireEvent.click(screen.getByRole('button', { name: 'Submit Order Request' }));

        await waitFor(() => expect(screen.getByLabelText('Full name')).toHaveFocus());
        expect(screen.getByText('Too small: expected string to have >=2 characters')).toBeInTheDocument();
    });
});
