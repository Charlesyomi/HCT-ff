'use client';

import { useActionState } from 'react';
import { submitContactForm, type ContactFormState } from '@/app/contact/actions';

const initialContactFormState: ContactFormState = {
    status: 'idle',
    message: '',
};

export function ContactForm() {
    const [state, formAction, isPending] = useActionState(submitContactForm, initialContactFormState);

    return (
        <form action={formAction} className="border-y border-line-soft py-6">
            <div className="grid gap-5">
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
