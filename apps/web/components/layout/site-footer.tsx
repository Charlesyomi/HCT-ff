import { getCatalog } from '@/lib/catalog-api';

export async function SiteFooter() {
    const catalog = await getCatalog();
    const settings = catalog?.settings;
    const phone = settings?.phone_number;
    const whatsappDigits = settings?.whatsapp_number.replace(/\D/g, '');

    return (
        <footer className="bg-[color:var(--brand-900)] text-ink-on-dark">
            <div className="mx-auto grid max-w-7xl gap-8 px-4 py-12 md:grid-cols-3 md:px-8 lg:px-12">
                <div>
                    <p className="font-display text-2xl font-bold">Adesoba</p>
                    <p className="mt-3 max-w-xs text-sm text-ink-on-dark">
                        Healthy Fish. Better Business. Fresh catfish direct from our farm.
                        {settings ? <span className="mt-2 block">{settings.farm_address}</span> : null}
                    </p>
                </div>
                <div>
                    <p className="text-sm font-semibold uppercase tracking-[0.2em] text-ink-hero">Quick links</p>
                    <ul className="mt-4 space-y-2 text-sm text-ink-on-dark">
                        <li><a href="/order">Order Fish</a></li>
                        <li><a href="/our-fish">Our Fish</a></li>
                        <li><a href="/about">About Us</a></li>
                        <li><a href="/contact">Contact</a></li>
                        <li><a href="/privacy">Privacy Policy</a></li>
                        <li><a href="/terms">Terms</a></li>
                    </ul>
                </div>
                <div>
                    <p className="text-sm font-semibold uppercase tracking-[0.2em] text-ink-hero">Connect</p>
                    <ul className="mt-4 space-y-2 text-sm text-ink-on-dark">
                        {phone ? <li><a href={`tel:${phone.replace(/[^+\d]/g, '')}`}>Call us</a></li> : null}
                        {whatsappDigits ? <li><a href={`https://wa.me/${whatsappDigits}`}>WhatsApp</a></li> : null}
                        <li>© {new Date().getFullYear()} Adesoba</li>
                    </ul>
                </div>
            </div>
        </footer>
    );
}
