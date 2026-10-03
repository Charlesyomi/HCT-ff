// @vitest-environment jsdom

import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { QuoteSummary } from './quote-summary';
import type { OrderQuote } from '@/lib/order-tracking';

const baseQuote: OrderQuote = {
    version_no: 1,
    unit_price_kobo: 50_000,
    quantity_kg: 40,
    delivery_fee_kobo: 250_000,
    discount_kobo: 0,
    total_kobo: 2_250_000,
    deposit_kobo: 500_000,
    valid_until: '2099-01-01',
    message_to_customer: 'Negotiated rate for this batch.',
    status: 'sent',
    is_expired: false,
};

function renderQuote(overrides: Partial<OrderQuote> = {}, whatsappNumber = '+2349019871421') {
    return render(
        <QuoteSummary
            quote={{ ...baseQuote, ...overrides }}
            reference="AF-2099-0001"
            sizeLabel="2-3kg"
            quantityKg={40}
            fulfilment="pickup"
            whatsappNumber={whatsappNumber}
        />,
    );
}

// Without an explicit unmount the DOM leaks between cases and queries match stale nodes.
afterEach(() => cleanup());

describe('QuoteSummary (SPEC §5.4, ADR 18)', () => {
    it('shows the quoted total and rate', () => {
        renderQuote();
        expect(screen.getByText('₦22,500')).toBeTruthy();
        expect(screen.getByText('₦500/kg')).toBeTruthy();
        expect(screen.getByText('₦2,500')).toBeTruthy();
    });

    it('includes the delivery fee only when there is one', () => {
        renderQuote({ delivery_fee_kobo: 0 });
        expect(screen.queryByText('Delivery fee')).toBeNull();
    });

    it('shows the farm message when provided', () => {
        renderQuote();
        expect(screen.getByText('Negotiated rate for this batch.')).toBeTruthy();
    });

    it('offers no pay or accept action, because there is no online payment', () => {
        renderQuote();
        expect(screen.queryByText(/pay now/i)).toBeNull();
        expect(screen.getByText(/nothing has been charged/i)).toBeTruthy();
    });

    it('renders an expired quote greyed, with no deposit line', () => {
        renderQuote({ is_expired: true, status: 'expired', deposit_kobo: 500_000 });
        expect(screen.getByText('Expired quote')).toBeTruthy();
        expect(screen.getByText('Expired')).toBeTruthy();
        // The total is still shown so the customer can see what they were quoted.
        expect(screen.getByText('₦22,500')).toBeTruthy();
        expect(screen.queryByText('Deposit agreed')).toBeNull();
    });

    it('asks for a fresh quote over WhatsApp when expired', () => {
        renderQuote({ is_expired: true, status: 'expired' });
        const link = screen.getByRole('link', { name: /ask for a fresh quote/i });
        expect(link.getAttribute('href')).toContain('wa.me/2349019871421');
        expect(link.getAttribute('href')).toContain('AF-2099-0001');
    });

    it('omits the chat shortcut when no WhatsApp number is known', () => {
        renderQuote({}, '');
        expect(screen.queryByRole('link')).toBeNull();
        expect(screen.getByText('₦22,500')).toBeTruthy();
    });
});
