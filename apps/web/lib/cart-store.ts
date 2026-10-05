import { create } from 'zustand';
import {
    CartError,
    EMPTY_CART,
    MAX_CART_LINES,
    type Cart,
    type CartLine,
    type CartLineInput,
    deleteRemoteCart,
    fetchCart,
    isSignedIn,
    putCart,
} from './cart-api';

const GUEST_STORAGE_KEY = 'adesoba-cart';

export type CartStatus = 'idle' | 'loading' | 'saving' | 'synced' | 'error';

type CartState = {
    lines: CartLine[];
    version: number;
    indicativeTotalKobo: number | null;
    signedIn: boolean;
    hydrated: boolean;
    status: CartStatus;
    error: string | null;
    /** The lines we last tried to persist, so a failed save can be retried verbatim. */
    pendingRetry: CartLineInput[] | null;
    setLines: (lines: CartLine[], version: number, indicativeTotalKobo: number | null) => void;
    hydrate: () => Promise<void>;
    refresh: () => Promise<void>;
    addLine: (input: CartLineInput) => Promise<void>;
    setQuantity: (fishType: string, size: string, quantityKg: number) => Promise<void>;
    removeLine: (fishType: string, size: string) => Promise<void>;
    clear: () => Promise<void>;
    retrySave: () => Promise<void>;
};

export function lineKey(fishType: string, size: string): string {
    return `${fishType}:${size}`;
}

/** Duplicate lines are merged by summing kilograms, matching what the API does. */
export function mergeLines(lines: CartLineInput[]): CartLineInput[] {
    const merged = new Map<string, CartLineInput>();
    for (const line of lines) {
        const key = lineKey(line.fish_type, line.size);
        const existing = merged.get(key);
        merged.set(key, {
            ...line,
            quantity_kg: (existing?.quantity_kg ?? 0) + line.quantity_kg,
        });
    }
    return [...Array.from(merged.values())];
}

export function readGuestLines(): CartLineInput[] {
    if (typeof window === 'undefined') return [];
    try {
        const raw = window.localStorage.getItem(GUEST_STORAGE_KEY);
        const parsed: unknown = raw ? JSON.parse(raw) : [];
        if (!Array.isArray(parsed)) return [];
        return parsed
            .filter(
                (item): item is CartLineInput =>
                    typeof item === 'object' &&
                    item !== null &&
                    typeof (item as CartLineInput).size === 'string' &&
                    typeof (item as CartLineInput).quantity_kg === 'number',
            )
            .map((item) => ({
                fish_type: item.fish_type ?? 'any',
                size: item.size,
                quantity_kg: item.quantity_kg,
            }));
    } catch {
        return [];
    }
}

export function writeGuestLines(lines: CartLineInput[]): void {
    if (typeof window === 'undefined') return;
    try {
        if (lines.length === 0) window.localStorage.removeItem(GUEST_STORAGE_KEY);
        else window.localStorage.setItem(GUEST_STORAGE_KEY, JSON.stringify(lines));
    } catch {
        // A full or blocked localStorage must not break shopping.
    }
}

export function clearGuestLines(): void {
    if (typeof window === 'undefined') return;
    try {
        window.localStorage.removeItem(GUEST_STORAGE_KEY);
    } catch {
        // ignore
    }
}

/** The plain (fish, size, kg) shape the API accepts, dropping any price fields. */
export function toLineInputs(lines: CartLine[]): CartLineInput[] {
    return lines.map((line) => ({
        fish_type: line.fish_type as CartLineInput['fish_type'],
        size: line.size,
        quantity_kg: line.quantity_kg,
    }));
}

export function totalQuantityKg(lines: CartLine[]): number {
    return lines.reduce((sum, line) => sum + line.quantity_kg, 0);
}

export const useCartStore = create<CartState>()((set, get) => {
    /** Apply a server cart to the store (the source of truth once signed in). */
    const applyServerCart = (cart: Cart) => {
        set({
            lines: cart.items,
            version: cart.version,
            indicativeTotalKobo: cart.indicative_total_kobo ?? null,
            status: 'synced',
            error: null,
            pendingRetry: null,
        });
    };

    /**
     * Persist the wanted lines, handling the optimistic version the API enforces.
     *
     * Concurrency race: another tab (or the phone app) can bump the cart version between our
     * read and our write, so the API answers 409. Prevention: refetch the server cart and
     * re-apply the user's change on top of the newer version instead of dropping it.
     */
    const persist = async (wanted: CartLineInput[], isRetry = false): Promise<void> => {
        const { signedIn, version } = get();
        if (wanted.length === 0) {
            writeGuestLines([]);
            if (!signedIn) {
                set({ lines: [], version: 0, indicativeTotalKobo: null, status: 'synced', error: null, pendingRetry: null });
                return;
            }
            try {
                await deleteRemoteCart();
                set({
                    lines: [],
                    version: 0,
                    indicativeTotalKobo: null,
                    signedIn,
                    hydrated: true,
                    status: 'synced',
                    error: null,
                    pendingRetry: null,
                });
            } catch (error) {
                set({ status: 'error', error: (error as Error).message, pendingRetry: null });
            }
            return;
        }

        if (!signedIn) {
            writeGuestLines(wanted);
            // Guests see their lines immediately; the server prices them once they sign in.
            set({
                lines: wanted.map((line) => ({
                    ...line,
                    size_label: line.size,
                    indicative_unit_price_kobo: null,
                    line_total_kobo: null,
                })),
                version: 0,
                indicativeTotalKobo: null,
                status: 'synced',
                error: null,
                pendingRetry: null,
            });
            return;
        }

        set({ status: 'saving', error: null });
        try {
            applyServerCart(await putCart(wanted, version));
            writeGuestLines([]);
        } catch (error) {
            if (error instanceof CartError && error.isConflict) {
                try {
                    const fresh = await fetchCart();
                    applyServerCart(await putCart(wanted, fresh.version));
                    writeGuestLines([]);
                    return;
                } catch (retryError) {
                    set({
                        status: 'error',
                        error: (retryError as Error).message,
                        pendingRetry: isRetry ? null : wanted,
                    });
                    return;
                }
            }
            set({
                status: 'error',
                error: (error as Error).message,
                pendingRetry: isRetry ? null : wanted,
            });
        }
    };

    const applyChange = async (next: CartLineInput[]): Promise<void> => {
        if (next.length > MAX_CART_LINES) {
            set({
                status: 'error',
                error: `A cart can hold at most ${MAX_CART_LINES} different sizes.`,
            });
            return;
        }
        await persist(next);
    };

    return {
        lines: [],
        version: 0,
        indicativeTotalKobo: null,
        signedIn: false,
        hydrated: false,
        status: 'idle',
        error: null,
        pendingRetry: null,

        setLines: (lines, version, indicativeTotalKobo) =>
            set({ lines, version, indicativeTotalKobo, status: 'synced' }),

        hydrate: async () => {
            const guest = readGuestLines();
            const signedIn = await isSignedIn();
            if (!signedIn) {
                set({ signedIn: false, hydrated: true, status: 'synced' });
                // The same path builds guest lines, so there is only one cart shape.
                await applyChange(mergeLines(guest));
                return;
            }
            // Signing in merges the guest cart into the server cart exactly once.
            const server = await fetchCart().catch(() => EMPTY_CART);
            // The merge write must start from the server's version, not the guest default of 0.
            set({ signedIn: true, hydrated: true, version: server.version });
            if (guest.length > 0) {
                await persist(mergeLines([...toLineInputs(server.items), ...guest]));
                clearGuestLines();
            } else {
                applyServerCart(server);
            }
        },

        refresh: async () => {
            if (!get().signedIn) return;
            const cart = await fetchCart().catch(() => null);
            if (cart === null) return;
            set({
                lines: cart.items,
                version: cart.version,
                indicativeTotalKobo: cart.indicative_total_kobo ?? null,
            });
        },

        addLine: async (input) => {
            await applyChange(mergeLines([...toLineInputs(get().lines), input]));
        },

        setQuantity: async (fishType, size, quantityKg) => {
            const next = toLineInputs(get().lines)
                .map((line) =>
                    lineKey(line.fish_type, line.size) === lineKey(fishType, size)
                        ? { ...line, quantity_kg: quantityKg }
                        : line,
                )
                .filter((line) => line.quantity_kg > 0);
            await applyChange(mergeLines(next));
        },

        removeLine: async (fishType, size) => {
            await applyChange(
                toLineInputs(get().lines).filter(
                    (line) => lineKey(line.fish_type, line.size) !== lineKey(fishType, size),
                ),
            );
        },

        clear: async () => {
            await applyChange([]);
        },

        retrySave: async () => {
            const wanted = get().pendingRetry;
            if (!wanted) {
                set({ status: 'synced', error: null });
                return;
            }
            await persist(wanted, true);
        },
    };
});