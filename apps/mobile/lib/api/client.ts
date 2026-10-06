import createClient from "openapi-fetch";
import type { paths } from "./schema";
import { API_URL } from "../config";
import { ACCESS_TOKEN_KEY, tokenStorage, type TokenStorage } from "../auth/token";

type UnauthorizedHandler = () => void;

const unauthorizedHandlers = new Set<UnauthorizedHandler>();

export function onUnauthorized(handler: UnauthorizedHandler): () => void {
    unauthorizedHandlers.add(handler);
    return () => unauthorizedHandlers.delete(handler);
}

export function createAuthenticatedFetch(
    fetcher: typeof fetch,
    storage: TokenStorage,
): typeof fetch {
    return async (input, init) => {
        const token = await storage.getItemAsync(ACCESS_TOKEN_KEY);
        const headers = new Headers(input instanceof Request ? input.headers : undefined);
        new Headers(init?.headers).forEach((value, name) => headers.set(name, value));
        if (token) headers.set("Authorization", `Bearer ${token}`);

        const response = await fetcher(input, { ...init, headers });
        if (response.status === 401) {
            await storage.deleteItemAsync(ACCESS_TOKEN_KEY);
            unauthorizedHandlers.forEach((handler) => handler());
        }
        return response;
    };
}

export function createApiClient(fetcher: typeof fetch, storage: TokenStorage) {
    return createClient<paths>({
        baseUrl: API_URL,
        fetch: createAuthenticatedFetch(fetcher, storage),
    });
}

export const api = createApiClient(fetch, tokenStorage);