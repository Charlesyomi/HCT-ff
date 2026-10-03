import type { Metadata } from 'next';
import { SiteFooter } from '@/components/layout/site-footer';
import { SiteHeader } from '@/components/layout/site-header';
import { MobileBottomNav } from '@/components/layout/mobile-bottom-nav';

export const metadata: Metadata = {
    title: 'Terms | Adesoba',
    description: 'Terms for requesting a catfish quote from Adesoba Catfish Farm.',
};

export default function TermsPage() {
    return (
        <>
            <SiteHeader />
            <main className="mx-auto max-w-4xl px-4 py-10 md:px-8 lg:px-12">
                <h1 className="font-display text-4xl font-bold text-[color:var(--text)]">Terms of Service</h1>
                <div className="mt-6 space-y-4 text-ink-muted">
                    <p>By using this website, you agree to these terms.</p>

                    <section>
                        <h2 className="font-display text-xl font-bold text-ink">
                            Orders and availability
                        </h2>
                        <p className="mt-2">
                            Submitting an order through the website does not necessarily mean that the
                            order has been accepted or confirmed. Product availability, quantities,
                            fulfilment arrangements, and other order details are confirmed with the
                            farm before fulfilment.
                        </p>
                    </section>

                    <section>
                        <h2 className="font-display text-xl font-bold text-ink">Pricing</h2>
                        <p className="mt-2">
                            Where a base or estimated price is displayed, it is provided as a reference
                            for the order. Final pricing may be confirmed or negotiated with the farm
                            before fulfilment. Submitting a request does not charge you.
                        </p>
                    </section>

                    <section>
                        <h2 className="font-display text-xl font-bold text-ink">Product information</h2>
                        <p className="mt-2">
                            We make reasonable efforts to keep product information, availability, images,
                            and descriptions accurate. Actual produce may vary in appearance, size, or
                            availability.
                        </p>
                    </section>

                    <section>
                        <h2 className="font-display text-xl font-bold text-ink">Fulfilment</h2>
                        <p className="mt-2">
                            Pickup or delivery arrangements are confirmed with the customer and the
                            farm. Additional fulfilment or delivery conditions may apply depending on
                            the order, including any delivery fee and the area served.
                        </p>
                    </section>

                    <section>
                        <h2 className="font-display text-xl font-bold text-ink">Payments</h2>
                        <p className="mt-2">
                            The website does not currently process online payments. Any payment
                            arrangements, including any deposit, are confirmed directly with the farm
                            or fulfilment team.
                        </p>
                    </section>

                    <section>
                        <h2 className="font-display text-xl font-bold text-ink">
                            Changes and cancellation
                        </h2>
                        <p className="mt-2">
                            Orders may be changed or cancelled before fulfilment, subject to
                            confirmation with the farm. Because produce is prepared to order, please
                            tell us as early as possible so we can adjust.
                        </p>
                    </section>

                    <section>
                        <h2 className="font-display text-xl font-bold text-ink">Contact</h2>
                        <p className="mt-2">
                            If you have questions about an order or these terms, please contact us
                            using the contact details provided on the website.
                        </p>
                    </section>

                    <p>These terms may be updated as the service develops.</p>
                </div>
            </main>
            <SiteFooter />
            <MobileBottomNav />
        </>
    );
}
