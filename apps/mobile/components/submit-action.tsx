import { View } from "react-native";
import { ActionButton, AppText } from "./ui";
import { colors } from "../lib/theme";

export function SubmitAction({
    pending,
    disabledReason,
    onPress,
}: {
    pending: boolean;
    disabledReason: string | null;
    onPress: () => void;
}) {
    const reason = pending ? "Sending your request. Please wait…" : disabledReason;
    return (
        <View style={{ gap: 8 }}>
            <ActionButton disabled={pending || Boolean(disabledReason)} loading={pending} onPress={onPress}>
                Send quote request
            </ActionButton>
            {reason ? <AppText accessibilityLiveRegion="polite" style={{ color: colors.muted, textAlign: "center" }}>{reason}</AppText> : null}
        </View>
    );
}