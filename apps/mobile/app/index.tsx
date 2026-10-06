import { ActivityIndicator, View } from "react-native";
import { Redirect } from "expo-router";
import { useAuth } from "../lib/auth/context";
import { colors } from "../lib/theme";

export default function IndexRoute() {
    const { token } = useAuth();
    if (token === undefined) {
        return <View style={{ flex: 1, alignItems: "center", justifyContent: "center" }}><ActivityIndicator color={colors.leaf} /></View>;
    }
    return <Redirect href={token ? "/(tabs)/catalog" : "/sign-in"} />;
}