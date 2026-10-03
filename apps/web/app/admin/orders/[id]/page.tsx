'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { useParams, useRouter } from 'next/navigation';
import { AdminApiError, fetchAdminOrder, statusLabel, type AdminOrderDetail } from '@/lib/admin-api';
import { formatKobo } from '@/lib/money';
import { whatsappLink } from '@/lib/money';

/**
 * Order detail, read-only for now (SPEC §9).
 *
 * The quote builder, payments entry and status transitions are deliberately not here yet; the
 * API supports them and they arrive in the next chunk. What this screen exists for is to let
 * the farm read an order and reach the customer.
 */
export default function AdminOrderDetailPage() {
    const params = useParams<{ id: string }>();
    const router = useRouter();
    const [order, setOrder] = useState<AdminOrderDetail | null>(null);
    const [error, setError] = useState<string | null>(null);

    useEffect(() => {
        let cancelled = false;
        void (async () => {
            try {
                const detail = await fetchAdminOrder(params.id);
                if (!cancelled) setOrder(detail);
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

    if (error) {
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

    const message = `Hi ${order.customer_name}, about your Adesoba order ${order.reference}: ${order.quantity_kg}kg ${order.size_label}, ${order.fulfilment === 'delivery' ? 'delivery' : 'pickup'}, preferred ${order.preferred_date}.`;
    const latestQuote = order.quotes[0] ?? null;

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

            <section aria-labelledby="customer-heading" className="mt-6">
                <h2 id="customer-heading" className="font-display text-lg font-bold text-ink">Customer</h2>
                <dl className="mt-2 grid gap-1 text-sm sm:grid-cols-[160px_1fr]">
                    <dt className="text-ink-muted">Name</dt><dd>{order.customer_name}</dd>
                    <dt className="text-ink-muted">Phone</dt><dd>{order.customer_phone}</dd>
                    {order.customer_email ? (<><dt className="text-ink-muted">Email</dt><dd>{order.customer_email}</dd></>) : null}
                    {order.customer_notes ? (<><dt className="text-ink-muted">Notes</dt><dd>{order.customer_notes}</dd></>) : null}
                </dl>
            </section>

            <section aria-labelledby="order-heading" className="mt-6">
                <h2 id="order-heading" className="font-display text-lg font-bold text-ink">Order</h2>
                <dl className="mt-2 grid gap-1 text-sm sm:grid-cols-[160px_1fr]">
                    <dt className="text-ink-muted">Fish</dt><dd>{order.fish_type} · {order.size_label}</dd>
                    <dt className="text-ink-muted">Quantity</dt><dd>{order.quantity_kg.toLocaleString('en-NG')}kg{order.is_bulk ? ' (bulk)' : ''}</dd>
                    <dt className="text-ink-muted">Preferred date</dt><dd>{order.preferred_date}</dd>
                    <dt className="text-ink-muted">Time slot</dt><dd>{order.time_slot_label}</dd>
                    <dt className="text-ink-muted">Fulfilment</dt><dd>{order.fulfilment === 'delivery' ? 'Delivery' : 'Pickup'}</dd>
                    {order.delivery_address ? (<><dt className="text-ink-muted">Delivery address</dt><dd>{order.delivery_address}</dd></>) : null}
                    {order.notes ? (<><dt className="text-ink-muted">Customer note</dt><dd>{order.notes}</dd></>) : null}
                </dl>
            </section>

            {/*
              Read-only in this chunk. The status machine lists only the transitions the API
              says are legal, so the buttons for them arrive with the next chunk.
            */}
            <section aria-labelledby="next-heading" className="mt-6">
                <h2 id="next-heading" className="font-display text-lg font-bold text-ink">Next steps</h2>
                <p className="mt-2 text-sm text-ink-muted">
                    {order.allowed_next_statuses.length > 0
                        ? `Available: ${order.allowed_next_statuses.map(statusLabel).join(', ')}.`
                        : 'This order is closed; no further transitions are possible.'}
                </p>
            </section>

            <section aria-labelledby="quote-heading" className="mt-6">
                <h2 id="quote-heading" className="font-display text-lg font-bold text-ink">Quoting</h2>
                {latestQuote ? (
                    <>
                        <p className="mt-2 text-sm">
                            Quote v{latestQuote.version_no}: {formatKobo(latestQuote.total_kobo)} · {statusLabel(latestQuote.status)}
                        </p>
                        <p className="text-sm text-ink-muted">Valid until {latestQuote.valid_until}</p>
                    </>
                ) : (
                    <p className="mt-2 text-sm text-ink-muted">Not quoted yet.</p>
                )}
                <p className="mt-3 text-sm text-ink-muted">
                    Creating and sending quotes arrives in the next chunk; use the API or WhatsApp for now.
                </p>
            </section>

            {order.due_kobo > 0 ? (
                <section aria-labelledby="payment-heading" className="mt-6">
                    <h2 id="payment-heading" className="font-display text-lg font-bold text-ink">Payments</h2>
                    <p className="mt-2 text-sm">
                        Paid {formatKobo(order.paid_kobo)} of {formatKobo(order.due_kobo)} · balance {formatKobo(order.balance_kobo)}
                    </p>
                </section>
            ) : null}

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
