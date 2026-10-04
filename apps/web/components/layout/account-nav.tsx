'use client';

import Link from 'next/link';
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
            <Link href="/api/v1/auth/google/start?next=%2Fmy-orders" className="text-sm font-semibold text-ink transition hover:text-[color:var(--brand-700)]">
                Sign in
            </Link>
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