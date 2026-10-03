/**
 * Kobo formatting (SPEC §12: currency ₦, formatted `₦1,250,000`).
 *
 * Money is stored and transported as integer kobo everywhere. It is only turned into a
 * display string here, so no rounding decision is ever made in the browser.
 */

/** Render integer kobo as a Naira amount, e.g. 125000000 -> `₦1,250,000`. */
export function formatKobo(kobo: number): string {
    const naira = kobo / 100;
    return `₦${naira.toLocaleString('en-NG', { maximumFractionDigits: 2 })}`;
}

/** Render a per-kg rate without the awkward trailing `.00`, e.g. `₦500/kg`. */
export function formatRateKobo(kobo: number): string {
    return `${formatKobo(kobo)}/kg`;
}

/**
 * A WhatsApp link with a prefilled message (SPEC §5.5 uses the same pattern for "Chat on
 * WhatsApp"). Digits are stripped because wa.me expects the bare international number.
 */
export function whatsappLink(number: string, message: string): string {
    const digits = number.replace(/\D/g, '');
    return `https://wa.me/${digits}?text=${encodeURIComponent(message)}`;
}
