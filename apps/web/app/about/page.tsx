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

const editableSections = [
    ['How we raise fish', '[EDIT ME] Describe the farm’s feeding, water-quality and fish-handling practices.'],
    ['Harvest cadence', '[EDIT ME] We harvest roughly every six months, with dates published when a window is confirmed.'],
    ['Pickup and delivery', '[EDIT ME] Add the farm pickup instructions and the towns or areas you serve by delivery.'],
];

export default async function AboutPage() {
    const catalog = await getCatalog();

    return (
        <>
            <SiteHeader />
            <main className="mx-auto max-w-5xl px-4 py-10 md:px-8 lg:px-12">
                <p className="text-xs font-semibold uppercase tracking-[0.2em] text-[color:var(--brand-700)]">About us</p>
                <h1 className="mt-3 max-w-3xl font-display text-4xl font-bold text-[color:var(--text)]">[EDIT ME] A family farm raising healthy catfish</h1>

                <div className="mt-8 grid gap-7 md:grid-cols-2 md:items-center">
                    <div className="space-y-4 leading-7 text-ink-muted">
                        <p>[EDIT ME] Introduce your family, how the farm began and what you want customers to know about buying fish directly from you.</p>
                        <p>[EDIT ME] Explain how customers can choose a fish size and request pickup or delivery. The farm confirms stock and current pricing before an order is agreed.</p>
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
                    {editableSections.map(([title, text]) => (
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
