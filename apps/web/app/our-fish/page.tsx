import type { Metadata } from 'next';
import Image from 'next/image';
import Link from 'next/link';
import { SiteFooter } from '@/components/layout/site-footer';
import { SiteHeader } from '@/components/layout/site-header';
import { MobileBottomNav } from '@/components/layout/mobile-bottom-nav';
import { SizeCard } from '@/components/catalog/size-card';
import { getCatalog } from '@/lib/catalog-api';

export const metadata: Metadata = {
    title: 'Our Fish | Adesoba',
    description: 'Learn about our Clarias and Hybrid catfish and the sizes we offer.',
};

export default async function OurFishPage() {
    const catalog = await getCatalog();

    return (
        <>
            <SiteHeader />
            <main className="mx-auto max-w-7xl px-4 py-10 md:px-8 lg:px-12">
                <div className="mb-8">
                    <p className="text-xs font-semibold uppercase tracking-[0.2em] text-[color:var(--brand-700)]">Our Fish</p>
                    <h1 className="mt-3 font-display text-4xl font-bold text-[color:var(--text)]">Healthy catfish from the farm</h1>
                </div>

                <section className="grid gap-6 md:grid-cols-2">
                    {catalog?.fish_types.map((fish) => (
                        <article key={fish.slug} className="grid gap-5 border-b border-line-soft pb-6 sm:grid-cols-[minmax(0,1fr)_minmax(0,1.1fr)] sm:items-center">
                            <div className="relative aspect-[16/10] overflow-hidden rounded-lg bg-[color:var(--brand-100)]">
                                <Image
                                    src={fish.image_path}
                                    alt={`${fish.name} catfish photograph placeholder`}
                                    fill
                                    priority={fish.sort_order === 1}
                                    sizes="(max-width: 639px) 100vw, 50vw"
                                    className="object-cover"
                                />
                            </div>
                            <div>
                                <h2 className="font-display text-2xl font-bold text-ink">{fish.name}</h2>
                                <p className="mt-3 max-w-lg leading-7 text-ink-muted">{fish.description}</p>
                                <Link href="/order" className="mt-5 inline-flex min-h-11 items-center rounded-full border border-[color:var(--brand-700)] px-5 font-semibold text-[color:var(--brand-700)] hover:bg-[color:var(--brand-100)]">
                                    Request this fish
                                </Link>
                            </div>
                        </article>
                    )) ?? null}
                    {!catalog ? (
                        <p className="border-y border-line-soft py-6 text-ink-muted">Fish information is temporarily unavailable. You can still send the farm a request.</p>
                    ) : null}
                </section>

                <section className="mt-12">
                    <div className="flex flex-col gap-3 border-b border-line-soft pb-5 sm:flex-row sm:items-end sm:justify-between">
                        <div>
                            <h2 className="font-display text-3xl font-bold">Available sizes</h2>
                            <p className="mt-2 text-sm text-ink-muted">Availability updates with each published harvest window.</p>
                        </div>
                        <Link href="/order" className="text-sm font-semibold text-[color:var(--brand-700)]">Ask about a size <span aria-hidden="true">→</span></Link>
                    </div>
                    {catalog && catalog.size_classes.length > 0 ? (
                        <div className="mt-6 grid gap-5 md:grid-cols-2 xl:grid-cols-4">
                            {catalog.size_classes.map((size) => <SizeCard key={size.slug} size={size} />)}
                        </div>
                    ) : (
                        <p className="mt-6 border-y border-line-soft py-6 text-ink-muted">Live size availability is temporarily unavailable. Submit a request and the farm will confirm options.</p>
                    )}
                </section>
            </main>
            <SiteFooter />
            <MobileBottomNav />
        </>
    );
}
