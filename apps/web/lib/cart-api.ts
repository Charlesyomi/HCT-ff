import { z } from 'zod';

/**
 * Cart client for `/api/v1/me/cart`.
 *
 * Two shapes matter here: a *line input* is what the client may send (fish, size, kilos),
 * and a *cart line* is what the farm returns, always with the size label and the indicative
 * price snapshot the server computed. The client never sends a price.
 */

export const cartLineInputSchema = z.object({
    fish_type: z.enum(['clarias', 'hybrid', 'any']),
    size: z.string().min(1),
    quantity_kg: z.number().int().positive(),
});

export type CartLineInput = z.infer<typeof cartLineInputSchema>;

export const cartLineSchema = z.object({
    fish_type: z.string(),
    size: z.string(),
    size_label: z.string(),
    quantity_kg: z.number().int(),
    indicative_unit_price_kobo: z.number().int().nullable().optional(),
    line_total_kobo: z.number().int().nullable().optional(),
});

export type CartLine = z.infer<typeof cartLineSchema>;

export const cartSchema = z.object({
    items: z.array(cartLineSchema).default([]),
    version: z.number().int(),
    updated_at: z.string().nullable().optional(),
    indicative_total_kobo: z.number().int().nullable().optional(),
});

export type Cart = z.infer<typeof cartSchema>;

/** A cart nobody has touched yet: version 0, no lines (what GET returns for a new account). */
export const EMPTY_CART: Cart = {
    items: [],
    version: 0,
    updated_at: null,
    indicative_total_kobo: null,
};

export const MAX_CART_LINES = 10;

export class CartError extends Error {
    constructor(
        message: string,
        readonly status: number,
    ) {
        super(message);
        this.name = 'CartError';
    }

    get isConflict(): boolean {
        return this.status === 409;
    }

    get isUnauthenticated(): boolean {
        return this.status === 401;
    }
}

const errorEnvelopeSchema = z.object({ error: z.object({ message: z.string() }) });

function messageFrom(body: unknown, fallback: string): string {
    const parsed = errorEnvelopeSchema.safeParse(body);
    return parsed.success ? parsed.data.error.message : fallback;
}

/**
 * The CSRF token is derived from the session cookie and the API hands it out on
 * `/api/v1/me/orders`. It is cached because it only changes when the session changes.
 */
let csrfToken: string | null = null;

export function resetCartApiCache(): void {
    csrfToken = null;
}

async function csrfHeaders(): Promise<Record<string, string>> {
    if (csrfToken === null) {
        const response = await fetch('/api/v1/me/orders', { cache: 'no-store' });
        const body: unknown = response.ok ? await response.json().catch(() => null) : null;
        const parsed = z.object({ csrf_token: z.string().nullable() }).safeParse(body);
        csrfToken = parsed.success ? parsed.data.csrf_token : '';
    }
    // An empty token means "not available"; the request still goes out and the API decides.
    return csrfToken ? { 'X-CSRF-Token': csrfToken } : {};
}

async function parseCart(body: unknown): Promise<Cart> {
    const parsed = cartSchema.safeParse(body);
    if (!parsed.success) throw new CartError('The farm returned an unexpected cart.', 500);
    return parsed.data;
}

export async function isSignedIn(): Promise<boolean> {
    try {
        const response = await fetch('/api/v1/auth/me', { cache: 'no-store' });
        return response.ok;
    } catch {
        return false;
    }
}

export async function fetchCart(): Promise<Cart> {
    const response = await fetch('/api/v1/me/cart', { cache: 'no-store' });
    if (response.status === 401) return EMPTY_CART;
    if (!response.ok) throw new CartError('We could not load your cart.', response.status);
    return parseCart(await response.json().catch(() => null));
}

export async function putCart(items: CartLineInput[], expectedVersion: number): Promise<Cart> {
    const response = await fetch('/api/v1/me/cart', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json', ...(await csrfHeaders()) },
        body: JSON.stringify({ items, expected_version: expectedVersion }),
        cache: 'no-store',
    });
    const body: unknown = await response.json().catch(() => null);
    if (!response.ok) {
        // A rejected token must not be cached; the next attempt fetches a fresh one.
        if (response.status === 403) csrfToken = null;
        throw new CartError(messageFrom(body, 'We could not save your cart.'), response.status);
    }
    return parseCart(body);
}

export async function deleteRemoteCart(): Promise<void> {
    const response = await fetch('/api/v1/me/cart', {
        method: 'DELETE',
        headers: await csrfHeaders(),
        cache: 'no-store',
    });
    if (!response.ok && response.status !== 404) {
        throw new CartError('We could not clear your cart.', response.status);
    }
}