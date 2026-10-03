import { describe, expect, it } from 'vitest';
import { formatKobo, formatRateKobo, whatsappLink } from './money';

describe('formatKobo', () => {
    it('renders integer kobo as a Naira amount with separators', () => {
        expect(formatKobo(125_000_000)).toBe('₦1,250,000');
        expect(formatKobo(0)).toBe('₦0');
        expect(formatKobo(50_000)).toBe('₦500');
    });

    it('keeps the kobo remainder when an amount is not whole Naira', () => {
        expect(formatKobo(50_050)).toBe('₦500.5');
    });

    it('formats a per-kg rate', () => {
        expect(formatRateKobo(50_000)).toBe('₦500/kg');
    });
});

describe('whatsappLink', () => {
    it('strips formatting from the number and encodes the message', () => {
        const link = whatsappLink('+234 901 987 1421', 'Hello & welcome');
        expect(link).toContain('https://wa.me/2349019871421?text=');
        expect(link).toContain('Hello%20%26%20welcome');
    });
});
