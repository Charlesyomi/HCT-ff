// @vitest-environment jsdom

import { afterEach, describe, expect, it, vi } from 'vitest';
import '@testing-library/jest-dom/vitest';
import { cleanup, render, screen } from '@testing-library/react';
import type { SizeClass } from '@/lib/catalog-api';
import { SizeCard } from './size-card';

afterEach(cleanup);

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

const size = (overrides: Partial<SizeClass> = {}): SizeClass => ({
    slug: '2-3kg',
    label: '2 – 3kg',
    descriptor: 'Table / wholesale size',
    min_kg: 2,
    max_kg: 3,
    image_path: '/images/size.svg',
    is_featured: false,
    is_smoking_size: false,
    sort_order: 1,
    status: 'available',
    indicative_price_per_kg_kobo: null,
    price_updated_at: null,
    ...overrides,
});

describe('SizeCard', () => {
    it('shows indicative rates per kilogram', () => {
        render(<SizeCard size={size({ indicative_price_per_kg_kobo: 12_500 })} whatsappNumber="+2349019871421" />);

        expect(screen.getByText('₦125/kg')).toBeInTheDocument();
        expect(screen.getByRole('link', { name: 'Request' })).toHaveAttribute('href', '/order?size=2-3kg');
    });

    it('shows price on request and links sold-out sizes to WhatsApp', () => {
        render(<SizeCard size={size({ status: 'sold_out' })} whatsappNumber="+2349019871421" />);

        expect(screen.getByText('Price on request')).toBeInTheDocument();
        expect(screen.getByRole('link', { name: 'Ask us' })).toHaveAttribute('href', expect.stringContaining('https://wa.me/2349019871421'));
        expect(screen.queryByRole('link', { name: 'Request' })).not.toBeInTheDocument();
    });
});
