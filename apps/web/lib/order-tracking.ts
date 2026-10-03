import { z } from 'zod';

const orderEventSchema = z.object({
    type: z.string(),
    from_status: z.string().nullable().optional(),
    to_status: z.string(),
    note: z.string().nullable().optional(),
    created_at: z.string(),
});

const quoteSchema = z.object({
    version_no: z.number().int(),
    unit_price_kobo: z.number().int(),
    quantity_kg: z.number().int(),
    delivery_fee_kobo: z.number().int(),
    discount_kobo: z.number().int(),
    total_kobo: z.number().int(),
    deposit_kobo: z.number().int(),
    valid_until: z.string(),
    message_to_customer: z.string().nullable().optional(),
    status: z.string(),
    is_expired: z.boolean(),
});

export type OrderQuote = z.infer<typeof quoteSchema>;

const orderSchema = z.object({
    reference: z.string(),
    status: z.string(),
    fish_type: z.string(),
    size_label: z.string(),
    quantity_kg: z.number().int(),
    is_bulk: z.boolean(),
    preferred_date: z.string(),
    time_slot_label: z.string(),
    fulfilment: z.string(),
    delivery_address: z.string().nullable(),
    delivery_landmark: z.string().nullable(),
    notes: z.string().nullable(),
    customer_name: z.string(),
    customer_phone_masked: z.string(),
    customer_email: z.string().nullable(),
    submitted_at: z.string(),
    events: z.array(orderEventSchema).default([]),
    quote: quoteSchema.nullable().optional(),
});

const lookupResponseSchema = z.object({
    order: orderSchema,
    access_token: z.string().min(1),
});

const accountOrdersSchema = z.object({
    orders: z.array(
        z.object({
            reference: z.string(),
            status: z.string(),
            fish_type: z.string(),
            size_label: z.string(),
            quantity_kg: z.number().int(),
            is_bulk: z.boolean(),
            preferred_date: z.string(),
            time_slot_label: z.string(),
            fulfilment: z.string(),
            submitted_at: z.string(),
            quote: quoteSchema.nullable().optional(),
        }),
    ),
    csrf_token: z.string().nullable().optional(),
});

export type TrackedOrder = z.infer<typeof orderSchema>;
export type AccountOrder = z.infer<typeof accountOrdersSchema>['orders'][number];

export const CLOSED_STATUSES = ['completed', 'cancelled', 'declined', 'expired'] as const;

const STORAGE_KEY = 'adesoba-tracked-orders';

export function isActiveStatus(status: string): boolean {
    return !CLOSED_STATUSES.includes(status as (typeof CLOSED_STATUSES)[number]);
}

/** Device tokens for orders this browser has verified (reference + phone). */
export function readTrackedReferences(): string[] {
    if (typeof window === 'undefined') return [];
    try {
        const raw = window.localStorage.getItem(STORAGE_KEY);
        const parsed: unknown = raw ? JSON.parse(raw) : [];
        return Array.isArray(parsed) ? parsed.filter((item): item is string => typeof item === 'string') : [];
    } catch {
        return [];
    }
}

export function rememberTrackedOrder(reference: string, token: string): void {
    if (typeof window === 'undefined') return;
    const existing = readTrackedReferences();
    if (!existing.includes(reference)) {
        window.localStorage.setItem(STORAGE_KEY, JSON.stringify([...existing, reference]));
    }
    window.localStorage.setItem(`${STORAGE_KEY}:${reference}`, token);
}

export function forgetTrackedOrder(reference: string): void {
    if (typeof window === 'undefined') return;
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(readTrackedReferences().filter((item) => item !== reference)));
    window.localStorage.removeItem(`${STORAGE_KEY}:${reference}`);
}

export function readTrackedToken(reference: string): string | null {
    if (typeof window === 'undefined') return null;
    return window.localStorage.getItem(`${STORAGE_KEY}:${reference}`);
}

export async function lookupOrder(reference: string, phone: string): Promise<TrackedOrder> {
    const response = await fetch('/api/v1/orders/lookup', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ reference, phone }),
        cache: 'no-store',
    });
    const body: unknown = await response.json().catch(() => null);
    if (!response.ok) {
        const message = z.object({ error: z.object({ message: z.string() }) }).safeParse(body);
        throw new Error(message.success ? message.data.error.message : 'We could not find that order.');
    }
    const parsed = lookupResponseSchema.safeParse(body);
    if (!parsed.success) throw new Error('The farm returned an unexpected response.');
    rememberTrackedOrder(parsed.data.order.reference, parsed.data.access_token);
    return parsed.data.order;
}

export async function fetchTrackedOrder(reference: string, token: string): Promise<TrackedOrder> {
    const response = await fetch(`/api/v1/orders/${encodeURIComponent(reference)}`, {
        headers: { 'X-Order-Token': token },
        cache: 'no-store',
    });
    const body: unknown = await response.json().catch(() => null);
    if (!response.ok) {
        const message = z.object({ error: z.object({ message: z.string() }) }).safeParse(body);
        throw new Error(message.success ? message.data.error.message : 'We could not load that order.');
    }
    const parsed = orderSchema.safeParse(body);
    if (!parsed.success) throw new Error('The farm returned an unexpected response.');
    return parsed.data;
}

export async function fetchAccountOrders(): Promise<{ orders: AccountOrder[]; csrfToken: string | null }> {
    const response = await fetch('/api/v1/me/orders', { cache: 'no-store' });
    if (!response.ok) return { orders: [], csrfToken: null };
    const body: unknown = await response.json().catch(() => null);
    const parsed = accountOrdersSchema.safeParse(body);
    if (!parsed.success) return { orders: [], csrfToken: null };
    return { orders: parsed.data.orders, csrfToken: parsed.data.csrf_token ?? null };
}

export async function cancelTrackedOrder(reference: string, token: string): Promise<string> {
    const response = await fetch(`/api/v1/orders/${encodeURIComponent(reference)}/cancel`, {
        method: 'POST',
        headers: { 'X-Order-Token': token },
        cache: 'no-store',
    });
    const body: unknown = await response.json().catch(() => null);
    if (!response.ok) {
        const message = z.object({ error: z.object({ message: z.string() }) }).safeParse(body);
        throw new Error(message.success ? message.data.error.message : 'We could not cancel that order.');
    }
    const parsed = z.object({ status: z.string() }).safeParse(body);
    return parsed.success ? parsed.data.status : 'cancelled';
}
