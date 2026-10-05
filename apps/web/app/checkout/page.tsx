import type { Metadata } from 'next';
import { SiteFooter } from '@/components/layout/site-footer';
import { SiteHeader } from '@/components/layout/site-header';
import { MobileBottomNav } from '@/components/layout/mobile-bottom-nav';
import { CartCheckout } from '@/components/cart/cart-checkout';
import { getCatalog } from '@/lib/catalog-api';

export const revalidate = 60;

export const metadata: Metadata = {
    title: 'Checkout | Adesoba',
    description: 'Review your catfish request before sending it to Adesoba Farm.',
    robots: { index: false, follow: false },
};

/**
 * Addendum §A1: Review & Confirm lives on /checkout; state comes from the persisted
 * sessionStorage draft, and an empty draft redirects back to /order.
 */
export default async function CheckoutPage() {
    const catalog = await getCatalog();

    return (
        <>
            <SiteHeader />
            <main className="mx-auto max-w-7xl px-4 py-10 md:px-8 lg:px-12">
                <p className="text-xs font-bold uppercase tracking-[0.16em] text-[color:var(--brand-700)]">Checkout</p>
                <h1 className="mt-3 font-display text-4xl font-bold text-ink">Checkout</h1>
                <p className="mt-3 max-w-2xl leading-7 text-ink-muted">Check your details, then send the request to the farm. You have not been charged.</p>
                {!catalog ? <p role="status" className="mt-5 border-l-4 border-[color:var(--brand-700)] bg-[color:var(--brand-100)] px-4 py-3 text-sm text-brand-900">Live catalog details are temporarily unavailable. You can still send your request and the farm will confirm availability.</p> : null}
                <CartCheckout catalog={catalog} minOrderKg={catalog?.settings.min_order_kg ?? 40} />
            </main>
            <SiteFooter />
            <MobileBottomNav />
        </>
    );
}
