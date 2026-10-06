import type { Metadata } from 'next';
import { CartView } from '@/components/cart/cart-view';
import { SiteFooter } from '@/components/layout/site-footer';
import { SiteHeader } from '@/components/layout/site-header';
import { MobileBottomNav } from '@/components/layout/mobile-bottom-nav';
import { getCatalog } from '@/lib/catalog-api';

export const metadata: Metadata = {
    title: 'Your Cart | HCT Fish Farms',
    description: 'Review the catfish sizes you have saved before requesting a quote.',
    robots: { index: false, follow: false },
};

export const revalidate = 60;

export default async function CartPage() {
    const catalog = await getCatalog();

    return (
        <>
            <SiteHeader />
            <main className="mx-auto max-w-7xl px-4 py-10 md:px-8 lg:px-12">
                <p className="text-xs font-bold uppercase tracking-[0.16em] text-[color:var(--brand-700)]">Cart</p>
                <h1 className="mt-3 font-display text-4xl font-bold text-ink">Your cart</h1>
                <p className="mt-3 max-w-2xl leading-7 text-ink-muted">
                    Adjust the kilograms you need. The farm confirms availability and your final price before
                    anything is agreed.
                </p>
                <CartView minOrderKg={catalog?.settings.min_order_kg ?? 40} />
            </main>
            <SiteFooter />
            <MobileBottomNav />
        </>
    );
}