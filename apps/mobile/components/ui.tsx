import type { PropsWithChildren, ReactNode } from "react";
import { ActivityIndicator, KeyboardAvoidingView, Platform, Pressable, ScrollView, Text, View, type PressableProps, type ScrollViewProps, type StyleProp, type TextProps, type ViewStyle } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { colors, styles } from "../lib/theme";

type ScreenProps = PropsWithChildren<ScrollViewProps> & { scrollRef?: React.RefObject<ScrollView | null> };

export function Screen({ children, contentContainerStyle, scrollRef, ...props }: ScreenProps) {
    const insets = useSafeAreaInsets();
    return (
        <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === "ios" ? "padding" : "height"}>
            <ScrollView
                style={styles.page}
                ref={scrollRef}
                contentContainerStyle={[
                    styles.content,
                    contentContainerStyle,
                    {
                        paddingTop: Math.max(16, insets.top),
                        paddingBottom: Math.max(34, insets.bottom + 8),
                    },
                ]}
                keyboardShouldPersistTaps="handled"
                {...props}
            >
                {children}
            </ScrollView>
        </KeyboardAvoidingView>
    );
}

export function AppText({ children, style, ...props }: TextProps) {
    return <Text style={[styles.body, style]} {...props}>{children}</Text>;
}

export function Panel({ children, style }: PropsWithChildren<{ style?: object }>) {
    return <View style={[styles.panel, style]}>{children}</View>;
}

type ActionButtonProps = PropsWithChildren<Omit<PressableProps, "style"> & {
    icon?: ReactNode;
    secondary?: boolean;
    loading?: boolean;
    style?: StyleProp<ViewStyle>;
}>;

export function ActionButton({ children, icon, secondary = false, loading = false, disabled, style, ...props }: ActionButtonProps) {
    return (
        <Pressable
            accessibilityRole="button"
            disabled={disabled || loading}
            style={({ pressed }) => [secondary ? styles.secondaryButton : styles.button, (disabled || loading) && styles.disabled, pressed && { opacity: 0.8 }, style]}
            {...props}
        >
            {loading ? <ActivityIndicator color={secondary ? colors.leaf : colors.white} /> : icon}
            <Text style={secondary ? styles.secondaryButtonText : styles.buttonText}>{children}</Text>
        </Pressable>
    );
}

const statusColors: Record<string, { background: string; foreground: string; label: string }> = {
    available: { background: "#E7F3DF", foreground: "#386A25", label: "Available" },
    limited: { background: "#FFF2D7", foreground: "#805A0B", label: "Limited" },
    main_stock: { background: colors.forest, foreground: colors.white, label: "Main stock" },
    sold_out: { background: "#EEF0ED", foreground: colors.gray, label: "Sold out" },
    unavailable: { background: colors.white, foreground: colors.gray, label: "Unavailable" },
};

export function StatusPill({ status }: { status: string }) {
    const value = statusColors[status] ?? statusColors.unavailable;
    const label = value.label;
    return (
        <View style={[styles.pill, { backgroundColor: value.background }, status === "unavailable" && { borderWidth: 1, borderColor: colors.border }]}>
            <Text style={{ color: value.foreground, fontSize: 12, fontWeight: "700" }}>{label}</Text>
        </View>
    );
}

export function ErrorNotice({ message, onRetry }: { message: string; onRetry?: () => void }) {
    return (
        <View style={styles.errorPanel}>
            <AppText style={{ color: colors.danger, fontWeight: "700" }}>{message}</AppText>
            {onRetry ? <ActionButton secondary onPress={onRetry}>Try again</ActionButton> : null}
        </View>
    );
}