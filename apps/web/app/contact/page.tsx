import type { Metadata } from 'next';
import Link from 'next/link';
import { SiteFooter } from '@/components/layout/site-footer';
import { SiteHeader } from '@/components/layout/site-header';
import { MobileBottomNav } from '@/components/layout/mobile-bottom-nav';
import { ContactForm } from '@/components/contact/contact-form';
import { LocalBusinessJsonLd } from '@/components/seo/local-business-json-ld';
import { getCatalog } from '@/lib/catalog-api';

export const metadata: Metadata = {
    title: 'Contact | Adesoba',
    description: 'Get in touch with Adesoba Catfish Farm by phone, WhatsApp or message.',
};

export const revalidate = 60;

export default async function ContactPage() {
    const catalog = await getCatalog();
    const settings = catalog?.settings;
    const phone = settings?.phone_number;
    const whatsappDigits = settings?.whatsapp_number.replace(/\D/g, '');
    const whatsappHref = whatsappDigits
        ? `https://wa.me/${whatsappDigits}?text=${encodeURIComponent('Hi Adesoba Farm, I have a question.')}`
        : null;

    return (
        <>
            <SiteHeader />
            {settings ? (
                <LocalBusinessJsonLd phone={settings.phone_number} address={settings.farm_address} hours={settings.business_hours} />
            ) : null}
            <main className="mx-auto max-w-5xl px-4 py-10 md:px-8 lg:px-12">
                <p className="text-xs font-semibold uppercase tracking-[0.2em] text-[color:var(--brand-700)]">Contact</p>
                <h1 className="mt-3 font-display text-4xl font-bold text-[color:var(--text)]">Speak with the farm</h1>
                <p className="mt-3 max-w-2xl leading-7 text-ink-muted">Ask about sizes, harvest availability, pickup, or delivery arrangements.</p>

                <div className="mt-8 grid gap-6 md:grid-cols-[1.2fr_0.8fr]">
                    <section aria-labelledby="contact-form-heading">
                        <h2 id="contact-form-heading" className="font-display text-2xl font-bold text-ink">Send a message</h2>
                        <ContactForm />
                    </section>

                    <aside className="border-l border-line-soft px-0 py-2 md:pl-6">
                        <h2 className="font-display text-2xl font-bold text-ink">Reach us</h2>
                        <ul className="mt-5 space-y-3 text-ink-muted">
                            {phone ? <li><strong>Phone:</strong> <a href={`tel:${phone.replace(/[^+\d]/g, '')}`} className="underline decoration-line-accent underline-offset-4">{phone}</a></li> : null}
                            {whatsappHref ? <li><strong>WhatsApp:</strong> <a href={whatsappHref} className="underline decoration-line-accent underline-offset-4">Chat with the farm</a></li> : null}
                            <li><strong>Address:</strong> {settings?.farm_address ?? 'Contact details are temporarily unavailable.'}</li>
                            {settings?.business_hours.map((hours) => <li key={hours}><strong>Hours:</strong> {hours}</li>)}
                        </ul>
                        {settings?.farm_maps_url ? (
                            <a href={settings.farm_maps_url} target="_blank" rel="noreferrer" className="mt-6 inline-flex min-h-11 items-center rounded-full border border-[color:var(--brand-700)] px-5 font-semibold text-[color:var(--brand-700)]">
                                View map
                            </a>
                        ) : null}
                        <p className="mt-7 text-sm text-ink-muted">Prefer to order directly? <Link href="/order" className="font-semibold text-[color:var(--brand-700)]">Start an order request</Link>.</p>
                    </aside>
                </div>
            </main>
            <SiteFooter />
            <MobileBottomNav />
        </>
    );
}
