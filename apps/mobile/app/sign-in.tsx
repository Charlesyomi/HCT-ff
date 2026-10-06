import { useState } from "react";
import { View } from "react-native";
import { MaterialCommunityIcons } from "@expo/vector-icons";
import { Redirect } from "expo-router";
import { ActionButton, AppText, ErrorNotice, Panel, Screen } from "../components/ui";
import { BrandLockup } from "../components/brand-lockup";
import { useAuth } from "../lib/auth/context";
import { colors, styles } from "../lib/theme";

export default function SignInScreen() {
    const { signIn, token } = useAuth();
    const [busy, setBusy] = useState(false);
    const [error, setError] = useState<string | null>(null);

    async function continueWithGoogle() {
        setBusy(true);
        setError(null);
        try {
            await signIn();
        } catch (cause) {
            setError(cause instanceof Error ? cause.message : "Sign-in could not be completed. Please try again.");
        } finally {
            setBusy(false);
        }
    }

    if (token) return <Redirect href="/(tabs)/catalog" />;

    return (
        <Screen contentContainerStyle={[styles.content, { flexGrow: 1, justifyContent: "center", paddingBottom: 48 }]}>
            <View style={{ alignItems: "center", gap: 14, marginBottom: 20 }}>
                <View style={{ width: 76, height: 76, borderRadius: 24, backgroundColor: colors.forest, alignItems: "center", justifyContent: "center" }}>
                    <MaterialCommunityIcons name="fish" size={42} color={colors.amber} />
                </View>
                <BrandLockup centered />
                <AppText style={[styles.heading, { textAlign: "center" }]}>Fresh fish, from our farm</AppText>
                <AppText style={[styles.muted, { textAlign: "center", maxWidth: 290 }]}>Sign in to manage your cart and keep up with your orders.</AppText>
            </View>
            <Panel>
                <AppText style={styles.subheading}>Welcome back</AppText>
                {error ? <ErrorNotice message={error} /> : null}
                <ActionButton loading={busy} onPress={continueWithGoogle} icon={<MaterialCommunityIcons name="google" size={20} color={colors.white} />}>
                    Continue with Google
                </ActionButton>
            </Panel>
        </Screen>
    );
}