'use client';

import { useEffect, useState } from 'react';

const googleSignInEnabled = process.env.NEXT_PUBLIC_GOOGLE_SIGN_IN_ENABLED === 'true';

export function AccountNav() {
    const [signedIn, setSignedIn] = useState(false);

    useEffect(() => {
        if (!googleSignInEnabled) return;
        const controller = new AbortController();
        const timeout = window.setTimeout(() => controller.abort(), 5_000);
        void fetch('/api/v1/auth/me', { cache: 'no-store', signal: controller.signal })
            .then((response) => setSignedIn(response.ok))
            .catch(() => setSignedIn(false))
            .finally(() => window.clearTimeout(timeout));
        return () => {
            window.clearTimeout(timeout);
            controller.abort();
        };
    }, []);

    if (!googleSignInEnabled) return null;

    if (!signedIn) {
        return (
            // A plain anchor, not a Next Link: Link prefetches as an RSC request, which would
            // follow the redirect to accounts.google.com and fail CORS, and would also mint a
            // fresh sign-in state cookie on every prefetch.
            <a href="/api/v1/auth/google/start?next=%2Fmy-orders" className="text-sm font-semibold text-ink transition hover:text-[color:var(--brand-700)]">
                Sign in
            </a>
        );
    }

    async function signOut() {
        await fetch('/api/v1/auth/logout', { method: 'POST', cache: 'no-store' }).catch(() => null);
        setSignedIn(false);
    }

    return (
        <button type="button" onClick={() => void signOut()} className="text-sm font-semibold text-ink transition hover:text-[color:var(--brand-700)]">
            Sign out
        </button>
    );
}