import { QueryClient, focusManager } from "@tanstack/react-query";
import { AppState, type AppStateStatus } from "react-native";

export const queryClient = new QueryClient({
    defaultOptions: {
        queries: { staleTime: 15_000, retry: 1, refetchOnReconnect: true },
    },
});

export function setQueryFocus(status: AppStateStatus): void {
    focusManager.setFocused(status === "active");
}

export function subscribeToAppState(): () => void {
    setQueryFocus(AppState.currentState);
    const subscription = AppState.addEventListener("change", setQueryFocus);
    return () => subscription.remove();
}