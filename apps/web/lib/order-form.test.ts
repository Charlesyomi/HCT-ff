import { describe, expect, it } from 'vitest';
import { createOrderFormSchema, orderFormSchema } from './order-form';

function preferredDate(daysAhead: number): string {
    const parts = new Intl.DateTimeFormat('en-US', {
        timeZone: 'Africa/Lagos',
        year: 'numeric',
        month: '2-digit',
        day: '2-digit',
    }).formatToParts(new Date());
    const values = Object.fromEntries(parts.map(({ type, value }) => [type, value]));
    return new Date(Date.UTC(
        Number(values.year),
        Number(values.month) - 1,
        Number(values.day) + daysAhead,
    )).toISOString().slice(0, 10);
}

describe('orderFormSchema', () => {
    it('accepts a valid pickup order with default minimum values', () => {
        const result = orderFormSchema.safeParse({
            fish_type: 'clarias',
            size: '2-3kg',
            quantity_kg: 40,
            preferred_date: preferredDate(2),
            time_slot: '8-10',
            fulfilment: 'pickup',
            notes: 'Fresh and healthy',
            customer_name: 'Ada Okafor',
            phone: '+2348012345678',
            email: 'ada@example.com',
        });

        expect(result.success).toBe(true);
    });

    it('rejects delivery orders without an address', () => {
        const result = orderFormSchema.safeParse({
            fish_type: 'hybrid',
            size: '1-1-5kg',
            quantity_kg: 200,
            preferred_date: preferredDate(2),
            time_slot: '10-12',
            fulfilment: 'delivery',
            notes: '',
            customer_name: 'Ada Okafor',
            phone: '08012345678',
            email: '',
            delivery_address: '',
        });

        expect(result.success).toBe(false);
    });

    it('uses catalog-specific limits, time slots, and selectable size slugs', () => {
        const schema = createOrderFormSchema({
            minOrderKg: 100,
            maxOrderKg: 500,
            minLeadDays: 3,
            timeSlotKeys: ['10-12'],
            selectableSizeSlugs: ['2-3kg'],
        });
        const order = {
            fish_type: 'hybrid',
            size: '2-3kg',
            quantity_kg: 100,
            preferred_date: preferredDate(3),
            time_slot: '10-12',
            fulfilment: 'pickup',
            notes: '',
            customer_name: 'Ada Okafor',
            phone: '08012345678',
            email: '',
        };

        expect(schema.safeParse(order).success).toBe(true);
        expect(schema.safeParse({ ...order, quantity_kg: 40 }).success).toBe(false);
        expect(schema.safeParse({ ...order, time_slot: '8-10' }).success).toBe(false);
        expect(schema.safeParse({ ...order, size: '3kg-plus' }).success).toBe(false);
        expect(schema.safeParse({ ...order, preferred_date: preferredDate(1) }).success).toBe(false);
    });
});
