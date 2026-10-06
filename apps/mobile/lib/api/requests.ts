import { api } from "./client";
import { apiError } from "./errors";
import type { components } from "./schema";

export type Catalog = components["schemas"]["CatalogResponse"];
export type CatalogSize = components["schemas"]["SizeClassPublic"];
export type Account = components["schemas"]["AccountMeResponse"];
export type AccountOrder = components["schemas"]["AccountOrderItem"];
export type CartLine = components["schemas"]["CartLine"];
export type CartLineInput = components["schemas"]["CartLineInput"];
export type CartResponse = components["schemas"]["CartResponse"];
export type CartUpdateRequest = components["schemas"]["CartUpdateRequest"];
export type OrderCreateRequest = components["schemas"]["OrderCreateRequest"];
export type OrderCreateResponse = components["schemas"]["OrderCreateResponse"];
export type OrderItemInput = components["schemas"]["OrderItemInput"];

export async function getCatalog(): Promise<Catalog> {
    const { data, error, response } = await api.GET("/api/v1/catalog");
    if (!response.ok) throw apiError(response.status, error);
    if (!data) throw new Error("The catalogue response was empty.");
    return data;
}

export async function getAccount(): Promise<Account> {
    const { data, error, response } = await api.GET("/api/v1/auth/me");
    if (!response.ok) throw apiError(response.status, error);
    if (!data) throw new Error("The account response was empty.");
    return data;
}

export async function getOrders(): Promise<AccountOrder[]> {
    const { data, error, response } = await api.GET("/api/v1/me/orders");
    if (!response.ok) throw apiError(response.status, error);
    return data?.orders ?? [];
}

export async function getCart(): Promise<CartResponse> {
    const { data, error, response } = await api.GET("/api/v1/me/cart");
    if (!response.ok) throw apiError(response.status, error);
    if (!data) throw new Error("The cart response was empty.");
    return data;
}

export async function putCart(payload: CartUpdateRequest): Promise<CartResponse> {
    const { data, error, response } = await api.PUT("/api/v1/me/cart", { body: payload });
    if (!response.ok) throw apiError(response.status, error);
    if (!data) throw new Error("The cart update response was empty.");
    return data;
}

export async function deleteCart(): Promise<void> {
    const { error, response } = await api.DELETE("/api/v1/me/cart");
    if (!response.ok) throw apiError(response.status, error);
}

export async function createOrder(payload: OrderCreateRequest, idempotencyKey: string): Promise<OrderCreateResponse> {
    const { data, error, response } = await api.POST("/api/v1/orders", {
        params: { header: { "Idempotency-Key": idempotencyKey } },
        body: payload,
    });
    if (!response.ok) throw apiError(response.status, error);
    if (!data) throw new Error("The order response was empty.");
    return data;
}