import type { Metadata } from 'next';
import { SiteFooter } from '@/components/layout/site-footer';
import { SiteHeader } from '@/components/layout/site-header';
import { MobileBottomNav } from '@/components/layout/mobile-bottom-nav';

export const metadata: Metadata = {
    title: 'Privacy Policy | Adesoba',
    description: 'How Adesoba Catfish Farm collects and uses information for order requests.',
};

export default function PrivacyPage() {
    return (
        <>
            <SiteHeader />
            <main className="mx-auto max-w-4xl px-4 py-10 md:px-8 lg:px-12">
                <h1 className="font-display text-4xl font-bold text-[color:var(--text)]">Privacy Policy</h1>
                <div className="mt-6 space-y-4 text-ink-muted">
                    <section>
                        <h2 className="font-display text-xl font-bold text-ink">Information we collect</h2>
                        <p className="mt-2">When you send an order or contact request, we collect the name and phone number you provide, optional email, your fish requirements, and delivery address details only when delivery is selected.</p>
                    </section>
                    <section>
                        <h2 className="font-display text-xl font-bold text-ink">How we use it</h2>
                        <p className="mt-2">The farm uses this information to check availability, prepare a quote, arrange pickup or delivery, and contact you about the request. Submitting a request does not charge you.</p>
                    </section>
                    <section>
                        <h2 className="font-display text-xl font-bold text-ink">Your choices and retention</h2>
                        <p className="mt-2">[EDIT ME] Add the farm’s contact details and the procedure for requesting access, correction or deletion of personal information. Document the approved retention period before launch.</p>
                    </section>
                    <p>By submitting a request, you agree that the farm may contact you about it by WhatsApp, phone or email. We do not display your details publicly.</p>
                </div>
            </main>
            <SiteFooter />
            <MobileBottomNav />
        </>
    );
}
