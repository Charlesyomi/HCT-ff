'use client';

import { useCallback, useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { adminMe, changeAdminPassword } from '@/lib/admin-api';

/**
 * Forced password change (SPEC §9).
 *
 * A seeded owner, or any password an owner sets for a colleague, arrives here first. The
 * dashboard banner in the previous chunk pointed here once this screen existed.
 */
export default function AdminChangePasswordPage() {
    const router = useRouter();
    const [csrfToken, setCsrfToken] = useState<string | null>(null);
    const [currentPassword, setCurrentPassword] = useState('');
    const [newPassword, setNewPassword] = useState('');
    const [confirmPassword, setConfirmPassword] = useState('');
    const [error, setError] = useState<string | null>(null);
    const [pending, setPending] = useState(false);

    useEffect(() => {
        void (async () => {
            try {
                const me = await adminMe();
                if (!me.csrf_token) {
                    router.replace('/admin/login');
                    return;
                }
                setCsrfToken(me.csrf_token);
            } catch {
                router.replace('/admin/login');
            }
        })();
    }, [router]);

    const submit = useCallback(
        async (event: React.FormEvent<HTMLFormElement>) => {
            event.preventDefault();
            if (newPassword !== confirmPassword) {
                setError('The two new passwords do not match.');
                return;
            }
            setPending(true);
            setError(null);
            try {
                await changeAdminPassword(currentPassword, newPassword, csrfToken ?? '');
                sessionStorage.removeItem('adesoba_admin_must_change_password');
                router.push('/admin');
                router.refresh();
            } catch (caught) {
                setError(caught instanceof Error ? caught.message : 'Could not change the password.');
            } finally {
                setPending(false);
            }
        },
        [confirmPassword, csrfToken, currentPassword, newPassword, router],
    );

    return (
        <main className="mx-auto flex min-h-screen max-w-md flex-col justify-center px-4 py-10">
            <h1 className="font-display text-3xl font-bold text-[color:var(--text)]">Change your password</h1>
            <p className="mt-2 text-sm text-ink-muted">
                Set a password of at least 12 characters that you do not use anywhere else.
            </p>

            <form className="mt-6 grid gap-4" onSubmit={submit} noValidate>
                <div>
                    <label htmlFor="current-password" className="text-sm font-semibold text-ink">
                        Current password
                    </label>
                    <input
                        id="current-password"
                        type="password"
                        autoComplete="current-password"
                        required
                        value={currentPassword}
                        onChange={(event) => setCurrentPassword(event.target.value)}
                        className="mt-1 min-h-11 w-full rounded-lg border border-line-strong bg-canvas px-3 text-ink"
                    />
                </div>
                <div>
                    <label htmlFor="new-password" className="text-sm font-semibold text-ink">
                        New password
                    </label>
                    <input
                        id="new-password"
                        type="password"
                        autoComplete="new-password"
                        minLength={12}
                        required
                        value={newPassword}
                        onChange={(event) => setNewPassword(event.target.value)}
                        className="mt-1 min-h-11 w-full rounded-lg border border-line-strong bg-canvas px-3 text-ink"
                    />
                </div>
                <div>
                    <label htmlFor="confirm-password" className="text-sm font-semibold text-ink">
                        Confirm new password
                    </label>
                    <input
                        id="confirm-password"
                        type="password"
                        autoComplete="new-password"
                        minLength={12}
                        required
                        value={confirmPassword}
                        onChange={(event) => setConfirmPassword(event.target.value)}
                        className="mt-1 min-h-11 w-full rounded-lg border border-line-strong bg-canvas px-3 text-ink"
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
                    {pending ? 'Saving…' : 'Change password'}
                </button>
            </form>

            <p className="mt-6 text-xs text-ink-muted">
                <Link href="/admin" className="underline underline-offset-2">
                    Back to orders
                </Link>
            </p>
        </main>
    );
}
