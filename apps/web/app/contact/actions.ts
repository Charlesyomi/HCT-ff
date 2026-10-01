'use server';

import { z } from 'zod';

const contactSchema = z.object({
    name: z.string().trim().min(2, 'Enter your name.').max(80, 'Name must be 80 characters or fewer.'),
    phone: z.string().trim().min(8, 'Enter a phone number.').max(32, 'Phone number is too long.'),
    message: z.string().trim().min(5, 'Write at least 5 characters.').max(2000, 'Message must be 2000 characters or fewer.'),
});

export type ContactFormState = {
    status: 'idle' | 'sent' | 'error';
    message: string;
};

export async function submitContactForm(
    _previousState: ContactFormState,
    formData: FormData,
): Promise<ContactFormState> {
    const parsed = contactSchema.safeParse({
        name: formData.get('name'),
        phone: formData.get('phone'),
        message: formData.get('message'),
    });

    if (!parsed.success) {
        return {
            status: 'error',
            message: parsed.error.issues[0]?.message ?? 'Check your details and try again.',
        };
    }

    const apiUrl = (process.env.API_URL ?? process.env.NEXT_PUBLIC_API_URL ?? 'http://127.0.0.1:8000')
        .replace(/\/$/, '');

    try {
        const response = await fetch(`${apiUrl}/api/v1/contact`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                ...parsed.data,
                website: formData.get('website') ?? '',
                turnstile_token: formData.get('turnstile_token') ?? '',
            }),
            cache: 'no-store',
        });
        if (!response.ok) {
            return { status: 'error', message: 'We could not send your message. Please try again or contact us on WhatsApp.' };
        }
        return { status: 'sent', message: 'Your message has been sent. The farm will get back to you soon.' };
    } catch {
        return { status: 'error', message: 'We could not reach the farm right now. Please try again or contact us on WhatsApp.' };
    }
}
