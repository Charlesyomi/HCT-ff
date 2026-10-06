import type { Metadata } from 'next';
import { SiteFooter } from '@/components/layout/site-footer';
import { SiteHeader } from '@/components/layout/site-header';
import { MobileBottomNav } from '@/components/layout/mobile-bottom-nav';
import { SentPanel } from '@/components/order/order-flow';
import { getCatalog } from '@/lib/catalog-api';

export const revalidate = 60;

export const metadata: Metadata = {
    title: 'Order Request Sent | HCT Fish Farms',
    description: 'Your catfish order request has been sent to HCT Fish Farms.',
    robots: { index: false, follow: false },
};

/**
 * Addendum §A1: the confirmation screen gets its own route so a refresh cannot resubmit
 * the form. The reference is human-friendly (AF-YYYY-NNNN) and safe in a path segment.
 */
export default async function OrderSentPage({ params }: { params: Promise<{ reference: string }> }) {
    const [{ reference }, catalog] = await Promise.all([params, getCatalog()]);

    return (
        <>
            <SiteHeader />
            <main className="mx-auto max-w-5xl px-4 py-10 md:px-8 lg:px-12">
                <SentPanel catalog={catalog} reference={reference} />
                <p className="mt-8 text-sm text-ink-muted">
                    Keep this reference. You can use it with your phone number on <a className="font-semibold underline underline-offset-2" href="/my-orders">My Orders</a> to follow your request.
                </p>
            </main>
            <SiteFooter />
            <MobileBottomNav />
        </>
    );
}
