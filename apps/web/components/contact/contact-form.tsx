'use client';

import { useActionState, useCallback, useEffect, useRef, useState } from 'react';
import { submitContactForm, type ContactFormState } from '@/app/contact/actions';

const initialContactFormState: ContactFormState = {
    status: 'idle',
    message: '',
};

const turnstileSiteKey = process.env.NEXT_PUBLIC_TURNSTILE_SITE_KEY ?? '';

export function ContactForm() {
    const [state, formAction, isPending] = useActionState(submitContactForm, initialContactFormState);
    const [honeypot, setHoneypot] = useState('');
    const [turnstileToken, setTurnstileToken] = useState('');
    const widgetRef = useRef<HTMLDivElement | null>(null);

    const handleToken = useCallback((token: string) => setTurnstileToken(token), []);

    useEffect(() => {
        if (!turnstileSiteKey || !widgetRef.current) return;
        const render = () => {
            const turnstile = (window as unknown as {
                turnstile?: { render: (element: HTMLElement, options: Record<string, unknown>) => string };
            }).turnstile;
            if (turnstile && widgetRef.current) {
                turnstile.render(widgetRef.current, {
                    sitekey: turnstileSiteKey,
                    callback: handleToken,
                    appearance: 'execution-only',
                });
            }
        };
        if ((window as unknown as { turnstile?: unknown }).turnstile) {
            render();
        } else {
            const script = document.createElement('script');
            script.src = 'https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit';
            script.async = true;
            script.defer = true;
            script.onload = render;
            document.head.appendChild(script);
        }
    }, [handleToken]);

    return (
        <form action={formAction} className="border-y border-line-soft py-6">
            <div className="grid gap-5">
                {/* Spam protection (SPEC §6.12): hidden honeypot plus a Turnstile token. */}
                <div aria-hidden="true" className="absolute left-[-9999px] top-[-9999px] h-0 w-0 overflow-hidden">
                    <label htmlFor="contact-website">Website</label>
                    <input
                        id="contact-website"
                        name="website"
                        type="text"
                        tabIndex={-1}
                        autoComplete="off"
                        value={honeypot}
                        onChange={(event) => setHoneypot(event.target.value)}
                    />
                </div>
                <input type="hidden" name="turnstile_token" value={turnstileToken} />
                {turnstileSiteKey ? <div ref={widgetRef} aria-hidden="true" className="hidden" /> : null}
                <label className="grid gap-2 text-sm font-semibold text-ink">
                    Name
                    <input
                        autoComplete="name"
                        name="name"
                        required
                        maxLength={80}
                        className="min-h-12 rounded-lg border border-line-strong bg-canvas px-4 outline-none focus-visible:border-[color:var(--brand-700)] focus-visible:ring-2 focus-visible:ring-[color:var(--brand-100)]"
                        placeholder="Your name"
                    />
                </label>
                <label className="grid gap-2 text-sm font-semibold text-ink">
                    Phone
                    <input
                        autoComplete="tel"
                        inputMode="tel"
                        name="phone"
                        required
                        maxLength={32}
                        className="min-h-12 rounded-lg border border-line-strong bg-canvas px-4 outline-none focus-visible:border-[color:var(--brand-700)] focus-visible:ring-2 focus-visible:ring-[color:var(--brand-100)]"
                        placeholder="0801 234 5678"
                    />
                </label>
                <label className="grid gap-2 text-sm font-semibold text-ink">
                    Message
                    <textarea
                        autoComplete="off"
                        name="message"
                        required
                        minLength={5}
                        maxLength={2000}
                        rows={5}
                        className="rounded-lg border border-line-strong bg-canvas px-4 py-3 outline-none focus-visible:border-[color:var(--brand-700)] focus-visible:ring-2 focus-visible:ring-[color:var(--brand-100)]"
                        placeholder="Tell us what you need"
                    />
                </label>
                <button
                    type="submit"
                    disabled={isPending}
                    className="inline-flex min-h-12 w-fit items-center justify-center rounded-full bg-[color:var(--brand-700)] px-6 font-semibold text-white transition hover:bg-[color:var(--brand-900)] disabled:cursor-wait disabled:opacity-70"
                >
                    {isPending ? 'Sending…' : 'Send message'}
                </button>
                <p aria-live="polite" role={state.status === 'error' ? 'alert' : 'status'} className={`min-h-6 text-sm ${state.status === 'error' ? 'text-status-error' : state.status === 'sent' ? 'text-[color:var(--brand-700)]' : 'text-ink-muted'}`}>
                    {state.message}
                </p>
            </div>
        </form>
    );
}
