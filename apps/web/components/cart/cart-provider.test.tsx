// @vitest-environment jsdom

import { act, cleanup, render } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useCartStore } from '@/lib/cart-store';
import { CartProvider, POLL_INTERVAL_MS } from './cart-provider';

const refresh = vi.fn();

function setVisibility(state: DocumentVisibilityState) {
    Object.defineProperty(document, 'visibilityState', {
        configurable: true,
        get: () => state,
    });
}

beforeEach(() => {
    vi.useFakeTimers();
    refresh.mockReset();
    useCartStore.setState({
        lines: [],
        version: 1,
        indicativeTotalKobo: null,
        signedIn: true,
        hydrated: true,
        status: 'synced',
        error: null,
        pendingRetry: null,
        refresh,
    });
    setVisibility('visible');
});

afterEach(() => {
    // Each test starts with no provider mounted, so no interval leaks into the next one.
    cleanup();
    vi.useRealTimers();
});

describe('CartProvider polling', () => {
    it('polls the server cart every 5 seconds while the tab is visible', () => {
        render(
            <CartProvider>
                <span>child</span>
            </CartProvider>,
        );

        expect(refresh).not.toHaveBeenCalled();
        act(() => {
            vi.advanceTimersByTime(POLL_INTERVAL_MS);
        });
        expect(refresh).toHaveBeenCalledTimes(1);
        act(() => {
            vi.advanceTimersByTime(POLL_INTERVAL_MS * 2);
        });
        expect(refresh).toHaveBeenCalledTimes(3);
    });

    it('stops polling once the tab is hidden and resumes when it is shown again', () => {
        render(
            <CartProvider>
                <span>child</span>
            </CartProvider>,
        );

        act(() => {
            setVisibility('hidden');
            document.dispatchEvent(new Event('visibilitychange'));
        });
        act(() => {
            vi.advanceTimersByTime(POLL_INTERVAL_MS * 3);
        });
        // A hidden tab makes no requests at all.
        expect(refresh).not.toHaveBeenCalled();

        act(() => {
            setVisibility('visible');
            document.dispatchEvent(new Event('visibilitychange'));
        });
        // Coming back catches up once and resumes the interval.
        expect(refresh).toHaveBeenCalledTimes(1);
        act(() => {
            vi.advanceTimersByTime(POLL_INTERVAL_MS);
        });
        expect(refresh).toHaveBeenCalledTimes(2);
    });

    it('refetches when the window regains focus', () => {
        render(
            <CartProvider>
                <span>child</span>
            </CartProvider>,
        );

        expect(refresh).not.toHaveBeenCalled();
        act(() => {
            window.dispatchEvent(new Event('focus'));
        });

        expect(refresh).toHaveBeenCalledTimes(1);
    });

    it('does not poll for a guest cart', () => {
        useCartStore.setState({ signedIn: false, refresh });
        render(
            <CartProvider>
                <span>child</span>
            </CartProvider>,
        );

        act(() => {
            vi.advanceTimersByTime(POLL_INTERVAL_MS * 3);
        });

        expect(refresh).not.toHaveBeenCalled();
    });
});