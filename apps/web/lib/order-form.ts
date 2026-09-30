import { z } from 'zod';

const defaultTimeSlotKeys = ['8-10', '10-12', '12-2', '2-4', '4-6'] as const;

export type OrderFormSchemaOptions = {
    minOrderKg?: number;
    maxOrderKg?: number;
    minLeadDays?: number;
    timeSlotKeys?: readonly string[];
    selectableSizeSlugs?: readonly string[];
};

export const deliveryAddressSchema = z
    .string()
    .trim()
    .min(8, 'Enter a delivery address or area of at least 8 characters.');

function lagosDateOffset(days: number): number {
    const parts = new Intl.DateTimeFormat('en-US', {
        timeZone: 'Africa/Lagos',
        year: 'numeric',
        month: '2-digit',
        day: '2-digit',
    }).formatToParts(new Date());
    const values = Object.fromEntries(parts.map(({ type, value }) => [type, value]));
    return Date.UTC(
        Number(values.year),
        Number(values.month) - 1,
        Number(values.day) + days,
    );
}

export function defaultPreferredDate(minLeadDays = 1): string {
    return new Date(lagosDateOffset(minLeadDays)).toISOString().slice(0, 10);
}

function parseDateOnly(value: string): number | null {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return null;

    const [year, month, day] = value.split('-').map(Number);
    const timestamp = Date.UTC(year, month - 1, day);
    const parsed = new Date(timestamp);

    return parsed.getUTCFullYear() === year &&
        parsed.getUTCMonth() === month - 1 &&
        parsed.getUTCDate() === day
        ? timestamp
        : null;
}

export function createOrderFormSchema(options: OrderFormSchemaOptions = {}) {
    const minOrderKg = options.minOrderKg ?? 40;
    const maxOrderKg = options.maxOrderKg ?? 20_000;
    const minLeadDays = options.minLeadDays ?? 1;
    const timeSlotKeys = options.timeSlotKeys ?? defaultTimeSlotKeys;

    return z
        .object({
            fish_type: z.enum(['clarias', 'hybrid', 'any']),
            size: z
                .string()
                .nullable()
                .transform((slug) => slug ?? '')
                .pipe(
                    z
                        .string()
                        .trim()
                        .min(1, 'Choose a fish size.')
                        .refine(
                            (slug) => !options.selectableSizeSlugs || options.selectableSizeSlugs.includes(slug),
                            'Choose a size that is currently available.',
                        ),
                ),
            quantity_kg: z.number().int().min(minOrderKg).max(maxOrderKg),
            custom_quantity_kg: z
                .union([z.number().int(), z.literal('')])
                .transform((value) => value === '' ? undefined : value)
                .optional(),
            preferred_date: z.string(),
            time_slot: z.string().refine((key) => timeSlotKeys.includes(key), 'Choose a time slot.'),
            fulfilment: z.enum(['pickup', 'delivery']),
            notes: z.string().max(500).default(''),
            customer_name: z.string().trim().min(2).max(80),
            phone: z
                .string()
                .trim()
                .refine(
                    (value) => /^(?:\+234|234|0)[789]\d{9}$/.test(value.replace(/[\s()-]/g, '')),
                    'Enter a valid Nigerian phone number.',
                )
                .transform((value) => value.replace(/[\s()-]/g, '')),
            email: z
                .string()
                .trim()
                .refine((value) => value === '' || z.email().safeParse(value).success, {
                    message: 'Enter a valid email address.',
                })
                .default(''),
            delivery_address: z.string().trim().default(''),
            delivery_landmark: z.string().trim().default(''),
        })
        .superRefine((order, context) => {
            const preferredDate = parseDateOnly(order.preferred_date);
            if (preferredDate === null) {
                context.addIssue({
                    code: 'custom',
                    path: ['preferred_date'],
                    message: 'Enter a valid date.',
                });
            } else if (
                preferredDate < lagosDateOffset(minLeadDays) ||
                preferredDate > lagosDateOffset(90)
            ) {
                context.addIssue({
                    code: 'custom',
                    path: ['preferred_date'],
                    message: `Choose a date at least ${minLeadDays} day${minLeadDays === 1 ? '' : 's'} from now and within 90 days.`,
                });
            }

            if (order.fulfilment === 'delivery' && order.delivery_address.length < 8) {
                const addressResult = deliveryAddressSchema.safeParse(order.delivery_address);
                context.addIssue({
                    code: 'custom',
                    path: ['delivery_address'],
                    message: addressResult.error?.issues[0]?.message ?? 'Enter a delivery address or area of at least 8 characters.',
                });
            }
        });
}

export const orderFormSchema = createOrderFormSchema();

export type OrderFormValues = z.infer<typeof orderFormSchema>;
export type OrderFormInput = z.input<typeof orderFormSchema>;