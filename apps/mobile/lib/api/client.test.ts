import { createAuthenticatedFetch, onUnauthorized } from "./client";
import { ACCESS_TOKEN_KEY, type TokenStorage } from "../auth/token";

function storage(token: string | null): TokenStorage {
    return {
        getItemAsync: jest.fn(async () => token),
        setItemAsync: jest.fn(async () => undefined),
        deleteItemAsync: jest.fn(async () => undefined),
    };
}

describe("authenticated API transport", () => {
    it("adds the stored bearer token to API requests", async () => {
        const tokenStorage = storage("access-token");
        const fetcher = jest.fn(async (_input: RequestInfo | URL, init?: RequestInit) => {
            expect(new Headers(init?.headers).get("Authorization")).toBe("Bearer access-token");
            return { status: 200, ok: true } as Response;
        });

        await createAuthenticatedFetch(fetcher, tokenStorage)("https://api.example.test/api/v1/me/orders");

        expect(fetcher).toHaveBeenCalledTimes(1);
        expect(tokenStorage.getItemAsync).toHaveBeenCalledWith(ACCESS_TOKEN_KEY);
    });

    it("preserves existing request headers when adding bearer authentication", async () => {
        const tokenStorage = storage("access-token");
        const fetcher = jest.fn(async (_input: RequestInfo | URL, init?: RequestInit) => {
            const headers = new Headers(init?.headers);
            expect(headers.get("Idempotency-Key")).toBe("checkout-key");
            expect(headers.get("Authorization")).toBe("Bearer access-token");
            return { status: 201, ok: true } as Response;
        });
        const request = new Request("https://api.example.test/api/v1/orders", {
            method: "POST",
            headers: { "Idempotency-Key": "checkout-key" },
        });

        await createAuthenticatedFetch(fetcher, tokenStorage)(request);

        expect(fetcher).toHaveBeenCalledTimes(1);
    });

    it("clears the token and notifies auth when an API response is 401", async () => {
        const tokenStorage = storage("expired-token");
        const fetcher = jest.fn(async () => ({ status: 401, ok: false }) as Response);
        const onSignInRequired = jest.fn();
        const unsubscribe = onUnauthorized(onSignInRequired);

        try {
            await createAuthenticatedFetch(fetcher, tokenStorage)("https://api.example.test/api/v1/me/cart");
            expect(tokenStorage.deleteItemAsync).toHaveBeenCalledWith(ACCESS_TOKEN_KEY);
            expect(onSignInRequired).toHaveBeenCalledTimes(1);
        } finally {
            unsubscribe();
        }
    });
});