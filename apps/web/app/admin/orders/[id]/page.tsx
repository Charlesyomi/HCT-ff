'use client';

import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { useParams, useRouter } from 'next/navigation';
import {
    AdminApiError,
    adminMe,
    createQuote,
    fetchAdminOrder,
    quoteTotalKobo,
    recordPayment,
    statusLabel,
    transitionOrder,
    type AdminOrderDetail,
} from '@/lib/admin-api';
import { formatKobo, whatsappLink } from '@/lib/money';

/**
 * Order detail with quoting, payments and status transitions (SPEC §9).
 *
 * Money is entered in Naira and sent as integer kobo, so the form never handles a float and
 * the API recomputes the total authoritatively. After any write the order is re-read rather
 * than patched locally, because every mutation bumps `version` and a stale local copy would
 * make the next write fail its optimistic-lock check with a confusing 409.
 */
export default function AdminOrderDetailPage() {
    const params = useParams<{ id: string }>();
    const router = useRouter();

    const [order, setOrder] = useState<AdminOrderDetail | null>(null);
    const [csrfToken, setCsrfToken] = useState<string | null>(null);
    const [error, setError] = useState<string | null>(null);
    const [notice, setNotice] = useState<string | null>(null);
    const [pending, setPending] = useState(false);

    // Quote form, in Naira for the person filling it in.
    const [unitPrice, setUnitPrice] = useState('');
    const [deliveryFee, setDeliveryFee] = useState('');
    const [discount, setDiscount] = useState('');
    const [deposit, setDeposit] = useState('');
    const [validUntil, setValidUntil] = useState('');
    const [messageToCustomer, setMessageToCustomer] = useState('');

    // Payment form.
    const [paymentAmount, setPaymentAmount] = useState('');
    const [paymentMethod, setPaymentMethod] = useState<'cash' | 'transfer' | 'pos' | 'other'>('cash');

    const refresh = useCallback(async () => {
        const [detail, me] = await Promise.all([fetchAdminOrder(params.id), adminMe()]);
        setOrder(detail);
        setCsrfToken(me.csrf_token);
        // Default the deposit to the amount still outstanding.
        if (detail.due_kobo > detail.paid_kobo) {
            setPaymentAmount(String((detail.due_kobo - detail.paid_kobo) / 100));
        } else {
            setPaymentAmount('');
        }
    }, [params.id]);

    useEffect(() => {
        let cancelled = false;
        void (async () => {
            try {
                const detail = await fetchAdminOrder(params.id);
                if (cancelled) return;
                setOrder(detail);
                if (detail.due_kobo > detail.paid_kobo) {
                    setPaymentAmount(String((detail.due_kobo - detail.paid_kobo) / 100));
                }
                const me = await adminMe();
                if (!cancelled) setCsrfToken(me.csrf_token);
            } catch (caught) {
                if (cancelled) return;
                if (caught instanceof AdminApiError && caught.status === 401) {
                    router.replace('/admin/login');
                    return;
                }
                setError(caught instanceof Error ? caught.message : 'Could not load this order.');
            }
        })();
        return () => {
            cancelled = true;
        };
    }, [params.id, router]);

    async function run(action: () => Promise<unknown>, success: string) {
        if (!csrfToken) return;
        setPending(true);
        setError(null);
        setNotice(null);
        try {
            await action();
            await refresh();
            setNotice(success);
        } catch (caught) {
            setError(caught instanceof Error ? caught.message : 'That change did not save.');
        } finally {
            setPending(false);
        }
    }

    if (error && !order) {
        return (
            <main className="mx-auto max-w-3xl px-4 py-8">
                <p role="alert" className="text-sm font-semibold text-[color:var(--brand-700)]">{error}</p>
                <Link href="/admin" className="mt-4 inline-block text-sm underline underline-offset-2">Back to orders</Link>
            </main>
        );
    }

    if (!order) {
        return (
            <main className="mx-auto max-w-3xl px-4 py-8">
                <p className="text-sm text-ink-muted">Loading order…</p>
            </main>
        );
    }

    const toKobo = (value: string) => Math.max(0, Math.round(Number(value || '0') * 100));
    const draft = {
        unit_price_kobo: toKobo(unitPrice),
        quantity_kg: order.quantity_kg,
        delivery_fee_kobo: toKobo(deliveryFee),
        discount_kobo: toKobo(discount),
    };
    const previewTotal = quoteTotalKobo(draft);

    const message = `Hi ${order.customer_name}, about your HCT Fish Farms order ${order.reference}: ${order.quantity_kg}kg ${order.size_label}, ${order.fulfilment === 'delivery' ? 'delivery' : 'pickup'}, preferred ${order.preferred_date}.`;

    return (
        <main className="mx-auto max-w-3xl px-4 py-8 md:px-8">
            <Link href="/admin" className="text-sm underline underline-offset-2">Back to orders</Link>

            <div className="mt-3 flex flex-wrap items-baseline justify-between gap-3">
                <h1 className="font-display text-2xl font-bold text-[color:var(--text)]">{order.reference}</h1>
                <span className="rounded-full bg-[color:var(--brand-100)] px-3 py-1 text-xs font-semibold text-[color:var(--brand-700)]">
                    {statusLabel(order.status)}
                </span>
            </div>

            <div className="mt-4 flex flex-wrap gap-2">
                <a
                    href={whatsappLink(order.customer_phone, message)}
                    className="inline-flex min-h-11 items-center rounded-full bg-[color:var(--brand-700)] px-5 text-sm font-semibold text-white"
                >
                    WhatsApp {order.customer_name}
                </a>
                <a
                    href={`tel:${order.customer_phone}`}
                    className="inline-flex min-h-11 items-center rounded-full border border-line-strong px-5 text-sm font-semibold text-ink"
                >
                    Call
                </a>
            </div>

            {notice ? <p role="status" className="mt-4 rounded-lg border border-line-soft p-3 text-sm text-ink">{notice}</p> : null}
            {error ? <p role="alert" className="mt-4 text-sm font-semibold text-[color:var(--brand-700)]">{error}</p> : null}

            <section aria-labelledby="order-heading" className="mt-6">
                <h2 id="order-heading" className="font-display text-lg font-bold text-ink">Order</h2>
                <dl className="mt-2 grid gap-1 text-sm sm:grid-cols-[160px_1fr]">
                    <dt className="text-ink-muted">Fish</dt><dd>{order.fish_type} · {order.size_label}</dd>
                    <dt className="text-ink-muted">Quantity</dt><dd>{order.quantity_kg.toLocaleString('en-NG')}kg{order.is_bulk ? ' (bulk)' : ''}</dd>
                    <dt className="text-ink-muted">Preferred date</dt><dd>{order.preferred_date}</dd>
                    <dt className="text-ink-muted">Time slot</dt><dd>{order.time_slot_label}</dd>
                    <dt className="text-ink-muted">Fulfilment</dt><dd>{order.fulfilment === 'delivery' ? 'Delivery' : 'Pickup'}</dd>
                    <dt className="text-ink-muted">Phone</dt><dd>{order.customer_phone}</dd>
                    {order.customer_email ? (<><dt className="text-ink-muted">Email</dt><dd>{order.customer_email}</dd></>) : null}
                    {order.delivery_address ? (<><dt className="text-ink-muted">Delivery address</dt><dd>{order.delivery_address}</dd></>) : null}
                    {order.notes ? (<><dt className="text-ink-muted">Customer note</dt><dd>{order.notes}</dd></>) : null}
                </dl>
            </section>

            {/*
              Only transitions the API reports as legal are offered, so the status machine
              cannot be bypassed from the UI. Each sends the version it read; a concurrent
              change by someone else comes back as a 409 and re-reads.
            */}
            <section aria-labelledby="transition-heading" className="mt-6">
                <h2 id="transition-heading" className="font-display text-lg font-bold text-ink">Move this order on</h2>
                {order.allowed_next_statuses.length === 0 ? (
                    <p className="mt-2 text-sm text-ink-muted">This order is closed; no further transitions are possible.</p>
                ) : (
                    <div className="mt-2 flex flex-wrap gap-2">
                        {order.allowed_next_statuses.map((next) => (
                            <button
                                key={next}
                                type="button"
                                disabled={pending}
                                onClick={() => void run(() => transitionOrder(order.id, next, order.version, csrfToken ?? ''), `Order moved to ${statusLabel(next)}.`)}
                                className="inline-flex min-h-11 items-center rounded-full border border-line-strong px-5 text-sm font-semibold text-ink disabled:opacity-60"
                            >
                                {statusLabel(next)}
                            </button>
                        ))}
                    </div>
                )}
            </section>

            <section aria-labelledby="quote-heading" className="mt-6 rounded-lg border border-line-soft p-4">
                <h2 id="quote-heading" className="font-display text-lg font-bold text-ink">
                    {order.quotes.length > 0 ? 'Send a new quote' : 'Quote this order'}
                </h2>
                {order.quotes.length > 0 ? (
                    <p className="mt-1 text-sm text-ink-muted">
                        Latest: v{order.quotes[0].version_no} · {formatKobo(order.quotes[0].total_kobo)} ·{' '}
                        {statusLabel(order.quotes[0].status)}. Sending again supersedes it.
                    </p>
                ) : null}

                <div className="mt-3 grid gap-3 sm:grid-cols-2">
                    <div>
                        <label htmlFor="unit-price" className="text-sm font-semibold text-ink">Price per kg (₦)</label>
                        <input id="unit-price" type="number" min="0" step="0.01" inputMode="decimal" value={unitPrice} onChange={(e) => setUnitPrice(e.target.value)} className="mt-1 min-h-11 w-full rounded-lg border border-line-strong bg-canvas px-3 text-ink" />
                    </div>
                    <div>
                        <label htmlFor="quantity" className="text-sm font-semibold text-ink">Quantity (kg)</label>
                        <input id="quantity" type="number" value={order.quantity_kg} readOnly className="mt-1 min-h-11 w-full rounded-lg border border-line-strong bg-canvas px-3 text-ink opacity-70" />
                    </div>
                    <div>
                        <label htmlFor="delivery-fee" className="text-sm font-semibold text-ink">Delivery fee (₦)</label>
                        <input id="delivery-fee" type="number" min="0" step="0.01" inputMode="decimal" value={deliveryFee} onChange={(e) => setDeliveryFee(e.target.value)} className="mt-1 min-h-11 w-full rounded-lg border border-line-strong bg-canvas px-3 text-ink" />
                    </div>
                    <div>
                        <label htmlFor="discount" className="text-sm font-semibold text-ink">Discount (₦)</label>
                        <input id="discount" type="number" min="0" step="0.01" inputMode="decimal" value={discount} onChange={(e) => setDiscount(e.target.value)} className="mt-1 min-h-11 w-full rounded-lg border border-line-strong bg-canvas px-3 text-ink" />
                    </div>
                    <div>
                        <label htmlFor="deposit" className="text-sm font-semibold text-ink">Deposit (₦)</label>
                        <input id="deposit" type="number" min="0" step="0.01" inputMode="decimal" value={deposit} onChange={(e) => setDeposit(e.target.value)} className="mt-1 min-h-11 w-full rounded-lg border border-line-strong bg-canvas px-3 text-ink" />
                    </div>
                    <div>
                        <label htmlFor="valid-until" className="text-sm font-semibold text-ink">Valid until</label>
                        <input id="valid-until" type="date" value={validUntil} onChange={(e) => setValidUntil(e.target.value)} className="mt-1 min-h-11 w-full rounded-lg border border-line-strong bg-canvas px-3 text-ink" />
                    </div>
                </div>

                <div className="mt-3">
                    <label htmlFor="quote-message" className="text-sm font-semibold text-ink">Message to the customer (optional)</label>
                    <textarea id="quote-message" rows={2} value={messageToCustomer} onChange={(e) => setMessageToCustomer(e.target.value)} className="mt-1 w-full rounded-lg border border-line-strong bg-canvas px-3 py-2 text-ink" />
                </div>

                <p className="mt-3 text-sm">
                    <span className="text-ink-muted">Live total: </span>
                    <output className="font-semibold text-ink">{previewTotal > 0 ? formatKobo(previewTotal) : '—'}</output>
                </p>

                <button
                    type="button"
                    disabled={pending || unitPrice === '' || validUntil === ''}
                    onClick={() =>
                        void run(
                            () => createQuote(order.id, { ...draft, deposit_kobo: toKobo(deposit), valid_until: validUntil, message_to_customer: messageToCustomer || undefined }, csrfToken ?? ''),
                            'Quote sent.',
                        )
                    }
                    className="mt-3 min-h-11 rounded-full bg-[color:var(--brand-700)] px-5 font-semibold text-white disabled:opacity-60"
                >
                    {pending ? 'Sending…' : 'Send quote'}
                </button>
            </section>

            <section aria-labelledby="payment-heading" className="mt-6 rounded-lg border border-line-soft p-4">
                <h2 id="payment-heading" className="font-display text-lg font-bold text-ink">Record a payment</h2>
                <p className="mt-1 text-sm text-ink-muted">
                    Due {formatKobo(order.due_kobo)} · paid {formatKobo(order.paid_kobo)} · balance {formatKobo(order.balance_kobo)}
                </p>
                <div className="mt-3 grid gap-3 sm:grid-cols-2">
                    <div>
                        <label htmlFor="payment-amount" className="text-sm font-semibold text-ink">Amount (₦)</label>
                        <input id="payment-amount" type="number" min="0" step="0.01" inputMode="decimal" value={paymentAmount} onChange={(e) => setPaymentAmount(e.target.value)} className="mt-1 min-h-11 w-full rounded-lg border border-line-strong bg-canvas px-3 text-ink" />
                    </div>
                    <div>
                        <label htmlFor="payment-method" className="text-sm font-semibold text-ink">Method</label>
                        <select id="payment-method" value={paymentMethod} onChange={(e) => setPaymentMethod(e.target.value as 'cash')} className="mt-1 min-h-11 w-full rounded-lg border border-line-strong bg-canvas px-3 text-ink">
                            <option value="cash">Cash</option>
                            <option value="transfer">Transfer</option>
                            <option value="pos">POS</option>
                            <option value="other">Other</option>
                        </select>
                    </div>
                </div>
                <button
                    type="button"
                    disabled={pending || paymentAmount === ''}
                    onClick={() => void run(() => recordPayment(order.id, { amount_kobo: toKobo(paymentAmount), method: paymentMethod }, csrfToken ?? ''), 'Payment recorded.')}
                    className="mt-3 min-h-11 rounded-full bg-[color:var(--brand-700)] px-5 font-semibold text-white disabled:opacity-60"
                >
                    {pending ? 'Saving…' : 'Record payment'}
                </button>
            </section>

            {order.internal_notes ? (
                <section aria-labelledby="internal-heading" className="mt-6">
                    <h2 id="internal-heading" className="font-display text-lg font-bold text-ink">Internal notes</h2>
                    <p className="mt-2 text-sm text-ink-muted">{order.internal_notes}</p>
                </section>
            ) : null}

            <section aria-labelledby="history-heading" className="mt-6">
                <h2 id="history-heading" className="font-display text-lg font-bold text-ink">History</h2>
                <ol className="mt-2 grid gap-1 text-sm text-ink-muted">
                    {order.events.map((event, index) => (
                        <li key={`${event.created_at}-${index}`}>
                            {event.created_at} — {statusLabel(event.to_status)}
                            {event.note ? `: ${event.note}` : ''}
                        </li>
                    ))}
                </ol>
            </section>
        </main>
    );
}
