import { RefreshControl, View } from "react-native";
import { MaterialCommunityIcons } from "@expo/vector-icons";
import { useRouter } from "expo-router";
import { useQuery } from "@tanstack/react-query";
import { ActionButton, AppText, ErrorNotice, Panel, Screen } from "../../components/ui";
import { getCatalog } from "../../lib/api/requests";
import { formatNaira } from "../../lib/cart/store";
import { useCart } from "../../lib/cart/hooks";
import { colors, styles } from "../../lib/theme";

export default function CartScreen() {
    const cart = useCart(true);
    const catalog = useQuery({ queryKey: ["catalog"], queryFn: getCatalog });
    const router = useRouter();
    if (cart.isPending) return <Screen><AppText>Loading your cart…</AppText></Screen>;
    if (cart.isError) return <Screen><ErrorNotice message={cart.error.message} onRetry={() => void cart.refetch()} /></Screen>;

    const items = cart.data.items;
    const totalKg = items.reduce((total, item) => total + item.quantity_kg, 0);
    const quoteReason = items.length === 0
        ? "Add fish to your cart before requesting a quote."
        : !catalog.data
            ? catalog.isError ? "Could not load the farm's order limits. Retry below." : "Loading the farm's order limits…"
            : totalKg < catalog.data.settings.min_order_kg
                ? `Add ${catalog.data.settings.min_order_kg - totalKg} kg to meet the ${catalog.data.settings.min_order_kg} kg minimum.`
                : totalKg > catalog.data.settings.max_order_kg
                    ? `Reduce your cart to ${catalog.data.settings.max_order_kg} kg or less.`
                    : cart.syncState === "saving"
                        ? "Wait for your cart to finish saving."
                        : null;
    return (
        <Screen refreshControl={<RefreshControl refreshing={cart.isRefetching} onRefresh={() => void cart.refetch()} tintColor={colors.leaf} />}>
            <View style={{ gap: 4 }}>
                <AppText style={styles.heading}>Your cart</AppText>
                <AppText style={styles.muted}>Your cart is saved to your account.</AppText>
            </View>

            <View style={[styles.row, { justifyContent: "flex-end" }]}>
                <View style={[styles.row, { gap: 6 }]}>
                    <MaterialCommunityIcons name={cart.syncState === "saving" ? "sync" : cart.syncState === "error" ? "alert-circle-outline" : "check-circle-outline"} size={17} color={cart.syncState === "error" ? colors.danger : colors.leaf} />
                    <AppText style={{ fontSize: 13, color: cart.syncState === "error" ? colors.danger : colors.leaf, fontWeight: "700" }}>
                        {cart.syncState === "saving" ? "Saving…" : cart.syncState === "error" ? "Not synced" : "Synced"}
                    </AppText>
                </View>
            </View>

            {cart.syncError ? <ErrorNotice message={cart.syncError} onRetry={() => void cart.retry().catch(() => undefined)} /> : null}
            {catalog.isError ? <ErrorNotice message={catalog.error.message} onRetry={() => void catalog.refetch()} /> : null}
            {items.length === 0 ? (
                <Panel style={{ alignItems: "center", paddingVertical: 30 }}>
                    <MaterialCommunityIcons name="basket-outline" size={42} color={colors.leaf} />
                    <AppText style={[styles.subheading, { textAlign: "center" }]}>Your cart is empty</AppText>
                    <AppText style={[styles.muted, { textAlign: "center" }]}>Browse the catalogue and add the sizes you want.</AppText>
                </Panel>
            ) : (
                <>
                    {items.map((line) => (
                        <Panel key={`${line.fish_type}:${line.size}`}>
                            <View style={[styles.row, { justifyContent: "space-between", alignItems: "flex-start" }]}>
                                <View style={{ flex: 1, gap: 3 }}>
                                    <AppText style={styles.subheading}>{line.size_label}</AppText>
                                    <AppText style={styles.muted}>{fishLabel(line.fish_type)} catfish</AppText>
                                </View>
                                <AppText style={{ color: colors.leaf, fontWeight: "800" }}>{formatNaira(line.line_total_kobo)}</AppText>
                            </View>
                            <View style={[styles.row, { justifyContent: "space-between" }]}>
                                <AppText style={{ fontWeight: "700" }}>Quantity</AppText>
                                <View style={styles.row}>
                                    <ActionButton
                                        secondary
                                        disabled={cart.syncState === "saving"}
                                        accessibilityLabel={`Reduce ${line.size_label} quantity`}
                                        style={{ width: 44, minHeight: 44, paddingHorizontal: 0 }}
                                        onPress={() => void cart.changeCart({ type: "set-quantity", line: { fish_type: line.fish_type as "clarias" | "hybrid" | "any", size: line.size }, quantityKg: Math.max(1, line.quantity_kg - 10) }).catch(() => undefined)}
                                    ><MaterialCommunityIcons name="minus" size={19} color={colors.forest} /></ActionButton>
                                    <AppText style={{ minWidth: 74, textAlign: "center", fontWeight: "800" }}>{line.quantity_kg} kg</AppText>
                                    <ActionButton
                                        secondary
                                        disabled={cart.syncState === "saving"}
                                        accessibilityLabel={`Increase ${line.size_label} quantity`}
                                        style={{ width: 44, minHeight: 44, paddingHorizontal: 0 }}
                                        onPress={() => void cart.changeCart({ type: "set-quantity", line: { fish_type: line.fish_type as "clarias" | "hybrid" | "any", size: line.size }, quantityKg: line.quantity_kg + 10 }).catch(() => undefined)}
                                    ><MaterialCommunityIcons name="plus" size={19} color={colors.forest} /></ActionButton>
                                </View>
                            </View>
                            <ActionButton
                                secondary
                                disabled={cart.syncState === "saving"}
                                icon={<MaterialCommunityIcons name="delete-outline" size={18} color={colors.forest} />}
                                onPress={() => void cart.changeCart({ type: "remove", line: { fish_type: line.fish_type as "clarias" | "hybrid" | "any", size: line.size } }).catch(() => undefined)}
                            >Remove</ActionButton>
                        </Panel>
                    ))}
                    <Panel style={{ backgroundColor: colors.mint, borderColor: colors.mint }}>
                        <View style={[styles.row, { justifyContent: "space-between" }]}>
                            <AppText style={styles.subheading}>Estimated total</AppText>
                            <AppText style={[styles.subheading, { color: colors.forest }]}>{formatNaira(cart.data.indicative_total_kobo)}</AppText>
                        </View>
                        <AppText style={styles.muted}>Final prices are confirmed by the farm. No online payment is collected.</AppText>
                    </Panel>
                </>
            )}
            <Panel style={{ backgroundColor: colors.forest, borderColor: colors.forest }}>
                <ActionButton disabled={Boolean(quoteReason)} onPress={() => router.push("/checkout")}>
                    Request quote
                </ActionButton>
                {quoteReason ? <AppText accessibilityLiveRegion="polite" style={{ color: colors.white, textAlign: "center" }}>{quoteReason}</AppText> : null}
            </Panel>
        </Screen>
    );
}

function fishLabel(value: string): string {
    if (value === "any") return "Either";
    return value.charAt(0).toUpperCase() + value.slice(1);
}