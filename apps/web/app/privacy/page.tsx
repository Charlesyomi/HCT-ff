import type { Metadata } from 'next';
import { SiteFooter } from '@/components/layout/site-footer';
import { SiteHeader } from '@/components/layout/site-header';
import { MobileBottomNav } from '@/components/layout/mobile-bottom-nav';

export const metadata: Metadata = {
    title: 'Privacy Policy | Adesoba',
    description: 'How Adesoba Catfish Farm collects and uses information for order requests.',
};

export const revalidate = 60;

export default function PrivacyPage() {
    return (
        <>
            <SiteHeader />
            <main className="mx-auto max-w-4xl px-4 py-10 md:px-8 lg:px-12">
                <h1 className="font-display text-4xl font-bold text-[color:var(--text)]">Privacy Policy</h1>
                <div className="mt-6 space-y-4 text-ink-muted">
                    <p>
                        We respect your privacy and only collect information needed to provide and
                        improve our ordering service.
                    </p>

                    <section>
                        <h2 className="font-display text-xl font-bold text-ink">
                            Information we collect
                        </h2>
                        <p className="mt-2">
                            Depending on how you use the website, this may include information such as
                            your name, phone number, delivery or fulfilment details, order information,
                            and messages or information you provide when contacting us. When you send
                            an order we collect the name, phone number and fish requirements you
                            provide, an optional email address, and a delivery address only when you
                            select delivery.
                        </p>
                    </section>

                    <section>
                        <h2 className="font-display text-xl font-bold text-ink">How we use it</h2>
                        <p className="mt-2">We use this information to:</p>
                        <ul className="mt-2 list-disc space-y-1 pl-5">
                            <li>process and manage orders;</li>
                            <li>communicate with customers about their orders;</li>
                            <li>confirm product availability and fulfilment;</li>
                            <li>provide customer support; and</li>
                            <li>maintain and improve the website.</li>
                        </ul>
                    </section>

                    <section>
                        <h2 className="font-display text-xl font-bold text-ink">Sharing</h2>
                        <p className="mt-2">
                            We do not sell your personal information. Some order information may be
                            shared with the farm or fulfilment team where necessary to process and
                            confirm your order.
                        </p>
                    </section>

                    <section>
                        <h2 className="font-display text-xl font-bold text-ink">
                            Cookies and your choices
                        </h2>
                        <p className="mt-2">
                            Our website may also use cookies or similar technologies required for the
                            website to function properly. By submitting a request you agree that the
                            farm may contact you about it by WhatsApp, phone or email. We do not
                            display your details publicly.
                        </p>
                    </section>

                    <section>
                        <h2 className="font-display text-xl font-bold text-ink">Contact</h2>
                        <p className="mt-2">
                            For privacy questions, or to ask us to see or delete the information we hold
                            about you, email <a href="mailto:yomiadesoba@gmail.com" className="font-semibold underline underline-offset-2">yomiadesoba@gmail.com</a>. You can also
                            use the contact details provided on this website, and we will deal with your
                            request.
                        </p>
                    </section>

                    <p>This policy may be updated as the service develops.</p>
                </div>
            </main>
            <SiteFooter />
            <MobileBottomNav />
        </>
    );
}
