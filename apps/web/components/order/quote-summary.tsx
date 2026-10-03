import { formatKobo, formatRateKobo, whatsappLink } from '@/lib/money';
import type { OrderQuote } from '@/lib/order-tracking';

/**
 * The farm's quote as the customer sees it (SPEC §5.4).
 *
 * Owner-confirmed rules:
 *  - only the newest quote is ever rendered (the API decides that);
 *  - an expired quote stays visible but greyed, because it explains why the order is no
 *    longer progressing and gives the customer a way forward;
 *  - there is no accept or pay action: SPEC §21 has no online payment, so there is nothing
 *    to accept against. Negotiation happens over WhatsApp.
 */
type Props = {
    quote: OrderQuote;
    reference: string;
    sizeLabel: string;
    quantityKg: number;
    fulfilment: string;
    whatsappNumber: string;
};

function formatValidUntil(value: string): string {
    const parsed = new Date(`${value}T00:00:00+01:00`);
    if (Number.isNaN(parsed.getTime())) return value;
    return parsed.toLocaleDateString('en-NG', {
        day: 'numeric',
        month: 'short',
        year: 'numeric',
        timeZone: 'Africa/Lagos',
    });
}

export function QuoteSummary({
    quote,
    reference,
    sizeLabel,
    quantityKg,
    fulfilment,
    whatsappNumber,
}: Props) {
    const validUntil = formatValidUntil(quote.valid_until);
    const freshQuoteMessage = `Hi, my order ${reference} quote has expired. Could we discuss a fresh quote? I need ${quantityKg}kg of ${sizeLabel}, ${fulfilment}.`;

    return (
        <section
            aria-labelledby="quote-heading"
            className={`rounded-lg border p-4 ${
                quote.is_expired
                    ? 'border-line-strong bg-canvas/60 text-ink-muted'
                    : 'border-[color:var(--brand-100)] bg-[color:var(--brand-100)]/30'
            }`}
        >
            <div className="flex flex-wrap items-baseline justify-between gap-2">
                <h2 id="quote-heading" className="font-display text-lg font-bold text-ink">
                    {quote.is_expired ? 'Expired quote' : 'Your quote'}
                </h2>
                <p
                    className={`text-sm font-semibold ${
                        quote.is_expired ? 'text-ink-muted' : 'text-[color:var(--brand-700)]'
                    }`}
                >
                    {quote.is_expired ? 'Expired' : 'Awaiting your reply'}
                </p>
            </div>

            <dl className="mt-3 grid gap-2 text-sm sm:grid-cols-2">
                <div>
                    <dt className="text-ink-muted">Quoted total</dt>
                    <dd className="font-semibold text-ink">{formatKobo(quote.total_kobo)}</dd>
                </div>
                <div>
                    <dt className="text-ink-muted">Valid until</dt>
                    <dd className="font-semibold text-ink">{validUntil}</dd>
                </div>
                <div>
                    <dt className="text-ink-muted">Price per kg</dt>
                    <dd className="text-ink">{formatRateKobo(quote.unit_price_kobo)}</dd>
                </div>
                {quote.delivery_fee_kobo > 0 ? (
                    <div>
                        <dt className="text-ink-muted">Delivery fee</dt>
                        <dd className="text-ink">{formatKobo(quote.delivery_fee_kobo)}</dd>
                    </div>
                ) : null}
                {quote.discount_kobo > 0 ? (
                    <div>
                        <dt className="text-ink-muted">Discount</dt>
                        <dd className="text-ink">-{formatKobo(quote.discount_kobo)}</dd>
                    </div>
                ) : null}
                {/*
                  The deposit is an arrangement agreed with the farm, never something payable
                  on the site (SPEC §21), so it is worded as an agreement and is omitted
                  entirely once the quote has expired.
                */}
                {quote.deposit_kobo > 0 && !quote.is_expired ? (
                    <div>
                        <dt className="text-ink-muted">Deposit agreed</dt>
                        <dd className="text-ink">
                            {formatKobo(quote.deposit_kobo)}
                            <span className="block text-xs text-ink-muted">
                                Agreed with the farm, payable on {fulfilment === 'delivery' ? 'delivery' : 'collection'}.
                            </span>
                        </dd>
                    </div>
                ) : null}
            </dl>

            {quote.message_to_customer ? (
                <p className="mt-3 border-t border-line pt-3 text-sm text-ink">
                    {quote.message_to_customer}
                </p>
            ) : null}

            {quote.is_expired ? (
                <p className="mt-3 text-sm text-ink-muted">
                    This quote is no longer valid. Reply to the farm to ask for a fresh one.
                </p>
            ) : (
                <p className="mt-3 text-sm text-ink-muted">
                    Nothing has been charged. Please reply to the farm to confirm this quote or discuss
                    any changes.
                </p>
            )}

            {/*
              The chat shortcut is omitted until the farm's number is known, so we never render
              a wa.me link built from an empty number.
            */}
            {whatsappNumber ? (
            <a
                href={whatsappLink(
                    whatsappNumber,
                    quote.is_expired
                        ? freshQuoteMessage
                        : `Hi, about my order ${reference}: the quote shows ${formatKobo(quote.total_kobo)} valid until ${validUntil}.`,
                )}
                className="mt-3 inline-flex min-h-11 items-center rounded-full bg-[color:var(--brand-700)] px-5 font-semibold text-white"
            >
                {quote.is_expired ? 'Ask for a fresh quote' : 'Chat about this quote'}
            </a>
            ) : null}
        </section>
    );
}
