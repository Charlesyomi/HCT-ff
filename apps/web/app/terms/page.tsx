import type { Metadata } from 'next';
import { SiteFooter } from '@/components/layout/site-footer';
import { SiteHeader } from '@/components/layout/site-header';
import { MobileBottomNav } from '@/components/layout/mobile-bottom-nav';

export const metadata: Metadata = {
    title: 'Terms | HCT Fish Farms',
    description: 'Terms for requesting a catfish quote from HCT Fish Farms.',
};

export const revalidate = 60;

export default function TermsPage() {
    return (
        <>
            <SiteHeader />
            <main className="mx-auto max-w-4xl px-4 py-10 md:px-8 lg:px-12">
                <h1 className="font-display text-4xl font-bold text-[color:var(--text)]">Terms of Service</h1>
                <div className="mt-6 space-y-4 text-ink-muted">
                    <section>
                        <h2 className="font-display text-xl font-bold text-ink">1. How ordering works</h2>
                        <p className="mt-2">
                            These terms apply to HCT Fish Farms. This site lets you request fish from HCT Fish Farms. Sending a request is
                            not a purchase. The farm checks stock, confirms the price, and agrees pickup
                            or delivery with you, usually on WhatsApp or by phone. An order is confirmed
                            only when you and the farm have agreed the size, quantity, price and date.
                        </p>
                    </section>

                    <section>
                        <h2 className="font-display text-xl font-bold text-ink">2. Prices and quotes</h2>
                        <p className="mt-2">
                            Any price you see on this site is an estimate. The price that counts is the one
                            in your quote from the farm. Every quote shows its own &ldquo;valid
                            until&rdquo; time. Quotes usually stay valid for about 48 hours, and can be
                            shorter when stock is moving fast. If your quote has expired, ask us for a
                            fresh one. Delivery fees, if any, are confirmed in your quote.
                        </p>
                    </section>

                    <section>
                        <h2 className="font-display text-xl font-bold text-ink">3. Deposits and payment</h2>
                        <p className="mt-2">
                            The farm may ask for a deposit or full payment to hold your fish, as agreed
                            with you. This site does not take payments online. You pay the farm directly
                            in the way you agree together. Your deposit is refundable as long as your fish
                            has not left the pond. Once the fish has left the pond for collection or
                            delivery, the deposit is not refundable. Refunds are arranged directly with
                            the farm.
                        </p>
                    </section>

                    <section>
                        <h2 className="font-display text-xl font-bold text-ink">4. Pickup</h2>
                        <p className="mt-2">
                            Please arrive at the time we agreed, and tell us early if your plans change. To
                            protect the fish from stress, if you have not arrived or confirmed within
                            about 2 hours of the agreed time, the farm may return your fish to the pond
                            and release it to other customers. Contact us and we will happily rebook.
                        </p>
                    </section>

                    <section>
                        <h2 className="font-display text-xl font-bold text-ink">5. Delivery</h2>
                        <p className="mt-2">
                            Delivery is available where the farm can arrange it. The area and fee are
                            confirmed for each order. Fish are handed over at the agreed delivery
                            location.
                        </p>
                    </section>

                    <section>
                        <h2 className="font-display text-xl font-bold text-ink">6. Fish health and handling</h2>
                        <p className="mt-2">
                            We sell healthy fish. Most fish loss comes from stress during handling,
                            holding and transport after the fish leave our pond. Once the fish are handed
                            to you, whether you collect them or we deliver them, their handling is your
                            responsibility. The farm is not responsible for losses after handover unless
                            it can reasonably be shown that the fish were unhealthy when handed over. If
                            you want advice on handling, just ask us.
                        </p>
                    </section>

                    <section>
                        <h2 className="font-display text-xl font-bold text-ink">7. Cancelling</h2>
                        <p className="mt-2">
                            You can cancel a pending or quoted request from My Orders, or by contacting the
                            farm. Deposits follow section 3.
                        </p>
                    </section>

                    <section>
                        <h2 className="font-display text-xl font-bold text-ink">8. Sign-in and your details</h2>
                        <p className="mt-2">
                            Signing in with Google is optional. We use it only to save your orders and fill
                            in your details. See our Privacy Policy for how we handle your information.
                        </p>
                    </section>

                    <section>
                        <h2 className="font-display text-xl font-bold text-ink">9. Changes to these terms</h2>
                        <p className="mt-2">
                            We may update these terms from time to time. The version on this page is the
                            one that applies.
                        </p>
                    </section>

                    <section>
                        <h2 className="font-display text-xl font-bold text-ink">
                            10. Governing law and contact
                        </h2>
                        <p className="mt-2">
                            These terms are governed by the laws of the Federal Republic of Nigeria.
                            Questions? Call or WhatsApp the farm, or use the Contact page.
                        </p>
                    </section>

                    <p className="text-sm">
                        These terms are drafted from the farm&rsquo;s stated practices and are not
                        legal advice. Have someone you trust read them once before launch.
                    </p>
                </div>
            </main>
            <SiteFooter />
            <MobileBottomNav />
        </>
    );
}
