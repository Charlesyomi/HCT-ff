import * as SecureStore from "expo-secure-store";

export const ACCESS_TOKEN_KEY = "adesoba.access-token";

export interface TokenStorage {
    getItemAsync(key: string): Promise<string | null>;
    setItemAsync(key: string, value: string): Promise<void>;
    deleteItemAsync(key: string): Promise<void>;
}

export const tokenStorage: TokenStorage = SecureStore;

export function saveAccessToken(token: string): Promise<void> {
    return tokenStorage.setItemAsync(ACCESS_TOKEN_KEY, token);
}

export function clearAccessToken(): Promise<void> {
    return tokenStorage.deleteItemAsync(ACCESS_TOKEN_KEY);
}