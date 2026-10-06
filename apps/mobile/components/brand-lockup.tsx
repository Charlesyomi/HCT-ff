import { Text, View } from "react-native";
import { colors } from "../lib/theme";

export function BrandLockup({ centered = false }: { centered?: boolean }) {
    return (
        <View accessibilityLabel="HCT Fish Farms" style={{ alignItems: centered ? "center" : "flex-start", gap: 2 }}>
            <Text style={{ color: colors.forest, fontSize: centered ? 30 : 18, fontWeight: "900", lineHeight: centered ? 34 : 22 }}>HCT</Text>
            <Text style={{ color: colors.leaf, fontSize: centered ? 12 : 9, fontWeight: "800", lineHeight: centered ? 16 : 12 }}>FISH FARMS</Text>
        </View>
    );
}