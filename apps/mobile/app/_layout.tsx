import { useEffect } from "react";
import { Stack } from "expo-router";
import { QueryClientProvider } from "@tanstack/react-query";
import { StatusBar } from "expo-status-bar";
import { SafeAreaProvider } from "react-native-safe-area-context";
import { queryClient, subscribeToAppState } from "../lib/query-client";
import { AuthProvider } from "../lib/auth/context";

export default function RootLayout() {
    useEffect(() => subscribeToAppState(), []);

    return (
        <SafeAreaProvider>
            <QueryClientProvider client={queryClient}>
                <AuthProvider>
                    <StatusBar style="dark" />
                    <Stack screenOptions={{ headerShown: false, contentStyle: { backgroundColor: "#F7F8F3" } }}>
                        <Stack.Screen name="index" />
                        <Stack.Screen name="sign-in" />
                        <Stack.Screen name="(tabs)" />
                        <Stack.Screen name="checkout" options={{ presentation: "card", headerShown: false }} />
                        <Stack.Screen name="order-confirmation" options={{ presentation: "card", headerShown: false }} />
                    </Stack>
                </AuthProvider>
            </QueryClientProvider>
        </SafeAreaProvider>
    );
}