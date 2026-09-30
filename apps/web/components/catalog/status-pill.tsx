import type { AvailabilityStatus } from '@/lib/catalog-api';

const labels: Record<AvailabilityStatus, string> = {
    limited: 'Limited',
    available: 'Available',
    main_stock: 'Main stock',
    sold_out: 'Sold out',
    unavailable: 'Unavailable',
};

const styles: Record<AvailabilityStatus, string> = {
    limited: 'border-transparent bg-status-limited-bg text-status-limited-text',
    available: 'border-transparent bg-status-available-bg text-status-available-text',
    main_stock: 'border-transparent bg-[color:var(--brand-900)] text-white',
    sold_out: 'border-transparent bg-status-sold-out-bg text-status-neutral-text',
    unavailable: 'border-status-unavailable-border bg-canvas text-status-neutral-text',
};

export function StatusPill({ status }: { status: AvailabilityStatus }) {
    return (
        <span className={`inline-flex min-h-7 items-center rounded-full border px-3 text-xs font-semibold ${styles[status]}`}>
            {labels[status]}
        </span>
    );
}
