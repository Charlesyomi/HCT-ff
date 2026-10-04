import type { Metadata } from 'next';
import { SiteFooter } from '@/components/layout/site-footer';
import { SiteHeader } from '@/components/layout/site-header';
import { MobileBottomNav } from '@/components/layout/mobile-bottom-nav';
import { MyOrdersDashboard } from '@/components/order/my-orders-dashboard';

export const metadata: Metadata = {
    title: 'My Orders | Adesoba',
    description: 'Track active or completed fish orders with Adesoba Farm.',
    robots: { index: false, follow: false },
};

export const revalidate = 60;

export default function MyOrdersPage() {
    return (
        <>
            <SiteHeader />
            <main className="mx-auto max-w-5xl px-4 py-10 md:px-8 lg:px-12">
                <p className="text-xs font-semibold uppercase tracking-[0.2em] text-[color:var(--brand-700)]">My Orders</p>
                <h1 className="mt-3 font-display text-4xl font-bold text-[color:var(--text)]">Track your order</h1>
                <MyOrdersDashboard />
            </main>
            <SiteFooter />
            <MobileBottomNav />
        </>
    );
}
