import { useState } from "react";
import { Image, Pressable, Text, View } from "react-native";
import { MaterialCommunityIcons } from "@expo/vector-icons";
import { useQuery } from "@tanstack/react-query";
import { ActionButton, AppText, ErrorNotice, Panel, Screen, StatusPill } from "../../components/ui";
import { getCatalog } from "../../lib/api/requests";
import { useCart } from "../../lib/cart/hooks";
import { formatNaira } from "../../lib/cart/store";
import { catalogImageSource } from "../../lib/catalog-images";
import { colors, styles } from "../../lib/theme";

type FishType = "clarias" | "hybrid" | "any";

export default function CatalogScreen() {
    const catalog = useQuery({ queryKey: ["catalog"], queryFn: getCatalog });
    const cart = useCart();
    const [fishType, setFishType] = useState<FishType>("any");

    if (catalog.isPending) return <Screen><AppText>Loading the latest availability…</AppText></Screen>;
    if (catalog.isError) return <Screen><ErrorNotice message={catalog.error.message} onRetry={() => void catalog.refetch()} /></Screen>;

    const { size_classes: sizes, harvest_window: window, settings } = catalog.data;
    return (
        <Screen>
            <View style={{ gap: 5 }}>
                <AppText style={{ color: colors.leaf, fontSize: 12, fontWeight: "800", letterSpacing: 1.2 }}>FROM OUR FARM</AppText>
                <AppText style={styles.heading}>Fresh catfish</AppText>
                <AppText style={styles.muted}>Choose a size and add it to your cart.</AppText>
            </View>

            {window ? (
                <Panel style={{ backgroundColor: colors.mint, borderColor: colors.mint }}>
                    <AppText style={{ color: colors.forest, fontWeight: "800" }}>Next harvest window</AppText>
                    <AppText>{window.starts_on} to {window.ends_on}</AppText>
                    {window.notes ? <AppText style={styles.muted}>{window.notes}</AppText> : null}
                </Panel>
            ) : (
                <Panel style={{ backgroundColor: colors.mint, borderColor: colors.mint }}>
                    <AppText style={{ color: colors.forest, fontWeight: "700" }}>Next harvest date to be announced.</AppText>
                    <AppText style={styles.muted}>Availability and prices are confirmed by the farm.</AppText>
                </Panel>
            )}

            <View style={{ gap: 10 }}>
                <AppText style={styles.subheading}>Fish type</AppText>
                <View style={[styles.row, { flexWrap: "wrap" }]}>
                    {([["any", "Either"], ["clarias", "Clarias"], ["hybrid", "Hybrid"]] as const).map(([value, label]) => {
                        const selected = fishType === value;
                        return (
                            <Pressable
                                key={value}
                                accessibilityRole="radio"
                                accessibilityState={{ checked: selected }}
                                onPress={() => setFishType(value)}
                                style={{ minHeight: 44, justifyContent: "center", paddingHorizontal: 16, borderRadius: 22, borderWidth: 1, borderColor: selected ? colors.leaf : colors.border, backgroundColor: selected ? colors.mint : colors.white }}
                            >
                                <Text style={{ color: selected ? colors.forest : colors.ink, fontWeight: "700" }}>{label}</Text>
                            </Pressable>
                        );
                    })}
                </View>
            </View>

            <View style={{ gap: 12 }}>
                <AppText style={styles.subheading}>Available sizes</AppText>
                {sizes.map((size) => (
                    <SizeCard key={size.slug} size={size} minimum={settings.min_order_kg} maximum={settings.max_order_kg} fishType={fishType} addToCart={cart.changeCart} />
                ))}
            </View>
        </Screen>
    );
}

function SizeCard({
    size,
    minimum,
    maximum,
    fishType,
    addToCart,
}: {
    size: import("../../lib/api/requests").CatalogSize;
    minimum: number;
    maximum: number;
    fishType: FishType;
    addToCart: ReturnType<typeof useCart>["changeCart"];
}) {
    const [quantity, setQuantity] = useState(minimum);
    const [imageFailed, setImageFailed] = useState(false);
    const [message, setMessage] = useState<string | null>(null);
    const [adding, setAdding] = useState(false);
    const unavailable = size.status === "sold_out" || size.status === "unavailable";

    async function add() {
        setAdding(true);
        setMessage(null);
        try {
            await addToCart({ type: "add", line: { fish_type: fishType, size: size.slug, quantity_kg: quantity } });
            setMessage("Added to your cart.");
        } catch (error) {
            setMessage(error instanceof Error ? error.message : "Could not add this size. Please try again.");
        } finally {
            setAdding(false);
        }
    }

    return (
        <Panel style={{ padding: 0, overflow: "hidden" }}>
            {imageFailed ? (
                <View style={{ height: 156, backgroundColor: colors.mint, alignItems: "center", justifyContent: "center" }}>
                    <MaterialCommunityIcons name="fish" size={58} color={colors.leaf} />
                </View>
            ) : (
                <Image source={catalogImageSource(size.slug, size.image_path)} onError={() => setImageFailed(true)} accessibilityLabel={`${size.label} catfish`} resizeMode="cover" style={{ width: "100%", height: 156, backgroundColor: colors.mint }} />
            )}
            <View style={{ padding: 15, gap: 12 }}>
                <View style={[styles.row, { justifyContent: "space-between", alignItems: "flex-start" }]}>
                    <View style={{ flex: 1, gap: 3 }}>
                        <AppText style={styles.subheading}>{size.label}</AppText>
                        <AppText style={styles.muted}>{size.descriptor}</AppText>
                    </View>
                    <StatusPill status={size.status} />
                </View>
                <AppText style={{ color: colors.leaf, fontWeight: "800" }}>
                    {size.indicative_price_per_kg_kobo == null ? "Price on request" : `${formatNaira(size.indicative_price_per_kg_kobo)} / kg`}
                </AppText>
                <View style={[styles.row, { justifyContent: "space-between" }]}>
                    <AppText style={{ fontWeight: "700" }}>Quantity</AppText>
                    <View style={styles.row}>
                        <Pressable accessibilityRole="button" accessibilityLabel={`Reduce quantity for ${size.label}`} disabled={quantity <= minimum} onPress={() => setQuantity((value) => Math.max(minimum, value - 10))} style={[styles.secondaryButton, { width: 46, minHeight: 44, paddingHorizontal: 0 }]}>
                            <MaterialCommunityIcons name="minus" size={20} color={colors.forest} />
                        </Pressable>
                        <AppText style={{ minWidth: 74, textAlign: "center", fontWeight: "800" }}>{quantity} kg</AppText>
                        <Pressable accessibilityRole="button" accessibilityLabel={`Increase quantity for ${size.label}`} disabled={quantity >= maximum} onPress={() => setQuantity((value) => Math.min(maximum, value + 10))} style={[styles.secondaryButton, { width: 46, minHeight: 44, paddingHorizontal: 0 }]}>
                            <MaterialCommunityIcons name="plus" size={20} color={colors.forest} />
                        </Pressable>
                    </View>
                </View>
                <ActionButton loading={adding} disabled={unavailable} onPress={() => void add()}>
                    {unavailable ? "Currently unavailable" : "Add to cart"}
                </ActionButton>
                {message ? <AppText style={[styles.muted, { color: message.startsWith("Added") ? colors.leaf : colors.danger }]}>{message}</AppText> : null}
            </View>
        </Panel>
    );
}