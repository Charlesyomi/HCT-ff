import type { Metadata } from 'next';
import Image from 'next/image';
import Link from 'next/link';
import { SiteFooter } from '@/components/layout/site-footer';
import { SiteHeader } from '@/components/layout/site-header';
import { MobileBottomNav } from '@/components/layout/mobile-bottom-nav';
import { getCatalog } from '@/lib/catalog-api';

export const metadata: Metadata = {
    title: 'About Us | Adesoba',
    description: 'Learn about our family farm and how we raise healthy catfish.',
};

const farmSections = [
    ['How we raise fish', 'We raise catfish in well-managed ponds, with attention to water quality, feeding and careful handling before each harvest window.'],
    ['Harvest cadence', 'Harvest windows are published when they are confirmed, and we work with buyers to match the best collection or delivery date to what is available.'],
    ['Pickup and delivery', 'Customers can collect directly from the farm, and delivery is arranged when the area and schedule are confirmed with the buyer.'],
];

export default async function AboutPage() {
    const catalog = await getCatalog();

    return (
        <>
            <SiteHeader />
            <main className="mx-auto max-w-5xl px-4 py-10 md:px-8 lg:px-12">
                <p className="text-xs font-semibold uppercase tracking-[0.2em] text-[color:var(--brand-700)]">About us</p>
                <h1 className="mt-3 max-w-3xl font-display text-4xl font-bold text-[color:var(--text)]">Adesoba Catfish Farm: fresh catfish, cut to your order</h1>

                <div className="mt-8 grid gap-7 md:grid-cols-2 md:items-center">
                    <div className="space-y-4 leading-7 text-ink-muted">
                        <p>Adesoba Catfish Farm raises healthy fish for households, sellers and businesses who want reliable catfish without the usual long supply chain. We keep the process simple: confirm the size and quantity, match the best harvest window, and agree the current price before delivery or collection.</p>
                        <p>Ordering here is a request rather than a checkout. You choose a fish type and size, say how
                            much you need and when, and pick up or delivery. The farm then confirms what
                            is actually available, agrees the current price with you, and arranges the
                            rest. Nothing is charged online.</p>
                        <Link href="/our-fish" className="inline-flex min-h-11 items-center rounded-full bg-[color:var(--brand-700)] px-5 font-semibold text-white">Explore our fish</Link>
                    </div>
                    <div className="relative aspect-[16/10] overflow-hidden rounded-lg bg-[color:var(--brand-100)]">
                        <Image
                            src="/images/farmer-catfish-placeholder.svg"
                            alt="Farm owner holding catfish photograph placeholder"
                            fill
                            sizes="(max-width: 767px) 100vw, 50vw"
                            className="object-cover"
                        />
                    </div>
                </div>

                <div className="mt-12 border-y border-line-soft">
                    {farmSections.map(([title, text]) => (
                        <section key={title} className="grid gap-2 border-b border-line-soft py-5 last:border-b-0 sm:grid-cols-[220px_1fr]">
                            <h2 className="font-display text-xl font-bold text-ink">{title}</h2>
                            <p className="leading-7 text-ink-muted">{text}</p>
                        </section>
                    ))}
                </div>

                <section className="mt-10 border-l-4 border-[color:var(--brand-700)] bg-[color:var(--brand-100)] px-5 py-4">
                    <h2 className="font-display text-xl font-bold text-ink">Farm location and collection</h2>
                    <p className="mt-2 text-ink-muted">{catalog?.settings.farm_address ?? 'Farm location is temporarily unavailable.'}</p>
                    {catalog ? <p className="mt-2 text-sm text-ink-muted">{catalog.settings.business_hours.join(' · ')}</p> : null}
                    <Link href="/contact" className="mt-4 inline-flex font-semibold text-[color:var(--brand-700)]">Contact the farm <span aria-hidden="true" className="ml-2">→</span></Link>
                </section>
            </main>
            <SiteFooter />
            <MobileBottomNav />
        </>
    );
}
