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
    [
        'How we raise our fish',
        'Healthy fish start with calm handling, so we plan every harvest and pickup around keeping the fish as stress-free as possible. Pond type: we currently raise our fish in concrete and tarpaulin ponds, building on our earlier experience with earthen ponds. Feeding: our fish are fed healthy commercial fish pellets, including feeds from established manufacturers, typically twice a day. Fingerlings: we source our fingerlings from reputable suppliers to give each production cycle a healthy start. Water: our ponds are supplied with clean borehole water, with water changes carried out regularly-typically every two days-to maintain suitable pond conditions. Before harvest: we stop feeding the fish one day before harvest.',
    ],
    [
        'Harvest cadence',
        'We harvest roughly every six months. When a harvest window is confirmed, it appears on this site. Send us a request any time and we will tell you when your size is ready.',
    ],
    [
        'Pickup',
        'Collect your fish at the farm at the time we agree and we will have it ready for you. Fish are fragile and stress is their biggest enemy, so we hold your fish for about two hours after the agreed time; after that they go back to the pond so they stay healthy. Farm pickup is available Monday to Sunday, from 8:00 AM to 6:00 PM. Your fish are weighed at the farm before collection, so you can see exactly what you are purchasing. Customers should come with a suitable container or vessel for carrying their fish. For larger orders or special collection arrangements, please contact us ahead of time so we can prepare your order.',
    ],
    [
        'Delivery',
        'We transport live fish in large containers with sufficient water for the journey, taking care to maintain suitable conditions during transportation. Our goal is to get your fish to you safely and in good condition. Contact us on 09019871421 to ask about delivery to your area and get a quote.',
    ],
    [
        'Find us',
        'Our farm is located at Ajebamidele, along Ikere Road, Ado-Ekiti, Ekiti State, Nigeria. If you are visiting the farm for pickup, we recommend contacting us before setting out so we can help with directions and make sure your order is ready. Farm hours: Monday-Sunday, 8:00 AM-6:00 PM.',
    ],
];

export default async function AboutPage() {
    const catalog = await getCatalog();

    return (
        <>
            <SiteHeader />
            <main className="mx-auto max-w-5xl px-4 py-10 md:px-8 lg:px-12">
                <p className="text-xs font-semibold uppercase tracking-[0.2em] text-[color:var(--brand-700)]">About us</p>
                <h1 className="mt-3 max-w-3xl font-display text-4xl font-bold text-[color:var(--text)]">Raised by a family. Harvested for your table and your business.</h1>

                <div className="mt-8 grid gap-7 md:grid-cols-2 md:items-center">
                    <div className="space-y-4 leading-7 text-ink-muted">
                        <p>
                            Adesoba Catfish Farm is a family-run catfish farm in Ado Ekiti, Ekiti
                            State. We stock our ponds, give the fish about six months to grow, and
                            harvest when they are ready: mostly 2-3kg table-size catfish, with smaller
                            smoking and BBQ sizes when we have them.
                        </p>
                        <p>
                            What started with earthen ponds has grown through years of hands-on
                            experience into a fish farm using concrete and tarpaulin ponds, with a
                            focus on raising healthy fish for families, homes, and customers across
                            Ekiti State. We started farming fish because we saw an opportunity to
                            build a reliable local source of fresh, healthy fish while developing a
                            family business that could grow with experience and dedication.
                        </p>
                        <p>
                            Whether you are feeding a family, stocking a market stall or supplying a
                            restaurant, you deal directly with the farm. No middlemen, no guessing what
                            is in stock.
                        </p>
                        <p>Ordering here is a request rather than a checkout. You choose a fish type and size, say how
                        much you need and when, and pick up or delivery. The farm then confirms what
                        is actually available, agrees the current price with you, and arranges the
                        rest. Nothing is charged online.</p>
                        <Link href="/our-fish" className="inline-flex min-h-11 items-center rounded-full bg-[color:var(--brand-700)] px-5 font-semibold text-white">Explore our fish</Link>
                    </div>
                    <div className="relative aspect-[16/10] overflow-hidden rounded-lg bg-[color:var(--brand-100)]">
                        <Image
                            src="/images/farmer-catfish-placeholder.svg"
                            alt="Farm owner holding a healthy catfish"
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
