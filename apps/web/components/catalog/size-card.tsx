import Image from 'next/image';
import Link from 'next/link';
import type { SizeClass } from '@/lib/catalog-api';
import { formatRateKobo } from '@/lib/money';
import { StatusPill } from './status-pill';

export function SizeCard({ size, whatsappNumber }: { size: SizeClass; whatsappNumber: string }) {
    const digits = whatsappNumber.replace(/\D/g, '');
    const askHref = digits
        ? `https://wa.me/${digits}?text=${encodeURIComponent(`Hi Adesoba Farm, is the ${size.label} size available?`)}`
        : '/contact';

    return (
        <article className="relative overflow-hidden rounded-xl border border-line-soft bg-canvas p-4 shadow-sm">
            {size.is_featured ? (
                <span className="absolute right-4 top-4 z-10 rounded-full bg-[color:var(--accent-400)] px-3 py-1 text-[10px] font-bold uppercase tracking-[0.12em] text-ink-on-accent">
                    Most Popular
                </span>
            ) : null}
            <div className="relative aspect-[16/10] overflow-hidden rounded-lg bg-[color:var(--brand-100)]">
                <Image
                    src={size.image_path}
                    alt={`${size.label} catfish`}
                    fill
                    sizes="(max-width: 767px) 100vw, (max-width: 1279px) 50vw, 25vw"
                    className="object-cover"
                />
            </div>
            <div className="mt-4 flex min-h-14 items-start justify-between gap-3">
                <div>
                    <h3 className="font-display text-xl font-bold text-ink">{size.label}</h3>
                    <p className="mt-1 text-sm text-ink-muted">{size.descriptor}</p>
                    {size.indicative_price_per_kg_kobo != null ? (
                        <p className="mt-2 text-sm font-semibold text-brand-900">{formatRateKobo(size.indicative_price_per_kg_kobo)}</p>
                    ) : (
                        <p className="mt-2 text-sm text-ink-muted">Price on request</p>
                    )}
                </div>
                <StatusPill status={size.status} />
            </div>
            {size.status === 'sold_out' ? (
                <a href={askHref} className="mt-5 inline-flex min-h-11 w-full items-center justify-center rounded-full border border-[color:var(--whatsapp)] px-4 py-2.5 text-sm font-semibold text-[color:var(--whatsapp)]">
                    Ask us
                </a>
            ) : (
                <Link
                    href={`/order?size=${encodeURIComponent(size.slug)}`}
                    className="mt-5 inline-flex min-h-11 w-full items-center justify-center rounded-full bg-[color:var(--brand-700)] px-4 py-2.5 text-sm font-semibold text-white transition hover:bg-[color:var(--brand-900)] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[color:var(--brand-700)]"
                >
                    Request
                </Link>
            )}
        </article>
    );
}
