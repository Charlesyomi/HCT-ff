import { useQuery } from "@tanstack/react-query";
import { MaterialCommunityIcons } from "@expo/vector-icons";
import { RefreshControl, View } from "react-native";
import { AppText, ErrorNotice, Panel, Screen } from "../../components/ui";
import { getOrders, type AccountOrder } from "../../lib/api/requests";
import { formatNaira } from "../../lib/cart/store";
import { colors, styles } from "../../lib/theme";

export default function OrdersScreen() {
    const orders = useQuery({ queryKey: ["account", "orders"], queryFn: getOrders });
    if (orders.isPending) return <Screen><AppText>Loading your orders…</AppText></Screen>;
    if (orders.isError) return <Screen><ErrorNotice message={orders.error.message} onRetry={() => void orders.refetch()} /></Screen>;

    return (
        <Screen refreshControl={<RefreshControl refreshing={orders.isRefetching} onRefresh={() => void orders.refetch()} tintColor={colors.leaf} />}>
            <View style={{ gap: 4 }}>
                <AppText style={styles.heading}>Your orders</AppText>
                <AppText style={styles.muted}>Updates from HCT Fish Farms.</AppText>
            </View>
            {orders.data.length === 0 ? (
                <Panel style={{ alignItems: "center", paddingVertical: 30 }}>
                    <MaterialCommunityIcons name="clipboard-text-outline" size={42} color={colors.leaf} />
                    <AppText style={styles.subheading}>No orders yet</AppText>
                    <AppText style={[styles.muted, { textAlign: "center" }]}>Orders linked to this account will appear here.</AppText>
                </Panel>
            ) : orders.data.map((order) => <OrderPanel key={order.reference} order={order} />)}
        </Screen>
    );
}

function OrderPanel({ order }: { order: AccountOrder }) {
    const date = new Intl.DateTimeFormat("en-NG", { dateStyle: "medium", timeZone: "Africa/Lagos" }).format(new Date(order.submitted_at));
    return (
        <Panel>
            <View style={[styles.row, { justifyContent: "space-between" }]}>
                <AppText style={{ color: colors.leaf, fontWeight: "800", fontSize: 16 }}>{order.reference}</AppText>
                <View style={[styles.pill, { backgroundColor: statusBackground(order.status) }]}>
                    <AppText style={{ fontSize: 12, color: colors.forest, fontWeight: "700" }}>{statusLabel(order.status)}</AppText>
                </View>
            </View>
            <AppText style={styles.subheading}>{order.quantity_kg} kg · {order.size_label}</AppText>
            <AppText style={styles.muted}>{fishLabel(order.fish_type)} · {order.fulfilment === "delivery" ? "Delivery" : "Pickup"}</AppText>
            {order.items.length ? order.items.map((item, index) => (
                <AppText key={`${order.reference}:${index}`} style={styles.muted}>
                    {item.quantity_kg} kg · {item.size_label} · {fishLabel(item.fish_type)}
                </AppText>
            )) : null}
            <AppText style={{ color: colors.leaf, fontWeight: "700" }}>Estimated total: {formatNaira(order.indicative_total_kobo)}</AppText>
            <AppText style={styles.muted}>Submitted {date}</AppText>
        </Panel>
    );
}

function statusBackground(status: string): string {
    if (["confirmed", "ready", "completed"].includes(status)) return "#E7F3DF";
    if (["declined", "cancelled", "expired"].includes(status)) return "#EEF0ED";
    return "#FFF2D7";
}

function statusLabel(status: string): string {
    const labels: Record<string, string> = { pending: "Pending", quoted: "Quoted", confirmed: "Confirmed", ready: "Ready", completed: "Completed", cancelled: "Cancelled", declined: "Declined", expired: "Expired" };
    return labels[status] ?? status;
}

function fishLabel(value: string): string {
    if (value === "any") return "Either fish type";
    return value.charAt(0).toUpperCase() + value.slice(1);
}