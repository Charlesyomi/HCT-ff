import Link from 'next/link';
import { Fish, Menu, MessageCircle, Phone } from 'lucide-react';
import { getCatalog } from '@/lib/catalog-api';
import { AccountNav } from './account-nav';

const links = [
    { label: 'Home', href: '/' },
    { label: 'Order Fish', href: '/order' },
    { label: 'Our Fish', href: '/our-fish' },
    { label: 'About Us', href: '/about' },
    { label: 'Contact', href: '/contact' },
] as const;

export async function SiteHeader() {
    const catalog = await getCatalog();
    const phone = catalog?.settings.phone_number;
    const whatsapp = catalog?.settings.whatsapp_number;
    const whatsappDigits = whatsapp?.replace(/\D/g, '');
    const whatsappHref = whatsappDigits
        ? `https://wa.me/${whatsappDigits}?text=${encodeURIComponent('Hi Adesoba Farm, I would like to ask about fresh catfish.')}`
        : null;

    return (
        <header className="sticky top-0 z-40 border-b border-line-soft bg-header-glass backdrop-blur-sm">
            <div className="mx-auto flex max-w-7xl items-center justify-between px-4 py-4 md:px-8 lg:px-12">
                <Link href="/" className="flex items-center gap-3" aria-label="Adesoba Catfish Farm home">
                    <div className="flex h-10 w-10 items-center justify-center rounded-full bg-[color:var(--brand-700)] text-white">
                        <Fish aria-hidden="true" size={21} strokeWidth={1.8} />
                    </div>
                    <div>
                        <p className="font-display text-lg font-bold text-[color:var(--brand-900)]">Adesoba</p>
                        <p className="text-[10px] uppercase tracking-[0.18em] text-ink-muted">Catfish Farm</p>
                    </div>
                </Link>

                <nav className="hidden items-center gap-8 text-sm font-medium text-ink lg:flex" aria-label="Main navigation">
                    {links.map((link) => (
                        <Link key={link.href} href={link.href} className="transition hover:text-[color:var(--brand-700)]">
                            {link.label}
                        </Link>
                    ))}
                    <Link href="/my-orders" className="transition hover:text-[color:var(--brand-700)]">My Orders</Link>
                </nav>

                <div className="flex items-center gap-3">
                    <div className="hidden lg:block"><AccountNav /></div>
                    <details className="relative lg:hidden">
                        <summary aria-label="Open navigation menu" className="flex min-h-11 min-w-11 cursor-pointer list-none items-center justify-center rounded-full border border-line-soft text-ink">
                            <Menu aria-hidden="true" size={20} />
                        </summary>
                        <nav aria-label="Mobile navigation" className="absolute right-0 top-12 z-50 grid min-w-44 gap-1 rounded-xl border border-line-soft bg-canvas p-2 shadow-lg">
                            {links.map((link) => (
                                <Link key={link.href} href={link.href} className="rounded-lg px-3 py-2 text-sm text-ink hover:bg-[color:var(--brand-100)]">
                                    {link.label}
                                </Link>
                            ))}
                        </nav>
                    </details>
                    {whatsappHref ? (
                        <a href={whatsappHref} className="rounded-full bg-[color:var(--whatsapp)] px-4 py-2 text-sm font-semibold text-white shadow-sm">
                            <MessageCircle aria-hidden="true" className="mr-2 inline" size={16} />WhatsApp
                        </a>
                    ) : null}
                    {phone ? (
                        <a href={`tel:${phone.replace(/[^+\d]/g, '')}`} className="hidden rounded-full border border-[color:var(--brand-700)] px-4 py-2 text-sm font-semibold text-[color:var(--brand-700)] sm:inline-flex">
                            <Phone aria-hidden="true" className="mr-2" size={16} />Call Us
                        </a>
                    ) : null}
                </div>
            </div>
        </header>
    );
}
