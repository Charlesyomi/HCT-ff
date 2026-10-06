import { ApiError } from "../api/errors";
import type { CartLine, CartResponse } from "../api/requests";
import { applyCartChange, syncCartChange, type CartGateway } from "./store";

function line(size: string, quantity: number): CartLine {
    return {
        fish_type: "clarias",
        size,
        size_label: size,
        quantity_kg: quantity,
        indicative_unit_price_kobo: 5_000,
        line_total_kobo: quantity * 5_000,
    };
}

function cart(version: number, items: CartLine[]): CartResponse {
    return {
        version,
        items,
        updated_at: null,
        indicative_total_kobo: items.reduce((total, item) => total + (item.line_total_kobo ?? 0), 0),
    };
}

describe("server cart reconciliation", () => {
    it("merges repeated size additions without losing other lines", () => {
        const merged = applyCartChange(
            [line("2-3kg", 40), line("3kg-plus", 50)],
            { type: "add", line: { fish_type: "clarias", size: "2-3kg", quantity_kg: 20 } },
        );

        expect(merged).toEqual([
            { fish_type: "clarias", size: "2-3kg", quantity_kg: 60 },
            { fish_type: "clarias", size: "3kg-plus", quantity_kg: 50 },
        ]);
    });

    it("re-reads on 409 and reapplies the same user change over newer server data", async () => {
        const before = cart(1, [line("2-3kg", 40)]);
        const newer = cart(2, [line("2-3kg", 40), line("3kg-plus", 30)]);
        const saved = cart(3, [line("2-3kg", 60), line("3kg-plus", 30)]);
        const gateway: CartGateway = {
            read: jest.fn().mockResolvedValueOnce(before).mockResolvedValueOnce(newer),
            write: jest.fn().mockRejectedValueOnce(new ApiError("Cart version mismatch", 409)).mockResolvedValueOnce(saved),
            clear: jest.fn(async () => undefined),
        };

        const result = await syncCartChange(gateway, {
            type: "add",
            line: { fish_type: "clarias", size: "2-3kg", quantity_kg: 20 },
        });

        expect(gateway.read).toHaveBeenCalledTimes(2);
        expect(gateway.write).toHaveBeenNthCalledWith(1, {
            expected_version: 1,
            items: [{ fish_type: "clarias", size: "2-3kg", quantity_kg: 60 }],
        });
        expect(gateway.write).toHaveBeenNthCalledWith(2, {
            expected_version: 2,
            items: [
                { fish_type: "clarias", size: "2-3kg", quantity_kg: 60 },
                { fish_type: "clarias", size: "3kg-plus", quantity_kg: 30 },
            ],
        });
        expect(result).toBe(saved);
    });
});