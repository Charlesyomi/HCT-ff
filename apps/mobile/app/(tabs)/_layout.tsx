import { ActivityIndicator, View } from "react-native";
import { Redirect, Tabs } from "expo-router";
import { MaterialCommunityIcons } from "@expo/vector-icons";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useAuth } from "../../lib/auth/context";
import { colors } from "../../lib/theme";

const icons = {
    catalog: "fish",
    cart: "basket-outline",
    orders: "clipboard-list-outline",
    account: "account-circle-outline",
} as const;

export default function TabLayout() {
    const { token } = useAuth();
    const insets = useSafeAreaInsets();
    if (token === undefined) return <View style={{ flex: 1, alignItems: "center", justifyContent: "center" }}><ActivityIndicator color={colors.leaf} /></View>;
    if (!token) return <Redirect href="/sign-in" />;

    return (
        <Tabs
            screenOptions={({ route }) => ({
                headerTitle: "HCT Fish Farms",
                headerTitleStyle: { color: colors.forest, fontSize: 18, fontWeight: "800" },
                headerStyle: { backgroundColor: colors.paper },
                headerShadowVisible: false,
                tabBarActiveTintColor: colors.leaf,
                tabBarInactiveTintColor: colors.muted,
                tabBarStyle: {
                    height: 68 + insets.bottom,
                    paddingTop: 7,
                    paddingBottom: insets.bottom > 0 ? insets.bottom : 8,
                    borderTopColor: colors.border,
                    backgroundColor: colors.white,
                },
                tabBarLabelStyle: { fontSize: 11, fontWeight: "700" },
                tabBarIcon: ({ color, size }) => (
                    <MaterialCommunityIcons name={icons[route.name as keyof typeof icons]} size={size} color={color} />
                ),
            })}
        >
            <Tabs.Screen name="catalog" options={{ title: "Catalogue", tabBarLabel: "Fish" }} />
            <Tabs.Screen name="cart" options={{ title: "Your cart", tabBarLabel: "Cart" }} />
            <Tabs.Screen name="orders" options={{ title: "Your orders", tabBarLabel: "Orders" }} />
            <Tabs.Screen name="account" options={{ title: "Your account", tabBarLabel: "Account" }} />
        </Tabs>
    );
}