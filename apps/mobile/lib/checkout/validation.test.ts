import type { Catalog } from "../api/requests";
import {
    buildOrderPayload,
    checkout422Feedback,
    checkoutDateRange,
    mapApiFieldErrors,
    submitOrderAndClearCart,
    validateCheckout,
    type CheckoutDraft,
} from "./validation";

const catalog = {
    settings: {
        min_order_kg: 40,
        max_order_kg: 20_000,
        min_lead_days: 2,
        time_slots: [{ key: "8-10", label: "8–10 AM" }, { key: "10-12", label: "10 AM–12 PM" }],
    },
} as Catalog;

const validDraft: CheckoutDraft = {
    preferred_date: "2026-10-07",
    time_slot: "8-10",
    fulfilment: "pickup",
    delivery_address: "",
    delivery_landmark: "",
    notes: "",
    customer_name: "Ada Customer",
    phone: "08012345678",
    email: "",
    consent: true,
};

const lines = [{ fish_type: "clarias", size: "2-3kg", size_label: "2–3kg", quantity_kg: 40 }];

describe("checkout validation", () => {
    it.each([
        ["preferred_date", { preferred_date: "" }],
        ["time_slot", { time_slot: "" }],
        ["fulfilment", { fulfilment: "" }],
        ["customer_name", { customer_name: "A" }],
        ["customer_name", { customer_name: "A".repeat(81) }],
        ["phone", { phone: "123" }],
        ["consent", { consent: false }],
    ] as const)("requires valid %s", (field, patch) => {
        const errors = validateCheckout({ ...validDraft, ...patch }, lines, catalog, new Date("2026-10-05T12:00:00Z"));
        expect(errors[field]).toBeTruthy();
    });

    it.each(["08012345678", "+2348012345678", "2348012345678"])(
        "accepts Nigerian phone number %s",
        (phone) => {
            expect(validateCheckout({ ...validDraft, phone }, lines, catalog, new Date("2026-10-05T12:00:00Z")).phone).toBeUndefined();
        },
    );

    it("allows an empty optional email and rejects a malformed one", () => {
        expect(validateCheckout(validDraft, lines, catalog, new Date("2026-10-05T12:00:00Z")).email).toBeUndefined();
        expect(validateCheckout({ ...validDraft, email: "not-an-email" }, lines, catalog, new Date("2026-10-05T12:00:00Z")).email).toBeTruthy();
    });

    it("uses catalog lead time and a 90-day Lagos date window", () => {
        expect(checkoutDateRange(2, new Date("2026-10-05T12:00:00Z"))).toEqual({ min: "2026-10-07", max: "2027-01-03" });
    });

    it("requires delivery addresses of at least 8 characters and caps notes at 500", () => {
        const errors = validateCheckout({
            ...validDraft,
            fulfilment: "delivery",
            delivery_address: "1234567",
            notes: "x".repeat(501),
        }, lines, catalog, new Date("2026-10-05T12:00:00Z"));
        expect(errors.delivery_address).toBeTruthy();
        expect(errors.notes).toBeTruthy();
    });

    it("enforces dynamic catalog minimum and maximum quantities", () => {
        expect(validateCheckout(validDraft, [{ ...lines[0], quantity_kg: 39 }], catalog, new Date("2026-10-05T12:00:00Z")).items).toContain("40 kg");
        expect(validateCheckout(validDraft, [{ ...lines[0], quantity_kg: 20_001 }], catalog, new Date("2026-10-05T12:00:00Z")).items).toContain("20000 kg");
    });

    it("maps only server fields that have corresponding checkout inputs", () => {
        expect(mapApiFieldErrors({
            "items.0.quantity_kg": ["Too small"],
            "items.0.size": ["Unavailable"],
            "server_internal": ["Do not surface this as a form field"],
        })).toEqual({
            "items.0.quantity_kg": "Too small",
            items: "Unavailable",
        });
    });

    it("shows an unmapped 422 detail instead of silently clearing the form", () => {
        expect(checkout422Feedback("Phone number is blocked for this request.", {})).toEqual({
            fieldErrors: { phone: "Phone number is blocked for this request." },
            requestMessage: null,
        });
        expect(checkout422Feedback("Request rejected by server policy.", { internal_policy: ["Rejected"] })).toEqual({
            fieldErrors: {},
            requestMessage: "Request rejected by server policy.",
        });
    });

    it("builds the items[] request body without accepting prices from cart lines", () => {
        expect(buildOrderPayload(validDraft, lines, "turnstile-token")).toEqual({
            items: [{ fish_type: "clarias", size: "2-3kg", quantity_kg: 40 }],
            preferred_date: "2026-10-07",
            time_slot: "8-10",
            fulfilment: "pickup",
            delivery_address: "",
            delivery_landmark: "",
            notes: "",
            customer_name: "Ada Customer",
            phone: "08012345678",
            email: "",
            turnstile_token: "turnstile-token",
        });
    });

    it("reuses the same idempotency key after a retry and clears the cart only on success", async () => {
        const order = { reference: "AF-2026-0001" } as never;
        const createOrder = jest.fn().mockRejectedValueOnce(new Error("network down")).mockResolvedValueOnce(order);
        const clearCart = jest.fn(async () => undefined);
        const firstPayload = buildOrderPayload(validDraft, lines, "first-token");
        const retryPayload = buildOrderPayload(validDraft, lines, "fresh-token");

        await expect(submitOrderAndClearCart(createOrder, clearCart, firstPayload, "one-stable-key")).rejects.toThrow("network down");
        expect(clearCart).not.toHaveBeenCalled();
        await expect(submitOrderAndClearCart(createOrder, clearCart, retryPayload, "one-stable-key")).resolves.toBe(order);

        expect(createOrder.mock.calls.map((call) => call[1])).toEqual(["one-stable-key", "one-stable-key"]);
        expect(createOrder.mock.calls.map((call) => call[0].turnstile_token)).toEqual(["first-token", "fresh-token"]);
        expect(createOrder).toHaveBeenCalledTimes(2);
        expect(clearCart).toHaveBeenCalledTimes(1);
    });
});