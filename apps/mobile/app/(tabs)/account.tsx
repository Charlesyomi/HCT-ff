import { useQuery } from "@tanstack/react-query";
import { MaterialCommunityIcons } from "@expo/vector-icons";
import { useState } from "react";
import { View } from "react-native";
import { ActionButton, AppText, ErrorNotice, Panel, Screen } from "../../components/ui";
import { getAccount } from "../../lib/api/requests";
import { useAuth } from "../../lib/auth/context";
import { colors, styles } from "../../lib/theme";

export default function AccountScreen() {
    const account = useQuery({ queryKey: ["account", "me"], queryFn: getAccount });
    const { signOut } = useAuth();
    const [signOutError, setSignOutError] = useState<string | null>(null);
    const [busy, setBusy] = useState(false);

    async function leaveAccount() {
        setBusy(true);
        setSignOutError(null);
        try {
            await signOut();
        } catch (error) {
            setSignOutError(error instanceof Error ? error.message : "Sign-out could not reach the server.");
        } finally {
            setBusy(false);
        }
    }

    if (account.isPending) return <Screen><AppText>Loading your account…</AppText></Screen>;
    if (account.isError) return <Screen><ErrorNotice message={account.error.message} onRetry={() => void account.refetch()} /></Screen>;

    return (
        <Screen>
            <View style={{ gap: 4 }}>
                <AppText style={styles.heading}>Your account</AppText>
                <AppText style={styles.muted}>Signed in with Google</AppText>
            </View>
            <Panel style={{ alignItems: "center", paddingVertical: 24 }}>
                <MaterialCommunityIcons name="account-circle" size={62} color={colors.leaf} />
                <AppText style={styles.subheading}>{account.data.name || "HCT Fish Farms customer"}</AppText>
                <AppText style={styles.muted}>{account.data.email}</AppText>
            </Panel>
            {signOutError ? <ErrorNotice message={signOutError} /> : null}
            <ActionButton secondary loading={busy} icon={<MaterialCommunityIcons name="logout" size={19} color={colors.forest} />} onPress={() => void leaveAccount()}>
                Sign out
            </ActionButton>
        </Screen>
    );
}