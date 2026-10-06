import { ApiError } from "../api/errors";
import type { CartLine, CartLineInput, CartResponse, CartUpdateRequest } from "../api/requests";

export type CartChange =
    | { type: "add"; line: CartLineInput }
    | { type: "set-quantity"; line: Pick<CartLineInput, "fish_type" | "size">; quantityKg: number }
    | { type: "remove"; line: Pick<CartLineInput, "fish_type" | "size"> };

export interface CartGateway {
    read(): Promise<CartResponse>;
    write(payload: CartUpdateRequest): Promise<CartResponse>;
    clear(): Promise<void>;
}

function sameLine(left: Pick<CartLine, "fish_type" | "size">, right: Pick<CartLine, "fish_type" | "size">): boolean {
    return left.fish_type === right.fish_type && left.size === right.size;
}

export function applyCartChange(lines: CartLine[], change: CartChange): CartLineInput[] {
    if (change.type === "remove") {
        return lines.filter((line) => !sameLine(line, change.line)).map(toInput);
    }

    const updated = lines.map(toInput);
    const index = updated.findIndex((line) => sameLine(line, change.line));
    if (change.type === "add") {
        if (index === -1) updated.push(change.line);
        else {
            const current = updated[index];
            updated[index] = { ...current, quantity_kg: current.quantity_kg + change.line.quantity_kg };
        }
    } else if (index === -1) {
        updated.push({ ...change.line, quantity_kg: Math.max(1, change.quantityKg) });
    } else {
        updated[index] = { ...updated[index], quantity_kg: Math.max(1, change.quantityKg) };
    }
    return updated;
}

function toInput(line: CartLine): CartLineInput {
    const fishType = line.fish_type === "clarias" || line.fish_type === "hybrid" || line.fish_type === "any"
        ? line.fish_type
        : "any";
    return { fish_type: fishType, size: line.size, quantity_kg: line.quantity_kg };
}

export async function syncCartChange(
    gateway: CartGateway,
    change: CartChange,
    maxConflicts = 3,
): Promise<CartResponse> {
    let current = await gateway.read();

    for (let attempt = 0; attempt < maxConflicts; attempt += 1) {
        const items = applyCartChange(current.items, change);
        if (items.length === 0) {
            await gateway.clear();
            return gateway.read();
        }

        try {
            return await gateway.write({ items, expected_version: current.version });
        } catch (error) {
            if (!(error instanceof ApiError) || error.status !== 409 || attempt === maxConflicts - 1) {
                throw error;
            }
            current = await gateway.read();
        }
    }

    throw new Error("The cart changed on another device. Please try again.");
}

export function formatNaira(kobo: number | null | undefined): string {
    if (kobo == null) return "Price on request";
    return `₦${new Intl.NumberFormat("en-NG", { maximumFractionDigits: 2 }).format(kobo / 100)}`;
}