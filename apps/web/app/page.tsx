import Image from 'next/image';
import Link from 'next/link';
import type { Metadata } from 'next';
import { Boxes, ChevronRight, ClipboardCheck, Fish, Flame, HeartPulse, MessageCircle, Truck } from 'lucide-react';
import { MobileBottomNav } from '@/components/layout/mobile-bottom-nav';
import { SiteFooter } from '@/components/layout/site-footer';
import { SiteHeader } from '@/components/layout/site-header';
import { SizeCard } from '@/components/catalog/size-card';
import { LocalBusinessJsonLd } from '@/components/seo/local-business-json-ld';
import { getCatalog, formatHarvestDate } from '@/lib/catalog-api';

export const revalidate = 60;

export const metadata: Metadata = {
    title: 'Fresh Catfish Directly From Our Farm | Adesoba Catfish Farm',
    description: 'Request fresh Clarias or Hybrid catfish, raised at Adesoba Farm and supplied by confirmed harvest availability.',
    openGraph: {
        title: 'Adesoba Catfish Farm',
        description: 'Fresh Catfish Directly From Our Farm',
        images: ['/images/farm-pond-placeholder.svg'],
    },
};

const steps = [
    'Tell us what you need',
    'We confirm availability',
    'Receive a quote',
    'Pay as agreed',
    'Collect or receive delivery',
];

const orderIntents = [
    { label: 'I know what I want', href: '/order', Icon: ClipboardCheck },
    { label: 'I want to buy in bulk', href: '/order?intent=bulk', Icon: Boxes },
    { label: "I'm looking for smoking/BBQ size", href: '/order?intent=smoking', Icon: Flame },
] as const;

export default function HomePage() {
    return HomeContent();
}

async function HomeContent() {
    const catalog = await getCatalog();
    const harvestWindow = catalog?.harvest_window;
    const whatsappDigits = catalog?.settings.whatsapp_number.replace(/\D/g, '');
    const whatsappHref = whatsappDigits
        ? `https://wa.me/${whatsappDigits}?text=${encodeURIComponent('Hi Adesoba Farm, I would like to ask about your current catfish availability.')}`
        : '/contact';

    return (
        <>
            <SiteHeader />
            {catalog ? (
                <LocalBusinessJsonLd
                    phone={catalog.settings.phone_number}
                    address={catalog.settings.farm_address}
                    hours={catalog.settings.business_hours}
                />
            ) : null}
            <main className="bg-[color:var(--surface)] text-[color:var(--text)]">
                <section className="relative isolate overflow-hidden bg-[color:var(--brand-900)] text-white">
                    <Image
                        src="/images/farm-pond-placeholder.svg"
                        alt="Catfish farm pond placeholder photograph"
                        fill
                        priority
                        sizes="100vw"
                        className="-z-20 object-cover"
                    />
                    <div className="hero-scrim absolute inset-0 -z-10" />
                    <div className="mx-auto grid min-h-[670px] max-w-7xl items-center gap-10 px-4 py-16 md:px-8 lg:grid-cols-[1.2fr_0.8fr] lg:px-12 lg:py-20">
                        <div className="max-w-2xl">
                            <p className="mb-4 text-xs font-bold uppercase tracking-[0.2em] text-brand-100">
                                FRESH • QUALITY • RELIABLE
                            </p>
                            <h1 className="font-display text-4xl font-extrabold leading-tight sm:text-5xl">
                                Fresh Catfish Directly From Our Farm
                            </h1>
                            <p className="mt-5 max-w-xl text-base leading-7 text-ink-hero md:text-lg">
                                Healthy, carefully raised Clarias and Hybrid catfish for households, resellers and businesses.
                            </p>
                            <div className="mt-8 flex flex-wrap gap-3">
                                <Link href="/order" className="inline-flex min-h-12 items-center rounded-full bg-[color:var(--brand-700)] px-6 font-semibold text-white shadow-sm transition hover:bg-[color:var(--brand-900)]">
                                    Order Fish
                                </Link>
                                <Link href="/about" className="inline-flex min-h-12 items-center rounded-full bg-[color:var(--accent-400)] px-6 font-semibold text-ink-on-accent transition hover:brightness-105">
                                    About Our Farm
                                </Link>
                            </div>
                            <div className="mt-9 grid max-w-2xl gap-3 sm:grid-cols-3">
                                {[
                                    { label: 'Healthy & well-raised fish', Icon: HeartPulse },
                                    { label: 'Clarias & Hybrid varieties', Icon: Fish },
                                    { label: 'Pickup or delivery available', Icon: Truck },
                                ].map((item) => (
                                    <div key={item.label} className="flex min-h-14 items-center gap-3 border-l-2 border-line-accent pl-3 text-sm font-medium text-ink-hero-bright">
                                        <span aria-hidden="true" className="inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-white/15 text-brand-100"><item.Icon size={18} strokeWidth={1.8} /></span>
                                        <span>{item.label}</span>
                                    </div>
                                ))}
                            </div>
                        </div>

                        <aside className="w-full max-w-lg justify-self-end rounded-xl bg-canvas p-5 text-ink shadow-xl sm:p-6">
                            <div className="mb-4">
                                <p className="text-xs font-bold uppercase tracking-[0.14em] text-[color:var(--brand-700)]">Start an order request</p>
                                <h2 className="mt-1 font-display text-2xl font-bold">Tell us what you need</h2>
                            </div>
                            <div className="space-y-2">
                                {orderIntents.map((item) => (
                                    <Link
                                        key={item.href}
                                        href={item.href}
                                        className="flex min-h-14 items-center justify-between gap-3 rounded-lg border border-line-soft bg-canvas-soft px-4 py-3 font-medium transition hover:border-[color:var(--brand-700)] hover:bg-[color:var(--brand-100)] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[color:var(--brand-700)]"
                                    >
                                        <span className="flex items-center gap-3"><item.Icon aria-hidden="true" size={19} strokeWidth={1.8} />{item.label}</span>
                                        <ChevronRight aria-hidden="true" size={18} />
                                    </Link>
                                ))}
                            </div>
                        </aside>
                    </div>
                </section>

                <section className="mx-auto max-w-7xl px-4 py-16 md:px-8 lg:px-12">
                    <div className="mb-8 flex flex-col gap-4 md:flex-row md:items-end md:justify-between">
                        <div>
                            <p className="text-xs font-bold uppercase tracking-[0.16em] text-[color:var(--brand-700)]">Current Availability</p>
                            <h2 className="mt-2 font-display text-3xl font-bold">Choose your fish size</h2>
                            <p className="mt-3 max-w-2xl text-sm leading-6 text-ink-muted">
                                We harvest roughly every six months. Availability can change by size and harvest window; send a request and we will confirm what is ready.
                            </p>
                        </div>
                        <div className="max-w-sm border-l-4 border-[color:var(--brand-700)] bg-[color:var(--brand-100)] px-4 py-3 text-sm text-brand-900">
                            <p className="font-semibold">Next harvest window</p>
                            {harvestWindow ? (
                                <p className="mt-1">{formatHarvestDate(harvestWindow.starts_on)} – {formatHarvestDate(harvestWindow.ends_on)}</p>
                            ) : (
                                <p className="mt-1">Next harvest date to be announced. Send us a request and we’ll notify you.</p>
                            )}
                        </div>
                    </div>

                    {catalog && catalog.size_classes.length > 0 ? (
                        <div className="grid gap-5 md:grid-cols-2 xl:grid-cols-4">
                            {catalog.size_classes.map((size) => (
                                <SizeCard
                                    key={size.slug}
                                    size={size}
                                    whatsappNumber={catalog.settings.whatsapp_number}
                                    minOrderKg={catalog.settings.min_order_kg}
                                    maxOrderKg={catalog.settings.max_order_kg}
                                />
                            ))}
                        </div>
                    ) : (
                        <div className="flex flex-col items-start gap-4 border-y border-line-soft py-8 sm:flex-row sm:items-center sm:justify-between">
                            <p className="max-w-xl text-ink-muted">Live size availability is temporarily unavailable. You can still send a request and the farm will confirm the next harvest date.</p>
                            <Link href="/order" className="inline-flex min-h-11 shrink-0 items-center rounded-full bg-[color:var(--brand-700)] px-5 font-semibold text-white">Request a quote</Link>
                        </div>
                    )}
                </section>

                <section className="bg-[color:var(--brand-100)] py-16">
                    <div className="mx-auto max-w-7xl px-4 md:px-8 lg:px-12">
                        <p className="text-xs font-bold uppercase tracking-[0.16em] text-[color:var(--brand-700)]">A straightforward process</p>
                        <h2 className="mt-2 font-display text-3xl font-bold text-brand-900">How It Works</h2>
                        <div className="mt-8 grid gap-5 md:grid-cols-2 xl:grid-cols-5">
                            {steps.map((step, index) => (
                                <div key={step} className="border-t-2 border-[color:var(--brand-700)] bg-white p-5">
                                    <div className="mb-4 inline-flex h-10 w-10 items-center justify-center rounded-full bg-[color:var(--brand-700)] font-display text-lg font-bold text-white">
                                        {index + 1}
                                    </div>
                                    <h3 className="font-display text-lg font-bold text-brand-900">{step}</h3>
                                </div>
                            ))}
                        </div>
                    </div>
                </section>

                <section className="bg-[color:var(--brand-900)] text-white">
                    <div className="mx-auto grid max-w-7xl gap-0 lg:grid-cols-2">
                        <div className="relative min-h-80 lg:min-h-[480px]">
                            <Image
                                src="/images/farmer-catfish-placeholder.svg"
                                alt="Farm owner holding a healthy catfish, photograph placeholder"
                                fill
                                sizes="(max-width: 1023px) 100vw, 50vw"
                                className="object-cover"
                            />
                        </div>
                        <div className="flex flex-col justify-center px-6 py-12 md:px-12 lg:px-16">
                            <p className="text-xs font-bold uppercase tracking-[0.16em] text-brand-100">Why Choose Us</p>
                            <h2 className="mt-3 max-w-lg font-display text-3xl font-bold">Healthy Fish. Better Business.</h2>
                            <p className="mt-4 max-w-xl leading-7 text-ink-hero">
                                Indicative prices help you plan. We check availability and confirm your final price before anything is agreed.
                            </p>
                            <ul className="mt-6 grid gap-3 text-sm text-ink-on-dark">
                                <li className="border-l-2 border-line-accent pl-3">Carefully raised Clarias and Hybrid fish</li>
                                <li className="border-l-2 border-line-accent pl-3">Pickup or delivery arrangements confirmed with you</li>
                                <li className="border-l-2 border-line-accent pl-3">A real person checks every request before quoting</li>
                            </ul>
                            <Link href="/about" className="mt-8 inline-flex min-h-11 w-fit items-center rounded-full bg-[color:var(--accent-400)] px-5 font-semibold text-ink-on-accent">About Our Farm</Link>
                        </div>
                    </div>
                </section>

                <section className="mx-auto max-w-7xl px-4 py-12 md:px-8 lg:px-12">
                    <div className="flex flex-col gap-5 border-y border-line-soft py-7 sm:flex-row sm:items-center sm:justify-between">
                        <div>
                            <p className="text-xs font-bold uppercase tracking-[0.16em] text-[color:var(--brand-700)]">Prefer to talk?</p>
                            <h2 className="mt-1 font-display text-2xl font-bold">We’re happy to help with your order.</h2>
                        </div>
                        <a href={whatsappHref} className="inline-flex min-h-12 items-center justify-center rounded-full bg-[color:var(--whatsapp)] px-6 font-semibold text-white"><MessageCircle aria-hidden="true" className="mr-2" size={18} />Talk to Us on WhatsApp</a>
                    </div>
                </section>
            </main>
            <SiteFooter />
            <MobileBottomNav />
        </>
    );
}
