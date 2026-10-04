'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { LoaderCircle } from 'lucide-react';
import {
    cancelTrackedOrder,
    fetchAccountOrders,
    fetchTrackedOrder,
    isActiveStatus,
    lookupOrder,
    readTrackedReferences,
    readTrackedToken,
    type AccountOrder,
    type TrackedOrder,
} from '@/lib/order-tracking';
import { QuoteSummary } from '@/components/order/quote-summary';
import { formatKobo } from '@/lib/money';

type Tab = 'active' | 'completed';

/** SPEC §5.4 My Orders: Active/Completed, track an order, order detail, cancel. */
/**
 * The farm's WhatsApp number, fetched from the catalog endpoint so the quote component can
 * build a prefilled chat link. Optional because the dashboard must still render if the
 * catalog call fails.
 */
function useWhatsappNumber(): string {
    const [number, setNumber] = useState('');

    useEffect(() => {
        let cancelled = false;
        void (async () => {
            try {
                const response = await fetch('/api/v1/catalog', { cache: 'no-store' });
                if (!response.ok) return;
                const body: unknown = await response.json();
                if (cancelled || !body || typeof body !== 'object') return;
                const settings = (body as { settings?: { whatsapp_number?: string } }).settings;
                if (settings?.whatsapp_number) setNumber(settings.whatsapp_number);
            } catch {
                // A missing number only costs the chat shortcut; the quote itself still shows.
            }
        })();
        return () => {
            cancelled = true;
        };
    }, []);

    return number;
}

export function MyOrdersDashboard() {
    const whatsappNumber = useWhatsappNumber();
    const [tab, setTab] = useState<Tab>('active');
    const [orders, setOrders] = useState<TrackedOrder[]>([]);
    const [accountOrders, setAccountOrders] = useState<AccountOrder[]>([]);
    const [selected, setSelected] = useState<TrackedOrder | null>(null);
    const [reference, setReference] = useState('');
    const [phone, setPhone] = useState('');
    const [message, setMessage] = useState<string | null>(null);
    const [loading, setLoading] = useState(true);
    const [pending, setPending] = useState(false);

    const load = useCallback(async () => {
        setLoading(true);
        const tracked: TrackedOrder[] = [];
        for (const item of readTrackedReferences()) {
            const token = readTrackedToken(item);
            if (!token) continue;
            try {
                tracked.push(await fetchTrackedOrder(item, token));
            } catch {
                // A rotated or revoked token simply drops the card; lookup can restore it.
            }
        }
        setOrders(tracked);
        const account = await fetchAccountOrders().catch(() => ({ orders: [], csrfToken: null }));
        setAccountOrders(account.orders);
        setLoading(false);
    }, []);

    useEffect(() => {
        void load();
    }, [load]);

    const active = useMemo(() => orders.filter((order) => isActiveStatus(order.status)), [orders]);
    const completed = useMemo(() => orders.filter((order) => !isActiveStatus(order.status)), [orders]);
    const visible = tab === 'active' ? active : completed;

    async function submitLookup(event: React.FormEvent<HTMLFormElement>) {
        event.preventDefault();
        setPending(true);
        setMessage(null);
        try {
            const order = await lookupOrder(reference.trim().toUpperCase(), phone.trim());
            setOrders((current) => [order, ...current.filter((item) => item.reference !== order.reference)]);
            setSelected(order);
            setMessage(`Found order ${order.reference}.`);
        } catch (error) {
            setMessage(error instanceof Error ? error.message : 'We could not find that order.');
        } finally {
            setPending(false);
        }
    }

    async function cancelSelected() {
        if (!selected) return;
        const token = readTrackedToken(selected.reference);
        if (!token) return;
        setPending(true);
        try {
            const status = await cancelTrackedOrder(selected.reference, token);
            setMessage(`Order ${selected.reference} is now ${status}.`);
            setSelected({ ...selected, status });
            await load();
        } catch (error) {
            setMessage(error instanceof Error ? error.message : 'We could not cancel that order.');
        } finally {
            setPending(false);
        }
    }

    return (
        <div className="mt-8">
            <section aria-labelledby="track-heading" className="rounded-3xl border border-line-soft bg-white p-6 shadow-sm">
                <h2 id="track-heading" className="font-display text-xl font-bold text-ink">Track an order</h2>
                <p className="mt-1 text-sm text-ink-muted">Enter the reference we sent you and the phone number you used.</p>
                <form onSubmit={submitLookup} className="mt-4 grid gap-3 sm:grid-cols-[1fr_1fr_auto]">
                    <label className="grid gap-1 text-sm font-semibold text-ink">
                        Order reference
                        <input
                            value={reference}
                            onChange={(event) => setReference(event.target.value)}
                            placeholder="AF-2026-0001"
                            className="min-h-12 rounded-lg border border-line-strong bg-canvas px-4 font-normal"
                        />
                    </label>
                    <label className="grid gap-1 text-sm font-semibold text-ink">
                        Phone number
                        <input
                            value={phone}
                            onChange={(event) => setPhone(event.target.value)}
                            inputMode="tel"
                            placeholder="0801 234 5678"
                            className="min-h-12 rounded-lg border border-line-strong bg-canvas px-4 font-normal"
                        />
                    </label>
                    <button type="submit" disabled={pending} className="inline-flex min-h-12 items-center justify-center rounded-full bg-[color:var(--brand-700)] px-6 font-semibold text-white disabled:opacity-60">
                        {pending ? <LoaderCircle aria-hidden="true" className="mr-2 animate-spin motion-reduce:animate-none" size={16} /> : null}
                        Find order
                    </button>
                </form>
                <p role="status" aria-live="polite" className="mt-3 min-h-5 text-sm text-ink-muted">{message}</p>
            </section>

            {accountOrders.length > 0 ? (
                <section aria-labelledby="account-orders-heading" className="mt-6 rounded-3xl border border-line-soft bg-white p-6 shadow-sm">
                    <h2 id="account-orders-heading" className="font-display text-lg font-bold text-ink">Linked to your Google account</h2>
                    <ul className="mt-3 grid gap-2">
                        {accountOrders.map((order) => (
                            <li key={order.reference} className="flex flex-wrap items-center justify-between gap-2 border-b border-line-soft py-2 text-sm">
                                <span className="font-semibold">{order.reference}</span>
                                <span className="text-ink-muted">{order.quantity_kg.toLocaleString('en-NG')}kg {order.size_label} · {order.status}</span>
                            </li>
                        ))}
                    </ul>
                </section>
            ) : null}

            <section aria-label="Your orders" className="mt-6 rounded-3xl border border-line-soft bg-white p-6 shadow-sm">
                <div className="flex gap-3">
                    <button
                        type="button"
                        onClick={() => setTab('active')}
                        aria-pressed={tab === 'active'}
                        className={`rounded-full px-4 py-2 text-sm font-semibold ${tab === 'active' ? 'bg-[color:var(--brand-700)] text-white' : 'border border-line-soft text-ink'}`}
                    >
                        Active
                    </button>
                    <button
                        type="button"
                        onClick={() => setTab('completed')}
                        aria-pressed={tab === 'completed'}
                        className={`rounded-full px-4 py-2 text-sm font-semibold ${tab === 'completed' ? 'bg-[color:var(--brand-700)] text-white' : 'border border-line-soft text-ink'}`}
                    >
                        Completed
                    </button>
                </div>

                {loading ? <p role="status" className="mt-6 text-sm text-ink-muted">Loading your orders…</p> : null}
                {!loading && visible.length === 0 ? (
                    <p className="mt-6 rounded-2xl border border-dashed border-line-soft p-6 text-sm text-ink-muted">
                        {tab === 'active' ? 'No active orders yet. Track an order above or send a new request.' : 'No completed orders yet.'}
                    </p>
                ) : null}

                <ul className="mt-6 grid gap-3">
                    {visible.map((order) => (
                        <li key={order.reference} className="flex flex-wrap items-center justify-between gap-3 border-b border-line-soft py-3">
                            <div>
                                <p className="font-semibold text-ink">{order.reference}</p>
                                <p className="text-sm text-ink-muted">
                                    {order.quantity_kg.toLocaleString('en-NG')}kg {order.size_label} · {order.fulfilment === 'delivery' ? 'Delivery' : 'Pickup'}
                                </p>
                            </div>
                            <div className="flex items-center gap-3">
                                <span className="rounded-full bg-[color:var(--brand-100)] px-3 py-1 text-xs font-semibold text-brand-900">{order.status}</span>
                                <button
                                    type="button"
                                    onClick={() => setSelected(order)}
                                    className="text-sm font-semibold underline underline-offset-2"
                                >
                                    View details
                                </button>
                            </div>
                        </li>
                    ))}
                </ul>
            </section>

            {selected ? (
                <section aria-labelledby="order-detail-heading" className="mt-6 rounded-3xl border border-line-soft bg-white p-6 shadow-sm">
                    <h2 id="order-detail-heading" className="font-display text-lg font-bold text-ink">Order {selected.reference}</h2>
                    <dl className="mt-3 grid gap-2 text-sm sm:grid-cols-[180px_1fr]">
                        <dt className="text-ink-muted">Status</dt><dd className="font-semibold">{selected.status}</dd>
                        <dt className="text-ink-muted">Fish</dt><dd>{selected.fish_type} · {selected.size_label}</dd>
                        <dt className="text-ink-muted">Quantity</dt><dd>{selected.quantity_kg.toLocaleString('en-NG')}kg</dd>
                        <dt className="text-ink-muted">Indicative estimate</dt>
                        <dd>
                            {selected.indicative_total_kobo != null ? (
                                <>
                                    <span className="font-semibold">{formatKobo(selected.indicative_total_kobo)}</span>
                                    <span className="mt-1 block text-xs text-ink-muted">Estimate only. Excludes delivery. The farm confirms your final price.</span>
                                </>
                            ) : 'Price on request'}
                        </dd>
                        <dt className="text-ink-muted">Preferred date</dt><dd>{selected.preferred_date}</dd>
                        <dt className="text-ink-muted">Time slot</dt><dd>{selected.time_slot_label}</dd>
                        <dt className="text-ink-muted">Phone</dt><dd>{selected.customer_phone_masked}</dd>
                        {selected.delivery_address ? (<><dt className="text-ink-muted">Delivery address</dt><dd>{selected.delivery_address}</dd></>) : null}
                    </dl>
                    {/*
                      Quote visibility (SPEC §5.4, ADR 18). The API already returns at most one
                      quote, and never a superseded one, so this only has to decide whether to
                      render it. Nothing is actionable here on purpose: SPEC §21 has no online
                      payment, so the customer replies over WhatsApp instead.
                    */}
                    {selected.quote ? (
                        <div className="mt-5">
                            <QuoteSummary
                                quote={selected.quote}
                                reference={selected.reference}
                                sizeLabel={selected.size_label}
                                quantityKg={selected.quantity_kg}
                                fulfilment={selected.fulfilment}
                                whatsappNumber={whatsappNumber}
                            />
                        </div>
                    ) : null}

                    <h3 className="mt-5 text-sm font-semibold text-ink">History</h3>
                    <ol className="mt-2 grid gap-2 text-sm text-ink-muted">
                        {selected.events.map((event, index) => (
                            <li key={`${event.created_at}-${index}`}>{event.created_at} — {event.to_status}{event.note ? `: ${event.note}` : ''}</li>
                        ))}
                    </ol>
                    {isActiveStatus(selected.status) && selected.status !== 'quoted' ? (
                        <button type="button" onClick={() => void cancelSelected()} disabled={pending} className="mt-5 rounded-full border border-line-strong px-5 py-2 text-sm font-semibold text-ink disabled:opacity-60">
                            Cancel this request
                        </button>
                    ) : null}
                    <p className="mt-4 text-sm">
                        <Link href={`/order?reference=${selected.reference}`} className="font-semibold underline underline-offset-2">Order another batch</Link>
                    </p>
                </section>
            ) : null}
        </div>
    );
}
