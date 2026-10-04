'use client';

import { useCallback, useEffect, useState } from 'react';

export type SignedInAccount = { email: string; name: string | null } | null;

type Props = {
    next: string;
    account: SignedInAccount;
    onAccountChange: (account: SignedInAccount) => void;
    onPhoneCheckout?: () => void;
    /** When false the phone form is already visible, so the two options collapse. */
    showPhoneOption?: boolean;
};

const googleEnabled = process.env.NEXT_PUBLIC_GOOGLE_SIGN_IN_ENABLED === 'true';

/**
 * Addendum §A4: two equal options at the top of checkout. Sign-in is optional and never
 * blocks the order; the phone path stays available when Google is unavailable.
 */
export function SignInChoice({ next, account, onAccountChange, onPhoneCheckout, showPhoneOption = true }: Props) {
    const [starting, setStarting] = useState(false);

    const refreshAccount = useCallback(async () => {
        try {
            const response = await fetch('/api/v1/auth/me', { cache: 'no-store' });
            if (!response.ok) {
                onAccountChange(null);
                return;
            }
            const body = (await response.json()) as { email: string; name: string | null };
            onAccountChange({ email: body.email, name: body.name ?? null });
        } catch {
            onAccountChange(null);
        }
    }, [onAccountChange]);

    useEffect(() => {
        void refreshAccount();
    }, [refreshAccount]);

    function startGoogleSignIn() {
        setStarting(true);
        // Same-origin path: Next rewrites /api/v1/* to the API, where the flow starts.
        window.location.assign(`/api/v1/auth/google/start?next=${encodeURIComponent(next)}`);
    }

    async function signOut() {
        await fetch('/api/v1/auth/logout', { method: 'POST' }).catch(() => null);
        onAccountChange(null);
    }

    if (account) {
        return (
            <div className="flex flex-wrap items-center justify-between gap-3 border border-line-soft px-4 py-3">
                <p className="text-sm text-ink">
                    Signed in as <strong>{account.name ?? account.email}</strong>
                </p>
                <button type="button" onClick={() => void signOut()} className="text-sm font-semibold underline underline-offset-2">
                    Sign out
                </button>
            </div>
        );
    }

    return (
        <div className="grid gap-3 sm:grid-cols-2" aria-label="Sign in options">
            <button
                type="button"
                onClick={startGoogleSignIn}
                disabled={!googleEnabled || starting}
                className="inline-flex min-h-12 items-center justify-center gap-2 rounded-full border border-line-strong px-5 font-semibold text-ink disabled:opacity-50"
            >
                {starting ? 'Opening Google…' : 'Continue with Google'}
            </button>
            {showPhoneOption ? (
                <button type="button" onClick={onPhoneCheckout} className="inline-flex min-h-12 items-center justify-center rounded-full border border-line-strong px-5 font-semibold text-ink">
                    Continue with phone number
                </button>
            ) : null}
            {!googleEnabled ? (
                <p className="text-xs text-ink-muted sm:col-span-2">
                    Google sign-in is switched off in this environment; phone number checkout works exactly the same.
                </p>
            ) : null}
        </div>
    );
}
