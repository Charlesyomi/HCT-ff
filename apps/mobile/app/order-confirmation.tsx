import { useQuery } from "@tanstack/react-query";
import { MaterialCommunityIcons } from "@expo/vector-icons";
import { View } from "react-native";
import { useLocalSearchParams, useRouter } from "expo-router";
import * as Linking from "expo-linking";
import { ActionButton, AppText, Panel, Screen } from "../components/ui";
import { getCatalog } from "../lib/api/requests";
import { colors, styles } from "../lib/theme";

export default function OrderConfirmationScreen() {
    const { reference } = useLocalSearchParams<{ reference?: string }>();
    const router = useRouter();
    const catalog = useQuery({ queryKey: ["catalog"], queryFn: getCatalog });
    const number = (catalog.data?.settings.whatsapp_number ?? "").replace(/\D/g, "");
    const message = encodeURIComponent(`Hi HCT Fish Farms, I just sent quote request ${reference ?? ""}. Please let me know when it has been reviewed.`);
    const whatsappUrl = `https://wa.me/${number}?text=${message}`;

    return (
        <Screen contentContainerStyle={{ flexGrow: 1, justifyContent: "center" }}>
            <Panel style={{ alignItems: "center", paddingVertical: 26 }}>
                <View style={{ width: 72, height: 72, borderRadius: 36, backgroundColor: colors.mint, alignItems: "center", justifyContent: "center" }}>
                    <MaterialCommunityIcons name="check" size={40} color={colors.leaf} />
                </View>
                <AppText style={[styles.heading, { textAlign: "center" }]}>Quote request sent</AppText>
                <AppText style={[styles.muted, { textAlign: "center" }]}>The farm will check availability and contact you with the confirmed price and details.</AppText>
            </Panel>
            <Panel style={{ alignItems: "center", backgroundColor: colors.mint, borderColor: colors.mint }}>
                <AppText style={{ color: colors.forest, fontWeight: "700" }}>Your reference</AppText>
                <AppText style={{ color: colors.forest, fontSize: 23, fontWeight: "800" }}>{reference || "Reference unavailable"}</AppText>
            </Panel>
            <ActionButton icon={<MaterialCommunityIcons name="whatsapp" size={20} color={colors.white} />} onPress={() => void Linking.openURL(whatsappUrl)}>
                Chat on WhatsApp
            </ActionButton>
            <ActionButton secondary onPress={() => router.replace("/(tabs)/orders")}>
                View my orders
            </ActionButton>
        </Screen>
    );
}