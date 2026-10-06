import { createContext, useContext, useEffect, useState, type PropsWithChildren } from "react";
import { useRouter } from "expo-router";
import { useQueryClient } from "@tanstack/react-query";
import { api, onUnauthorized } from "../api/client";
import { apiError } from "../api/errors";
import { clearAccessToken, tokenStorage, ACCESS_TOKEN_KEY } from "./token";
import { signInWithGoogle } from "./sign-in";

interface AuthValue {
    token: string | null | undefined;
    signIn(): Promise<void>;
    signOut(): Promise<void>;
}

const AuthContext = createContext<AuthValue | null>(null);

export function AuthProvider({ children }: PropsWithChildren) {
    const [token, setToken] = useState<string | null | undefined>(undefined);
    const router = useRouter();
    const queryClient = useQueryClient();

    useEffect(() => {
        let mounted = true;
        void tokenStorage.getItemAsync(ACCESS_TOKEN_KEY).then((stored) => {
            if (mounted) setToken(stored);
        });
        const unsubscribe = onUnauthorized(() => {
            void clearAccessToken();
            queryClient.clear();
            setToken(null);
            router.replace("/sign-in");
        });
        return () => {
            mounted = false;
            unsubscribe();
        };
    }, [queryClient, router]);

    async function signIn(): Promise<void> {
        const stored = await signInWithGoogle();
        setToken(stored);
    }

    async function signOut(): Promise<void> {
        let requestError: unknown;
        try {
            const { error, response } = await api.POST("/api/v1/auth/logout");
            if (!response.ok) throw apiError(response.status, error);
        } catch (error) {
            requestError = error;
        } finally {
            await clearAccessToken();
            queryClient.clear();
            setToken(null);
            router.replace("/sign-in");
        }
        if (requestError) throw requestError;
    }

    return <AuthContext.Provider value={{ token, signIn, signOut }}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthValue {
    const value = useContext(AuthContext);
    if (!value) throw new Error("useAuth must be used inside AuthProvider.");
    return value;
}