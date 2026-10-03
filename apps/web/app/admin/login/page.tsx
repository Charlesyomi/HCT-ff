'use client';

import { useCallback, useState } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { adminLogin, type AdminUser } from '@/lib/admin-api';

/**
 * Admin sign-in (SPEC §9).
 *
 * The API answers every failure with the same generic message, so this screen must not
 * reveal whether an address exists. On success the CSRF token is kept in component state for
 * this session only; the session cookie itself is HttpOnly and never visible to JavaScript.
 */
export default function AdminLoginPage() {
    const router = useRouter();
    const [email, setEmail] = useState('');
    const [password, setPassword] = useState('');
    const [error, setError] = useState<string | null>(null);
    const [pending, setPending] = useState(false);

    const submit = useCallback(
        async (event: React.FormEvent<HTMLFormElement>) => {
            event.preventDefault();
            setPending(true);
            setError(null);
            try {
                const result = await adminLogin(email, password);
                if (result.must_change_password) {
                    router.push('/admin/change-password');
                    return;
                }
                sessionStorage.removeItem('adesoba_admin_must_change_password');
                router.push('/admin');
                router.refresh();
            } catch (caught) {
                setError(caught instanceof Error ? caught.message : 'Sign-in failed.');
            } finally {
                setPending(false);
            }
        },
        [email, password, router],
    );

    return (
        <main className="mx-auto flex min-h-screen max-w-md flex-col justify-center px-4 py-10">
            <h1 className="font-display text-3xl font-bold text-[color:var(--text)]">Farm admin</h1>
            <p className="mt-2 text-sm text-ink-muted">Sign in to manage customer orders.</p>

            <form className="mt-6 grid gap-4" onSubmit={submit} noValidate>
                <div>
                    <label htmlFor="admin-email" className="text-sm font-semibold text-ink">
                        Email
                    </label>
                    <input
                        id="admin-email"
                        type="email"
                        autoComplete="username"
                        required
                        value={email}
                        onChange={(event) => setEmail(event.target.value)}
                        className="mt-1 min-h-11 w-full rounded-lg border border-line-strong bg-canvas px-3 text-ink outline-none focus-visible:ring-2 focus-visible:ring-[color:var(--brand-100)]"
                    />
                </div>

                <div>
                    <label htmlFor="admin-password" className="text-sm font-semibold text-ink">
                        Password
                    </label>
                    <input
                        id="admin-password"
                        type="password"
                        autoComplete="current-password"
                        required
                        value={password}
                        onChange={(event) => setPassword(event.target.value)}
                        className="mt-1 min-h-11 w-full rounded-lg border border-line-strong bg-canvas px-3 text-ink outline-none focus-visible:ring-2 focus-visible:ring-[color:var(--brand-100)]"
                    />
                </div>

                {error ? (
                    <p role="alert" className="text-sm font-semibold text-[color:var(--brand-700)]">
                        {error}
                    </p>
                ) : null}

                <button
                    type="submit"
                    disabled={pending}
                    className="min-h-11 rounded-full bg-[color:var(--brand-700)] px-5 font-semibold text-white disabled:opacity-60"
                >
                    {pending ? 'Signing in…' : 'Sign in'}
                </button>
            </form>

            <p className="mt-6 text-xs text-ink-muted">
                <Link href="/" className="underline underline-offset-2">
                    Back to the site
                </Link>
            </p>
        </main>
    );
}

export type { AdminUser };
