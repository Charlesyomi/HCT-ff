'use client';

import { useEffect } from 'react';
import { useCartStore } from '@/lib/cart-store';

export const POLL_INTERVAL_MS = 5_000;

/**
 * Keeps the cart in step with the server while the tab is being used.
 *
 * Concurrency race: a signed-in shopper can edit the cart on their phone while the web tab is
 * open, so the tab would show stale lines. Prevention: poll every 5s and refetch on focus,
 * both gated on `document.visibilityState` so a backgrounded tab stops making requests.
 */
export function CartProvider({ children }: { children: React.ReactNode }) {
    const hydrate = useCartStore((state) => state.hydrate);
    const refresh = useCartStore((state) => state.refresh);
    const signedIn = useCartStore((state) => state.signedIn);

    useEffect(() => {
        void hydrate();
    }, [hydrate]);

    useEffect(() => {
        if (!signedIn || typeof document === 'undefined') return;

        let timer: number | null = null;
        const isVisible = () => document.visibilityState === 'visible';

        const stop = () => {
            if (timer !== null) {
                window.clearInterval(timer);
                timer = null;
            }
        };

        const start = () => {
            stop();
            if (isVisible()) {
                timer = window.setInterval(() => {
                    if (isVisible()) void refresh();
                }, POLL_INTERVAL_MS);
            }
        };

        const onVisibilityChange = () => {
            if (isVisible()) {
                void refresh();
                start();
            } else {
                stop();
            }
        };

        const onFocus = () => {
            if (isVisible()) void refresh();
        };

        start();
        document.addEventListener('visibilitychange', onVisibilityChange);
        window.addEventListener('focus', onFocus);
        return () => {
            stop();
            document.removeEventListener('visibilitychange', onVisibilityChange);
            window.removeEventListener('focus', onFocus);
        };
    }, [refresh, signedIn]);

    return <>{children}</>;
}