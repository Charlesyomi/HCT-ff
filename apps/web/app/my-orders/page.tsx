import type { Metadata } from 'next';
import { SiteFooter } from '@/components/layout/site-footer';
import { SiteHeader } from '@/components/layout/site-header';
import { MobileBottomNav } from '@/components/layout/mobile-bottom-nav';

export const metadata: Metadata = {
    title: 'My Orders | Adesoba',
    description: 'Track active or completed fish orders with Adesoba Farm.',
    robots: { index: false, follow: false },
};

export default function MyOrdersPage() {
    return (
        <>
            <SiteHeader />
            <main className="mx-auto max-w-5xl px-4 py-10 md:px-8 lg:px-12">
                <p className="text-xs font-semibold uppercase tracking-[0.2em] text-[color:var(--brand-700)]">My Orders</p>
                <h1 className="mt-3 font-display text-4xl font-bold text-[color:var(--text)]">Track your order</h1>

                <div className="mt-8 rounded-3xl border border-[#dfeae3] bg-white p-6 shadow-sm">
                    <div className="flex gap-3">
                        <button type="button" className="rounded-full bg-[color:var(--brand-700)] px-4 py-2 text-sm font-semibold text-white">Active</button>
                        <button type="button" className="rounded-full border border-[#dfeae3] px-4 py-2 text-sm font-semibold text-[#2a4337]">Completed</button>
                    </div>
                    <div className="mt-6 rounded-2xl border border-dashed border-[#dfeae3] bg-[#f7faf8] p-6 text-[#4d665d]">
                        No active orders yet. Submit a request to track it here.
                    </div>
                </div>
            </main>
            <SiteFooter />
            <MobileBottomNav />
        </>
    );
}
