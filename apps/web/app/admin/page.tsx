'use client';

import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import {
    AdminApiError,
    fetchAdminOrders,
    statusLabel,
    type AdminOrderListResponse,
    type AdminOrderSummary,
} from '@/lib/admin-api';
import { whatsappLink } from '@/lib/money';

const STATUS_FILTERS = ['', 'pending', 'quoted', 'confirmed', 'ready', 'completed', 'cancelled', 'declined', 'expired'];

/**
 * Orders list (SPEC §9, mobile-usable: cards on small screens, table on wide ones).
 *
 * Each row carries a WhatsApp action with the reference prefilled, which is how the farm
 * actually contacts a customer about an order.
 */
export default function AdminOrdersPage() {
    const router = useRouter();
    const [data, setData] = useState<AdminOrderListResponse | null>(null);
    const [status, setStatus] = useState('');
    const [search, setSearch] = useState('');
    const [error, setError] = useState<string | null>(null);
    const [loading, setLoading] = useState(true);
    const [mustChangePassword, setMustChangePassword] = useState(false);

    useEffect(() => {
        setMustChangePassword(
            sessionStorage.getItem('adesoba_admin_must_change_password') === 'true',
        );
    }, []);

    const load = useCallback(async () => {
        setLoading(true);
        try {
            setData(await fetchAdminOrders({ status: status || undefined, search: search || undefined }));
            setError(null);
        } catch (caught) {
            if (caught instanceof AdminApiError && caught.status === 401) {
                router.replace('/admin/login');
                return;
            }
            setError(caught instanceof Error ? caught.message : 'Could not load orders.');
        } finally {
            setLoading(false);
        }
    }, [status, search, router]);

    useEffect(() => {
        void load();
    }, [load]);

    function messageFor(order: AdminOrderSummary): string {
        return `Hi ${order.customer_name}, about your Adesoba order ${order.reference}: ${order.quantity_kg}kg ${order.size_label}, ${order.fulfilment === 'delivery' ? 'delivery' : 'pickup'}, preferred ${order.preferred_date}.`;
    }

    return (
        <main className="mx-auto max-w-5xl px-4 py-8 md:px-8">
            <div className="flex flex-wrap items-baseline justify-between gap-3">
                <h1 className="font-display text-3xl font-bold text-[color:var(--text)]">Orders</h1>
                <button type="button" onClick={() => void load()} className="min-h-11 rounded-full border border-line-strong px-4 text-sm font-semibold text-ink">
                    Refresh
                </button>
            </div>

            <div className="mt-5 grid gap-3 sm:grid-cols-[200px_1fr]">
                <div>
                    <label htmlFor="status-filter" className="text-sm font-semibold text-ink">Status</label>
                    <select
                        id="status-filter"
                        value={status}
                        onChange={(event) => setStatus(event.target.value)}
                        className="mt-1 min-h-11 w-full rounded-lg border border-line-strong bg-canvas px-3 text-ink"
                    >
                        {STATUS_FILTERS.map((value) => (
                            <option key={value} value={value}>{value ? statusLabel(value) : 'All statuses'}</option>
                        ))}
                    </select>
                </div>
                <div>
                    <label htmlFor="order-search" className="text-sm font-semibold text-ink">Search</label>
                    <input
                        id="order-search"
                        type="search"
                        placeholder="Reference, name or phone"
                        value={search}
                        onChange={(event) => setSearch(event.target.value)}
                        className="mt-1 min-h-11 w-full rounded-lg border border-line-strong bg-canvas px-3 text-ink"
                    />
                </div>
            </div>

            {mustChangePassword ? (
                <p role="status" className="mt-4 rounded-lg border border-line-strong bg-canvas p-3 text-sm font-semibold text-ink">
                    This account still uses its starting password. Change it before handling live
                    orders. The change-password screen arrives with the next chunk; until then use the
                    API endpoint <code>POST /api/v1/admin/auth/change-password</code>.
                </p>
            ) : null}

            {error ? <p role="alert" className="mt-4 text-sm font-semibold text-[color:var(--brand-700)]">{error}</p> : null}
            {loading ? <p className="mt-6 text-sm text-ink-muted">Loading orders…</p> : null}

            {data && !loading ? (
                <>
                    <p className="mt-5 text-sm text-ink-muted">
                        {data.total} order{data.total === 1 ? '' : 's'}
                    </p>
                    {data.orders.length === 0 ? (
                        <p className="mt-4 text-sm text-ink-muted">No orders match these filters.</p>
                    ) : (
                        <ul className="mt-3 grid gap-3">
                            {data.orders.map((order) => (
                                <li key={order.id} className="rounded-lg border border-line-soft bg-white p-4 shadow-sm">
                                    <div className="flex flex-wrap items-baseline justify-between gap-2">
                                        <span className="font-display text-lg font-bold text-ink">{order.reference}</span>
                                        <span className="rounded-full bg-[color:var(--brand-100)] px-3 py-1 text-xs font-semibold text-[color:var(--brand-700)]">
                                            {statusLabel(order.status)}
                                        </span>
                                    </div>
                                    <p className="mt-1 text-sm text-ink">
                                        {order.customer_name} · {order.quantity_kg.toLocaleString('en-NG')}kg {order.size_label}
                                        {order.is_bulk ? ' · bulk' : ''}
                                    </p>
                                    <p className="text-sm text-ink-muted">
                                        {order.fulfilment === 'delivery' ? 'Delivery' : 'Pickup'} · {order.preferred_date} · {order.time_slot_label}
                                    </p>
                                    <div className="mt-3 flex flex-wrap gap-2">
                                        <Link
                                            href={`/admin/orders/${order.id}`}
                                            className="inline-flex min-h-11 items-center rounded-full bg-[color:var(--brand-700)] px-5 text-sm font-semibold text-white"
                                        >
                                            View details
                                        </Link>
                                        <a
                                            href={whatsappLink(order.customer_phone, messageFor(order))}
                                            className="inline-flex min-h-11 items-center rounded-full border border-line-strong px-5 text-sm font-semibold text-ink"
                                        >
                                            WhatsApp
                                        </a>
                                    </div>
                                </li>
                            ))}
                        </ul>
                    )}
                </>
            ) : null}
        </main>
    );
}
