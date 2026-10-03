'use client';

/**
 * Browser client for the admin API (SPEC §8).
 *
 * The admin API lives at `/api/v1/admin` and is proxied to the FastAPI container by
 * `next.config.mjs`, so every call here is same-origin and the HttpOnly admin session cookie
 * rides along automatically. No token is ever read or stored in JavaScript.
 *
 * Every mutating call must send the CSRF token returned by login; `adminFetch` handles that
 * so callers cannot forget it.
 */

const BASE = '/api/v1/admin';

export type AdminUser = {
    id: string;
    email: string;
    name: string;
    role: 'owner' | 'staff';
    is_active: boolean;
    must_change_password: boolean;
    last_login_at: string | null;
};

export type AdminOrderSummary = {
    id: string;
    reference: string;
    status: string;
    customer_name: string;
    customer_phone: string;
    fish_type: string;
    size_label: string;
    quantity_kg: number;
    is_bulk: boolean;
    preferred_date: string;
    time_slot_label: string;
    fulfilment: string;
    submitted_at: string;
    version: number;
};

export type AdminOrderListResponse = {
    orders: AdminOrderSummary[];
    total: number;
    page: number;
    page_size: number;
};

export type AdminQuote = {
    id: string;
    version_no: number;
    unit_price_kobo: number;
    quantity_kg: number;
    delivery_fee_kobo: number;
    discount_kobo: number;
    total_kobo: number;
    deposit_kobo: number;
    valid_until: string;
    message_to_customer: string | null;
    status: string;
    created_at: string;
    accepted_at: string | null;
};

export type AdminPayment = {
    id: string;
    amount_kobo: number;
    method: string;
    reference: string | null;
    note: string | null;
    received_at: string;
};

export type AdminOrderDetail = {
    id: string;
    reference: string;
    status: string;
    version: number;
    allowed_next_statuses: string[];
    customer_name: string;
    customer_phone: string;
    customer_email: string | null;
    customer_notes: string | null;
    fish_type: string;
    size_label: string;
    quantity_kg: number;
    is_bulk: boolean;
    preferred_date: string;
    time_slot_label: string;
    fulfilment: string;
    delivery_address: string | null;
    delivery_landmark: string | null;
    notes: string | null;
    internal_notes: string | null;
    assigned_to: string | null;
    source_intent: string | null;
    submitted_at: string;
    closed_at: string | null;
    quotes: AdminQuote[];
    payments: AdminPayment[];
    paid_kobo: number;
    due_kobo: number;
    balance_kobo: number;
    events: { type: string; from_status: string | null; to_status: string; note: string | null; created_at: string }[];
};

export class AdminApiError extends Error {
    constructor(
        message: string,
        readonly status: number,
    ) {
        super(message);
        this.name = 'AdminApiError';
    }
}

async function readError(response: Response): Promise<string> {
    try {
        const body: unknown = await response.json();
        if (body && typeof body === 'object' && 'detail' in body) {
            const detail = (body as { detail: unknown }).detail;
            if (typeof detail === 'string') return detail;
        }
    } catch {
        // Fall through to the generic message below.
    }
    return 'Something went wrong. Please try again.';
}

export async function adminFetch<T>(path: string, init?: RequestInit & { csrfToken?: string }): Promise<T> {
    const { csrfToken, ...rest } = init ?? {};
    const response = await fetch(`${BASE}${path}`, {
        ...rest,
        credentials: 'same-origin',
        headers: {
            'Content-Type': 'application/json',
            ...(csrfToken ? { 'X-CSRF-Token': csrfToken } : {}),
            ...(rest.headers ?? {}),
        },
    });

    if (response.status === 401) {
        throw new AdminApiError('Your session has expired. Please sign in again.', 401);
    }
    if (!response.ok) {
        throw new AdminApiError(await readError(response), response.status);
    }
    if (response.status === 204) return undefined as T;
    return (await response.json()) as T;
}

// --- Auth -------------------------------------------------------------------------

export async function adminLogin(email: string, password: string) {
    return adminFetch<{ user: AdminUser; csrf_token: string; must_change_password: boolean }>(
        '/auth/login',
        { method: 'POST', body: JSON.stringify({ email, password }) },
    );
}

export async function adminLogout(csrfToken: string): Promise<void> {
    await adminFetch<{ signed_out: boolean }>('/auth/logout', { method: 'POST', csrfToken });
}

export async function adminMe() {
    return adminFetch<{ user: AdminUser; csrf_token: string | null; signed_in: boolean }>('/auth/me');
}

// --- Orders ----------------------------------------------------------------------

export type OrderFilters = {
    status?: string;
    search?: string;
    fulfilment?: string;
    page?: number;
};

export async function fetchAdminOrders(filters: OrderFilters = {}): Promise<AdminOrderListResponse> {
    const params = new URLSearchParams();
    if (filters.status) params.set('status', filters.status);
    if (filters.search) params.set('search', filters.search);
    if (filters.fulfilment) params.set('fulfilment', filters.fulfilment);
    params.set('page', String(filters.page ?? 1));
    const query = params.toString();
    return adminFetch<AdminOrderListResponse>(`/orders?${query}`);
}

export async function fetchAdminOrder(id: string): Promise<AdminOrderDetail> {
    return adminFetch<AdminOrderDetail>(`/orders/${encodeURIComponent(id)}`);
}

/** Human labels so a status is never communicated by colour alone (SPEC §9). */
export const STATUS_LABELS: Record<string, string> = {
    pending: 'Pending',
    quoted: 'Quoted',
    confirmed: 'Confirmed',
    ready: 'Ready for pickup/delivery',
    completed: 'Completed',
    cancelled: 'Cancelled',
    declined: 'Declined',
    expired: 'Expired',
};

export function statusLabel(status: string): string {
    return STATUS_LABELS[status] ?? status;
}
