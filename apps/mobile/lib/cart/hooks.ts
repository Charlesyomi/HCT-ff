import { useCallback, useEffect, useRef, useState } from "react";
import { AppState } from "react-native";
import { useFocusEffect } from "expo-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { deleteCart, getCart, putCart, type CartResponse } from "../api/requests";
import { ApiError } from "../api/errors";
import { syncCartChange, type CartChange, type CartGateway } from "./store";
import { useAuth } from "../auth/context";

export const CART_QUERY_KEY = ["account", "cart"] as const;

const gateway: CartGateway = { read: getCart, write: putCart, clear: deleteCart };

function errorText(error: unknown): string {
    if (error instanceof Error) return error.message;
    return "Your cart could not be saved. Please try again.";
}

export function useCart(isCartScreen = false) {
    const { token } = useAuth();
    const queryClient = useQueryClient();
    const [foreground, setForeground] = useState(AppState.currentState === "active");
    const [screenFocused, setScreenFocused] = useState(!isCartScreen);
    const [syncState, setSyncState] = useState<"synced" | "saving" | "error">("synced");
    const [syncError, setSyncError] = useState<string | null>(null);
    const [lastChange, setLastChange] = useState<CartChange | null>(null);
    const mutationQueue = useRef<Promise<void>>(Promise.resolve());
    const changeSequence = useRef(0);

    const query = useQuery({
        queryKey: CART_QUERY_KEY,
        queryFn: async (): Promise<CartResponse> => {
            const beforeRequest = queryClient.getQueryData<CartResponse>(CART_QUERY_KEY);
            const next = await getCart();
            const current = queryClient.getQueryData<CartResponse>(CART_QUERY_KEY);
            const serverEmpty = next.version === 0 && next.items.length === 0;
            if (current && current !== beforeRequest && current.version > next.version) return current;
            return current && current.version > next.version && !serverEmpty ? current : next;
        },
        enabled: Boolean(token),
        refetchInterval: isCartScreen && foreground && screenFocused && syncState !== "saving" ? 3_000 : false,
        refetchIntervalInBackground: false,
    });
    const refetchCart = query.refetch;

    useFocusEffect(
        useCallback(() => {
            if (!isCartScreen) return;
            setScreenFocused(true);
            return () => setScreenFocused(false);
        }, [isCartScreen]),
    );

    useEffect(() => {
        const subscription = AppState.addEventListener("change", (state) => {
            const active = state === "active";
            setForeground(active);
            if (active && isCartScreen && screenFocused) void refetchCart();
        });
        return () => subscription.remove();
    }, [isCartScreen, refetchCart, screenFocused]);

    useEffect(() => {
        if (isCartScreen && foreground && screenFocused) void refetchCart();
    }, [foreground, isCartScreen, refetchCart, screenFocused]);

    async function saveChange(change: CartChange): Promise<void> {
        const sequence = changeSequence.current + 1;
        changeSequence.current = sequence;
        setLastChange(change);
        setSyncState("saving");
        setSyncError(null);

        const operation = mutationQueue.current.then(async () => {
            await queryClient.cancelQueries({ queryKey: CART_QUERY_KEY });
            const beforeSave = queryClient.getQueryData<CartResponse>(CART_QUERY_KEY);
            const result = await syncCartChange(gateway, change);
            queryClient.setQueryData<CartResponse>(CART_QUERY_KEY, (previous) =>
                previous && previous !== beforeSave && previous.version > result.version
                    ? previous
                    : previous && previous.version > result.version && !(result.version === 0 && result.items.length === 0)
                        ? previous
                        : result,
            );
        });
        mutationQueue.current = operation.catch(() => undefined);

        try {
            await operation;
            if (sequence === changeSequence.current) setSyncState("synced");
        } catch (error) {
            if (sequence === changeSequence.current) {
                setSyncState("error");
                setSyncError(errorText(error));
            }
            if (error instanceof ApiError && error.status === 409) void query.refetch();
            throw error;
        }
    }

    async function retry(): Promise<void> {
        if (lastChange) await saveChange(lastChange);
        else await query.refetch();
    }

    return { ...query, changeCart: saveChange, retry, syncState, syncError };
}