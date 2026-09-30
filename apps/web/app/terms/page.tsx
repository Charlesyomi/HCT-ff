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
                    <section>
                        <h2 className="font-display text-xl font-bold text-ink">Requests and quotes</h2>
                        <p className="mt-2">An online submission is a request, not a confirmed purchase. The farm checks stock, confirms the size and quantity, and sends the current price and final details directly to you. No online payment is taken.</p>
                    </section>
                    <section>
                        <h2 className="font-display text-xl font-bold text-ink">Pickup and delivery</h2>
                        <p className="mt-2">Pickup time, delivery area and any delivery fee are agreed with the farm before fulfilment. Please check the final details in the quote before confirming.</p>
                    </section>
                    <section>
                        <h2 className="font-display text-xl font-bold text-ink">Changes and cancellations</h2>
                        <p className="mt-2">[EDIT ME] Add the farm’s cancellation, refund, quality and dispute-handling terms before launch.</p>
                    </section>
                </div>
            </main>
            <SiteFooter />
            <MobileBottomNav />
        </>
    );
}
