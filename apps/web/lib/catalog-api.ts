import { z } from 'zod';
import { unstable_cache, unstable_noStore } from 'next/cache';

const availabilityStatusSchema = z.enum([
    'limited',
    'available',
    'main_stock',
    'sold_out',
    'unavailable',
]);

const fishTypeSchema = z.object({
    slug: z.string(),
    name: z.string(),
    description: z.string(),
    image_path: z.string(),
    sort_order: z.number().int(),
});

const sizeClassSchema = z.object({
    slug: z.string(),
    label: z.string(),
    descriptor: z.string(),
    min_kg: z.coerce.number(),
    max_kg: z.coerce.number().nullable(),
    image_path: z.string(),
    is_featured: z.boolean(),
    is_smoking_size: z.boolean(),
    sort_order: z.number().int(),
    status: availabilityStatusSchema,
    indicative_price_per_kg_kobo: z.number().int().nullable().optional(),
    price_updated_at: z.string().nullable().optional(),
});

const harvestWindowSchema = z.object({
    starts_on: z.string(),
    ends_on: z.string(),
    notes: z.string().nullable(),
});

const catalogSettingsSchema = z.object({
    whatsapp_number: z.string(),
    phone_number: z.string(),
    farm_address: z.string(),
    farm_maps_url: z.string().url().nullable(),
    business_hours: z.array(z.string()),
    min_order_kg: z.number().int(),
    max_order_kg: z.number().int(),
    min_lead_days: z.number().int(),
    time_slots: z.array(z.object({ key: z.string(), label: z.string() })),
    delivery_notice: z.string(),
    announcement_banner: z.string().nullable(),
});

const catalogSchema = z.object({
    fish_types: z.array(fishTypeSchema),
    size_classes: z.array(sizeClassSchema),
    harvest_window: harvestWindowSchema.nullable(),
    settings: catalogSettingsSchema,
});

export type Catalog = z.infer<typeof catalogSchema>;
export type FishType = z.infer<typeof fishTypeSchema>;
export type SizeClass = z.infer<typeof sizeClassSchema>;
export type AvailabilityStatus = z.infer<typeof availabilityStatusSchema>;

const fetchCatalog = unstable_cache(
    async (apiUrl: string): Promise<Catalog> => {
        const response = await fetch(`${apiUrl}/api/v1/catalog`, {
            cache: 'no-store',
            signal: AbortSignal.timeout(5_000),
        });
        if (!response.ok) throw new Error(`Catalog request failed with ${response.status}.`);

        const result = catalogSchema.safeParse(await response.json());
        if (!result.success) throw new Error('Catalog response did not match the public schema.');
        return result.data;
    },
    ['public-catalog'],
    { revalidate: 60, tags: ['catalog'] },
);

export async function getCatalog(): Promise<Catalog | null> {
    const apiUrl = (process.env.API_URL ?? process.env.NEXT_PUBLIC_API_URL ?? 'http://127.0.0.1:8000')
        .replace(/\/$/, '');

    try {
        return await fetchCatalog(apiUrl);
    } catch {
        unstable_noStore();
        return null;
    }
}

export function formatHarvestDate(value: string): string {
    return new Intl.DateTimeFormat('en-US', {
        day: 'numeric',
        month: 'short',
        timeZone: 'Africa/Lagos',
    }).format(new Date(`${value}T00:00:00+01:00`));
}

export function formatPriceUpdatedAt(value: string): string {
    return new Intl.DateTimeFormat('en-NG', {
        day: 'numeric',
        month: 'short',
        timeZone: 'Africa/Lagos',
    }).format(new Date(value));
}
