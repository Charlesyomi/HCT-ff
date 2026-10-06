import type { Metadata } from 'next';
import Link from 'next/link';
import { SiteFooter } from '@/components/layout/site-footer';
import { SiteHeader } from '@/components/layout/site-header';
import { MobileBottomNav } from '@/components/layout/mobile-bottom-nav';
import { OrderCartPanel } from '@/components/cart/order-cart-panel';
import { OrderFlow } from '@/components/order/order-flow';
import { getCatalog } from '@/lib/catalog-api';

export const revalidate = 60;

export const metadata: Metadata = {
    title: 'Order Fish | HCT Fish Farms',
    description: 'Request a quote for live catfish from HCT Fish Farms.',
};

type OrderPageProps = {
    searchParams: Promise<{ size?: string; fish_type?: string; intent?: string }>;
};

export default async function OrderPage({ searchParams }: OrderPageProps) {
    const [catalog, params] = await Promise.all([getCatalog(), searchParams]);

    return (
        <>
            <SiteHeader />
            <main className="mx-auto max-w-7xl px-4 py-10 md:px-8 lg:px-12">
                <p className="text-xs font-bold uppercase tracking-[0.16em] text-[color:var(--brand-700)]">Order fish</p>
                <h1 className="mt-3 font-display text-4xl font-bold text-ink">Order Your Catfish</h1>
                <p className="mt-3 max-w-2xl leading-7 text-ink-muted">Tell us what you need. The farm will check availability and confirm the current price before you commit.</p>
                {!catalog ? <p role="status" className="mt-5 border-l-4 border-[color:var(--brand-700)] bg-[color:var(--brand-100)] px-4 py-3 text-sm text-brand-900">Live catalog details are temporarily unavailable. You can still complete a request and the farm will confirm availability.</p> : null}
                <OrderFlow catalog={catalog} initialSize={params.size ?? null} initialFishType={params.fish_type ?? null} initialIntent={params.intent ?? null} />
                {catalog ? (
                    <OrderCartPanel
                        sizes={catalog.size_classes}
                        minOrderKg={catalog.settings.min_order_kg}
                        maxOrderKg={catalog.settings.max_order_kg}
                    />
                ) : null}
            </main>
            <SiteFooter />
            <MobileBottomNav />
        </>
    );
}
