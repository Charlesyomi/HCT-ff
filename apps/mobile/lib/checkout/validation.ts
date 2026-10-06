import type { Catalog, OrderCreateRequest, OrderCreateResponse, OrderItemInput } from "../api/requests";

export const CHECKOUT_FIELDS = [
    "preferred_date",
    "time_slot",
    "fulfilment",
    "delivery_address",
    "delivery_landmark",
    "notes",
    "customer_name",
    "phone",
    "email",
    "consent",
    "items",
] as const;

export type CheckoutField = (typeof CHECKOUT_FIELDS)[number] | `items.${number}.quantity_kg` | "turnstile_token";
export type CheckoutErrors = Partial<Record<CheckoutField, string>>;

export interface CheckoutDraft {
    preferred_date: string;
    time_slot: string;
    fulfilment: "pickup" | "delivery" | "";
    delivery_address: string;
    delivery_landmark: string;
    notes: string;
    customer_name: string;
    phone: string;
    email: string;
    consent: boolean;
}

export interface CheckoutLine {
    fish_type: string;
    size: string;
    size_label: string;
    quantity_kg: number;
}

export function buildOrderPayload(
    draft: CheckoutDraft,
    lines: CheckoutLine[],
    turnstileToken: string,
): OrderCreateRequest {
    const items: OrderItemInput[] = lines.map((line) => ({
        fish_type: line.fish_type === "clarias" || line.fish_type === "hybrid" ? line.fish_type : "any",
        size: line.size,
        quantity_kg: line.quantity_kg,
    }));
    return {
        items,
        preferred_date: draft.preferred_date,
        time_slot: draft.time_slot,
        fulfilment: draft.fulfilment === "delivery" ? "delivery" : "pickup",
        delivery_address: draft.fulfilment === "delivery" ? draft.delivery_address.trim() : "",
        delivery_landmark: draft.fulfilment === "delivery" ? draft.delivery_landmark.trim() : "",
        notes: draft.notes.trim(),
        customer_name: draft.customer_name.trim(),
        phone: draft.phone.trim(),
        email: draft.email.trim(),
        turnstile_token: turnstileToken,
    };
}

export async function submitOrderAndClearCart(
    createOrder: (payload: OrderCreateRequest, idempotencyKey: string) => Promise<OrderCreateResponse>,
    clearCart: () => Promise<void>,
    payload: OrderCreateRequest,
    idempotencyKey: string,
): Promise<OrderCreateResponse> {
    const result = await createOrder(payload, idempotencyKey);
    await clearCart();
    return result;
}

const LAGOS = "Africa/Lagos";

export function lagosDateKey(date: Date): string {
    const parts = new Intl.DateTimeFormat("en-CA", {
        timeZone: LAGOS,
        year: "numeric",
        month: "2-digit",
        day: "2-digit",
    }).formatToParts(date);
    const value = (type: string) => parts.find((part) => part.type === type)?.value ?? "";
    return `${value("year")}-${value("month")}-${value("day")}`;
}

export function addCalendarDays(dateKey: string, days: number): string {
    const [year, month, day] = dateKey.split("-").map(Number);
    const date = new Date(Date.UTC(year, month - 1, day + days));
    return `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, "0")}-${String(date.getUTCDate()).padStart(2, "0")}`;
}

export function checkoutDateRange(minLeadDays: number, now = new Date()): { min: string; max: string } {
    const today = lagosDateKey(now);
    const tomorrow = addCalendarDays(today, 1);
    const leadDate = addCalendarDays(today, Math.max(0, minLeadDays));
    return { min: leadDate > tomorrow ? leadDate : tomorrow, max: addCalendarDays(today, 90) };
}

export function localDateForPicker(dateKey: string): Date {
    const [year, month, day] = dateKey.split("-").map(Number);
    return new Date(Date.UTC(year, month - 1, day, 11));
}

export function validateCheckout(
    draft: CheckoutDraft,
    lines: CheckoutLine[],
    catalog: Catalog,
    now = new Date(),
): CheckoutErrors {
    const errors: CheckoutErrors = {};
    const dateRange = checkoutDateRange(catalog.settings.min_lead_days, now);
    if (!draft.preferred_date || draft.preferred_date < dateRange.min || draft.preferred_date > dateRange.max) {
        errors.preferred_date = `Choose a date between ${dateRange.min} and ${dateRange.max}.`;
    }
    if (!catalog.settings.time_slots.some((slot) => slot.key === draft.time_slot)) {
        errors.time_slot = "Choose a time slot.";
    }
    if (draft.fulfilment !== "pickup" && draft.fulfilment !== "delivery") {
        errors.fulfilment = "Choose pickup or delivery.";
    }
    if (draft.fulfilment === "delivery" && draft.delivery_address.trim().length < 8) {
        errors.delivery_address = "Enter a delivery address of at least 8 characters.";
    }
    if (draft.notes.length > 500) errors.notes = "Notes must be 500 characters or fewer.";
    if (draft.customer_name.trim().length < 2 || draft.customer_name.trim().length > 80) {
        errors.customer_name = "Enter your name (2 to 80 characters).";
    }

    const phone = draft.phone.replace(/[\s()-]/g, "");
    if (!/^(?:0\d{10}|\+234\d{10}|234\d{10})$/.test(phone)) {
        errors.phone = "Enter a valid Nigerian phone number, such as 08012345678.";
    }
    if (draft.email.trim() && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(draft.email.trim())) {
        errors.email = "Enter a valid email address or leave this blank.";
    }
    if (!draft.consent) errors.consent = "Confirm that the farm may contact you about this request.";
    if (lines.length === 0) errors.items = "Add at least one fish size to your cart.";

    let totalKg = 0;
    lines.forEach((line, index) => {
        totalKg += line.quantity_kg;
        if (!Number.isInteger(line.quantity_kg) || line.quantity_kg < 1) {
            errors[`items.${index}.quantity_kg`] = "Enter a whole-number quantity of at least 1 kg.";
        }
    });
    if (lines.length > 0 && totalKg < catalog.settings.min_order_kg) {
        errors.items = `The minimum order is ${catalog.settings.min_order_kg} kg. Add more fish to continue.`;
    } else if (totalKg > catalog.settings.max_order_kg) {
        errors.items = `The maximum order is ${catalog.settings.max_order_kg} kg.`;
    }
    return errors;
}

export function mapApiFieldErrors(fields: Record<string, string[]>): CheckoutErrors {
    const mapped: CheckoutErrors = {};
    for (const [key, messages] of Object.entries(fields)) {
        const message = messages.find(Boolean);
        if (!message) continue;
        if ((CHECKOUT_FIELDS as readonly string[]).includes(key)) {
            mapped[key as CheckoutField] = message;
        } else if (/^items\.\d+\.quantity_kg$/.test(key)) {
            mapped[key as `items.${number}.quantity_kg`] = message;
        } else if (/^items\.\d+\.(size|fish_type)$/.test(key) || key === "items") {
            mapped.items = message;
        } else if (key === "turnstile_token") {
            mapped.turnstile_token = message;
        }
    }
    return mapped;
}

export function checkout422Feedback(
    message: string,
    fields: Record<string, string[]>,
): { fieldErrors: CheckoutErrors; requestMessage: string | null } {
    const fieldErrors = mapApiFieldErrors(fields);
    if (/spam check|turnstile/i.test(message)) {
        fieldErrors.turnstile_token = "Complete the security check again.";
    } else if (Object.keys(fieldErrors).length === 0) {
        if (/phone/i.test(message)) fieldErrors.phone = message;
        else if (/date/i.test(message)) fieldErrors.preferred_date = message;
        else if (/size|quantity|order line|minimum|maximum/i.test(message)) fieldErrors.items = message;
        else if (/delivery address/i.test(message)) fieldErrors.delivery_address = message;
    }

    return {
        fieldErrors,
        requestMessage: Object.keys(fieldErrors).length === 0
            ? message || "The server rejected the quote request without identifying a field."
            : null,
    };
}