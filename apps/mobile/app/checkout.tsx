import * as Crypto from "expo-crypto";
import DateTimePicker, { type DateTimePickerEvent } from "@react-native-community/datetimepicker";
import { MaterialCommunityIcons } from "@expo/vector-icons";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useFocusEffect, useRouter } from "expo-router";
import * as Linking from "expo-linking";
import { useCallback, useEffect, useRef, useState } from "react";
import {
    AccessibilityInfo,
    findNodeHandle,
    Keyboard,
    Platform,
    Pressable,
    Text,
    TextInput,
    View,
} from "react-native";
import { TurnstileChallenge } from "../components/turnstile";
import { SubmitAction } from "../components/submit-action";
import { ActionButton, AppText, ErrorNotice, Panel, Screen } from "../components/ui";
import { getAccount, getCart, getCatalog, deleteCart, createOrder, type CartResponse } from "../lib/api/requests";
import { ApiError } from "../lib/api/errors";
import { CART_QUERY_KEY } from "../lib/cart/hooks";
import { formatNaira } from "../lib/cart/store";
import { colors, styles } from "../lib/theme";
import { TURNSTILE_SITE_KEY, WEB_URL } from "../lib/config";
import {
    buildOrderPayload,
    checkout422Feedback,
    checkoutDateRange,
    lagosDateKey,
    localDateForPicker,
    submitOrderAndClearCart,
    validateCheckout,
    type CheckoutDraft,
    type CheckoutErrors,
    type CheckoutField,
    type CheckoutLine,
} from "../lib/checkout/validation";

const EMPTY_DRAFT: CheckoutDraft = {
    preferred_date: "",
    time_slot: "",
    fulfilment: "",
    delivery_address: "",
    delivery_landmark: "",
    notes: "",
    customer_name: "",
    phone: "",
    email: "",
    consent: false,
};

export default function CheckoutScreen() {
    const router = useRouter();
    const queryClient = useQueryClient();
    const idempotencyKey = useState(() => Crypto.randomUUID())[0];
    const catalog = useQuery({ queryKey: ["catalog"], queryFn: getCatalog });
    const account = useQuery({ queryKey: ["account", "me"], queryFn: getAccount });
    const cartQuery = useQuery({ queryKey: CART_QUERY_KEY, queryFn: getCart });
    const [draft, setDraft] = useState(EMPTY_DRAFT);
    const [lines, setLines] = useState<CheckoutLine[]>([]);
    const [errors, setErrors] = useState<CheckoutErrors>({});
    const [datePickerOpen, setDatePickerOpen] = useState(false);
    const [turnstileToken, setTurnstileToken] = useState<string | null>(null);
    const [turnstileStatus, setTurnstileStatus] = useState<"loading" | "verifying" | "verified" | "error" | "missing-config">(TURNSTILE_SITE_KEY ? "loading" : "missing-config");
    const [turnstileAttempt, setTurnstileAttempt] = useState(0);
    const [pending, setPending] = useState(false);
    const [retryAvailable, setRetryAvailable] = useState(false);
    const [requestMessage, setRequestMessage] = useState<string | null>(null);
    const [focusOnTurnstile, setFocusOnTurnstile] = useState(false);
    const [touched, setTouched] = useState<Partial<Record<keyof CheckoutDraft, boolean>>>({});
    const [now] = useState(() => new Date());
    const scrollRef = useRef<import("react-native").ScrollView>(null);
    const fieldViews = useRef<Partial<Record<CheckoutField, View | null>>>({});
    const fieldInputs = useRef<Partial<Record<CheckoutField, TextInput | null>>>({});
    const firstInvalid = useRef<CheckoutField | null>(null);
    const pendingRef = useRef(false);
    const linesInitialized = useRef(false);

    const formDraft: CheckoutDraft = {
        ...draft,
        preferred_date: touched.preferred_date
            ? draft.preferred_date
            : draft.preferred_date || (catalog.data ? checkoutDateRange(catalog.data.settings.min_lead_days).min : ""),
        customer_name: touched.customer_name ? draft.customer_name : draft.customer_name || account.data?.name || "",
        email: touched.email ? draft.email : draft.email || account.data?.email || "",
    };

    const refetchCart = cartQuery.refetch;
    const refetchCatalog = catalog.refetch;
    const refetchAccount = account.refetch;
    useFocusEffect(useCallback(() => {
        void refetchCart();
        void refetchCatalog();
        void refetchAccount();
    }, [refetchAccount, refetchCart, refetchCatalog]));

    useEffect(() => {
        if (!cartQuery.data || linesInitialized.current) return;
        linesInitialized.current = true;
        setLines(cartQuery.data.items.map((item) => ({
            fish_type: item.fish_type,
            size: item.size,
            size_label: item.size_label,
            quantity_kg: item.quantity_kg,
        })));
    }, [cartQuery.data]);

    useEffect(() => {
        const field = firstInvalid.current;
        if (!field) return;
        firstInvalid.current = null;
        const target = fieldViews.current[field];
        const scroll = scrollRef.current;
        const nativeScrollRef = scroll?.getNativeScrollRef();
        if (target && scroll && nativeScrollRef) {
            target.measureLayout(nativeScrollRef, (_x, y) => scroll.scrollTo({ y: Math.max(0, y - 20), animated: true }), () => undefined);
            const tag = findNodeHandle(target);
            if (tag) setTimeout(() => AccessibilityInfo.setAccessibilityFocus(tag), 300);
        }
        setTimeout(() => fieldInputs.current[field]?.focus(), 350);
    }, [errors]);

    const totalKg = lines.reduce((total, line) => total + line.quantity_kg, 0);
    const pricesAvailable = lines.every((line) => cartQuery.data?.items.find((item) => item.size === line.size && item.fish_type === line.fish_type)?.indicative_unit_price_kobo != null);
    const estimatedTotal = pricesAvailable ? lines.reduce((total, line) => {
        const original = cartQuery.data?.items.find((item) => item.size === line.size && item.fish_type === line.fish_type);
        return total + (original?.indicative_unit_price_kobo == null ? 0 : original.indicative_unit_price_kobo * line.quantity_kg);
    }, 0) : null;

    function setField<K extends keyof CheckoutDraft>(field: K, value: CheckoutDraft[K]) {
        setTouched((current) => ({ ...current, [field]: true }));
        setDraft((current) => ({ ...current, [field]: value }));
        setErrors((current) => {
            if (!current[field as CheckoutField]) return current;
            const next = { ...current };
            delete next[field as CheckoutField];
            return next;
        });
        setRequestMessage(null);
    }

    function setLineQuantity(index: number, value: string) {
        const quantity = value === "" ? 0 : Number.parseInt(value, 10);
        setLines((current) => current.map((line, lineIndex) => lineIndex === index
            ? { ...line, quantity_kg: Number.isNaN(quantity) ? 0 : quantity }
            : line));
        setErrors((current) => {
            const next = { ...current };
            delete next[`items.${index}.quantity_kg`];
            delete next.items;
            return next;
        });
    }

    function focusFirstError(nextErrors: CheckoutErrors) {
        const order: CheckoutField[] = [
            "preferred_date", "time_slot", "fulfilment", "delivery_address", "delivery_landmark", "notes",
            "customer_name", "phone", "email", "consent", "turnstile_token",
        ];
        const direct = order.find((field) => Boolean(nextErrors[field]));
        const lineField = Object.keys(nextErrors).find((field) => /^items\.\d+\.quantity_kg$/.test(field)) as CheckoutField | undefined;
        firstInvalid.current = direct ?? lineField ?? (nextErrors.items ? (lines.length ? "items.0.quantity_kg" : "items") : null);
        setErrors(nextErrors);
    }

    function receiveTurnstileToken(token: string | null) {
        setTurnstileToken(token);
        if (token && focusOnTurnstile) {
            setFocusOnTurnstile(false);
            if (!catalog.data) return;
            const validationErrors = validateCheckout(formDraft, lines, catalog.data, now);
            if (Object.keys(validationErrors).length > 0) {
                focusFirstError(validationErrors);
                return;
            }
            void sendOrder(token);
        }
    }

    function updateTurnstile(status: "loading" | "verifying" | "verified" | "error" | "missing-config") {
        setTurnstileStatus(status);
        if (status === "verified") {
            setErrors((current) => {
                const next = { ...current };
                delete next.turnstile_token;
                return next;
            });
        }
    }

    function invalidateTurnstile() {
        setTurnstileToken(null);
        setTurnstileStatus("loading");
        setTurnstileAttempt((attempt) => attempt + 1);
    }

    async function sendOrder(token: string) {
        if (!catalog.data || pendingRef.current) return;
        pendingRef.current = true;
        setPending(true);
        setRetryAvailable(false);
        setRequestMessage(null);
        Keyboard.dismiss();
        try {
            const payload = buildOrderPayload(formDraft, lines, token);
            const result = await submitOrderAndClearCart(createOrder, deleteCart, payload, idempotencyKey);
            queryClient.setQueryData<CartResponse>(CART_QUERY_KEY, {
                items: [], version: 0, updated_at: null, indicative_total_kobo: null,
            });
            await Promise.all([
                queryClient.invalidateQueries({ queryKey: CART_QUERY_KEY }),
                queryClient.invalidateQueries({ queryKey: ["account", "orders"] }),
            ]);
            router.replace({ pathname: "/order-confirmation", params: { reference: result.reference } });
        } catch (error) {
            if (error instanceof ApiError && error.status === 422) {
                const { fieldErrors, requestMessage: fieldlessMessage } = checkout422Feedback(error.message, error.fields);
                invalidateTurnstile();
                setRequestMessage(fieldlessMessage);
                focusFirstError(fieldErrors);
            } else if (error instanceof ApiError && error.status === 429) {
                setRequestMessage("Too many requests, try again later.");
                setRetryAvailable(false);
                invalidateTurnstile();
            } else if (!(error instanceof ApiError) || error.status >= 500) {
                setRequestMessage("We could not confirm whether your request was received. Retry safely with the same request, or contact the farm.");
                setRetryAvailable(true);
                invalidateTurnstile();
            } else {
                setRequestMessage(error.message);
                invalidateTurnstile();
            }
        } finally {
            pendingRef.current = false;
            setPending(false);
        }
    }
    function handleSubmit() {
        if (!catalog.data) return;
        const validationErrors = validateCheckout(formDraft, lines, catalog.data, now);
        if (Object.keys(validationErrors).length > 0) {
            focusFirstError(validationErrors);
            return;
        }
        if (turnstileStatus !== "verified" || !turnstileToken) {
            focusFirstError({ turnstile_token: "Complete the security check to continue." });
            setFocusOnTurnstile(true);
            invalidateTurnstile();
            return;
        }
        void sendOrder(turnstileToken);
    }

    function retryRequest() {
        if (pending) return;
        setFocusOnTurnstile(true);
        invalidateTurnstile();
    }

    function dateChanged(_event: DateTimePickerEvent, date?: Date) {
        if (Platform.OS === "android") setDatePickerOpen(false);
        if (!date || !catalog.data) return;
        const dateKey = lagosDateKey(date);
        const range = checkoutDateRange(catalog.data.settings.min_lead_days, now);
        setField("preferred_date", dateKey < range.min ? range.min : dateKey > range.max ? range.max : dateKey);
    }

    function whatsappUrl(message: string) {
        const number = (catalog.data?.settings.whatsapp_number ?? "").replace(/\D/g, "");
        return `https://wa.me/${number}?text=${encodeURIComponent(message)}`;
    }

    if (catalog.isPending || cartQuery.isPending) return <Screen><AppText>Loading checkout…</AppText></Screen>;
    if (catalog.isError) return <Screen><ErrorNotice message={catalog.error.message} onRetry={() => void catalog.refetch()} /></Screen>;
    if (cartQuery.isError) return <Screen><ErrorNotice message={cartQuery.error.message} onRetry={() => void cartQuery.refetch()} /></Screen>;
    if (lines.length === 0) {
        return (
            <Screen>
                <AppText style={styles.heading}>Request a quote</AppText>
                <Panel><AppText>Your cart is empty. Add fish from the catalogue before requesting a quote.</AppText></Panel>
                <ActionButton secondary onPress={() => router.back()}>Back to cart</ActionButton>
            </Screen>
        );
    }

    const dateRange = checkoutDateRange(catalog.data.settings.min_lead_days, now);
    const minimumDate = localDateForPicker(dateRange.min);
    const maximumDate = localDateForPicker(dateRange.max);
    const selectedDate = localDateForPicker(formDraft.preferred_date || dateRange.min);
    const disabledReason = pending
        ? null
        : turnstileStatus === "loading" || turnstileStatus === "verifying"
            ? "Complete the security check before sending."
            : turnstileStatus === "error"
                ? "Security check failed. Retry the check to continue."
                : null;

    return (
        <Screen scrollRef={scrollRef} keyboardShouldPersistTaps="handled">
            <View style={[styles.row, { justifyContent: "space-between" }]}>
                <View style={{ flex: 1, gap: 4 }}>
                    <AppText style={{ color: colors.leaf, fontSize: 12, fontWeight: "800" }}>HCT FISH FARMS</AppText>
                    <AppText style={styles.heading}>Request a quote</AppText>
                </View>
                <Pressable accessibilityRole="button" accessibilityLabel="Close checkout" disabled={pending} onPress={() => router.back()} style={{ width: 48, height: 48, borderRadius: 24, backgroundColor: colors.white, alignItems: "center", justifyContent: "center", opacity: pending ? 0.5 : 1 }}>
                    <MaterialCommunityIcons name="close" size={22} color={colors.forest} />
                </Pressable>
            </View>

            <View style={{ gap: 12 }}>
                <AppText style={styles.subheading}>Your fish</AppText>
                {lines.map((line, index) => {
                    const original = cartQuery.data.items.find((item) => item.size === line.size && item.fish_type === line.fish_type);
                    const lineKobo = original?.indicative_unit_price_kobo == null ? null : original.indicative_unit_price_kobo * line.quantity_kg;
                    return (
                        <Panel key={`${line.fish_type}:${line.size}`}>
                            <View style={[styles.row, { justifyContent: "space-between" }]}>
                                <View style={{ flex: 1, gap: 2 }}>
                                    <AppText style={{ fontWeight: "800" }}>{line.size_label}</AppText>
                                    <AppText style={styles.muted}>{fishLabel(line.fish_type)}</AppText>
                                </View>
                                <AppText style={{ color: colors.leaf, fontWeight: "800" }}>{formatNaira(lineKobo)}</AppText>
                            </View>
                            <View style={styles.row}>
                                <View ref={(node) => { fieldViews.current[`items.${index}.quantity_kg`] = node; }} style={{ flex: 1 }}>
                                    <Label>Quantity (kg)</Label>
                                    <TextInput
                                        ref={(node) => { fieldInputs.current[`items.${index}.quantity_kg`] = node; }}
                                        accessibilityLabel={`${line.size_label} quantity in kilograms`}
                                        value={String(line.quantity_kg || "")}
                                        onChangeText={(value) => setLineQuantity(index, value)}
                                        keyboardType="number-pad"
                                        maxLength={5}
                                        editable={!pending && !retryAvailable}
                                        style={[styles.field, { flex: 1 }, errors[`items.${index}.quantity_kg`] && fieldErrorStyle]}
                                    />
                                </View>
                                <ActionButton secondary disabled={pending || retryAvailable} accessibilityLabel={`Remove ${line.size_label}`} onPress={() => setLines((current) => current.filter((_, lineIndex) => lineIndex !== index))} style={{ minHeight: 48, paddingHorizontal: 12 }}>
                                    <MaterialCommunityIcons name="delete-outline" size={18} color={colors.forest} />
                                </ActionButton>
                            </View>
                            {errors[`items.${index}.quantity_kg`] ? <FieldError>{errors[`items.${index}.quantity_kg`]}</FieldError> : null}
                        </Panel>
                    );
                })}
                {errors.items ? <FieldError>{errors.items}</FieldError> : null}
                <Panel style={{ backgroundColor: colors.mint, borderColor: colors.mint }}>
                    <View style={[styles.row, { justifyContent: "space-between" }]}>
                        <AppText style={{ color: colors.forest, fontWeight: "800" }}>Estimated total · {totalKg} kg</AppText>
                        <AppText style={{ color: colors.forest, fontWeight: "800" }}>{formatNaira(estimatedTotal)}</AppText>
                    </View>
                    <AppText style={styles.muted}>Final price is confirmed by the farm.</AppText>
                </Panel>
            </View>

            <View ref={(node) => { fieldViews.current.preferred_date = node; }} style={{ gap: 8 }}>
                <Label>Preferred date</Label>
                <ActionButton secondary disabled={pending || retryAvailable} style={errors.preferred_date ? fieldErrorStyle : undefined} icon={<MaterialCommunityIcons name="calendar-month-outline" size={20} color={colors.forest} />} onPress={() => setDatePickerOpen(true)}>
                    {formatDate(formDraft.preferred_date)}
                </ActionButton>
                <AppText style={styles.muted}>Available {dateRange.min} to {dateRange.max} (Africa/Lagos).</AppText>
                {datePickerOpen ? (
                    <DateTimePicker
                        value={selectedDate}
                        mode="date"
                        display={Platform.OS === "ios" ? "spinner" : "calendar"}
                        minimumDate={minimumDate}
                        maximumDate={maximumDate}
                        timeZoneName="Africa/Lagos"
                        onChange={dateChanged}
                    />
                ) : null}
                {errors.preferred_date ? <FieldError>{errors.preferred_date}</FieldError> : null}
            </View>

            <View ref={(node) => { fieldViews.current.time_slot = node; }} style={{ gap: 8 }}>
                <Label>Preferred time</Label>
                <View style={[styles.row, { flexWrap: "wrap" }]}>
                    {catalog.data.settings.time_slots.map((slot) => <Choice key={slot.key} disabled={pending || retryAvailable} selected={formDraft.time_slot === slot.key} label={slot.label} onPress={() => setField("time_slot", slot.key)} />)}
                </View>
                {errors.time_slot ? <FieldError>{errors.time_slot}</FieldError> : null}
            </View>

            <View ref={(node) => { fieldViews.current.fulfilment = node; }} style={{ gap: 8 }}>
                <Label>Pickup or delivery?</Label>
                <View style={styles.row}>
                    <Choice disabled={pending || retryAvailable} selected={formDraft.fulfilment === "pickup"} label="Pickup" onPress={() => setField("fulfilment", "pickup")} />
                    <Choice disabled={pending || retryAvailable} selected={formDraft.fulfilment === "delivery"} label="Delivery" onPress={() => setField("fulfilment", "delivery")} />
                </View>
                {errors.fulfilment ? <FieldError>{errors.fulfilment}</FieldError> : null}
            </View>

            {formDraft.fulfilment === "delivery" ? (
                <View style={{ gap: 12 }}>
                    <View ref={(node) => { fieldViews.current.delivery_address = node; }}>
                        <Label>Delivery address</Label>
                        <TextInput
                            ref={(node) => { fieldInputs.current.delivery_address = node; }}
                            accessibilityLabel="Delivery address"
                            value={formDraft.delivery_address}
                            onChangeText={(value) => setField("delivery_address", value)}
                            autoComplete="street-address"
                            multiline
                            editable={!pending && !retryAvailable}
                            style={[styles.field, { minHeight: 76, paddingTop: 12, textAlignVertical: "top" }, errors.delivery_address && fieldErrorStyle]}
                        />
                        {errors.delivery_address ? <FieldError>{errors.delivery_address}</FieldError> : null}
                    </View>
                    <View>
                        <Label>Landmark or extra directions</Label>
                        <TextInput
                            ref={(node) => { fieldInputs.current.delivery_landmark = node; }}
                            accessibilityLabel="Landmark or extra directions"
                            value={formDraft.delivery_landmark}
                            editable={!pending && !retryAvailable}
                            onChangeText={(value) => setField("delivery_landmark", value)}
                            style={styles.field}
                        />
                    </View>
                </View>
            ) : null}

            <View ref={(node) => { fieldViews.current.notes = node; }}>
                <Label>Special instructions</Label>
                <TextInput
                    ref={(node) => { fieldInputs.current.notes = node; }}
                    accessibilityLabel="Special instructions"
                    value={formDraft.notes}
                    onChangeText={(value) => setField("notes", value.slice(0, 500))}
                    multiline
                    maxLength={500}
                    editable={!pending && !retryAvailable}
                    style={[styles.field, { minHeight: 96, paddingTop: 12, textAlignVertical: "top" }, errors.notes && fieldErrorStyle]}
                />
                <AppText style={styles.muted}>{formDraft.notes.length}/500</AppText>
                {errors.notes ? <FieldError>{errors.notes}</FieldError> : null}
            </View>

            <View ref={(node) => { fieldViews.current.customer_name = node; }}>
                <Label>Full name</Label>
                <TextInput
                    ref={(node) => { fieldInputs.current.customer_name = node; }}
                    accessibilityLabel="Full name"
                    value={formDraft.customer_name}
                    onChangeText={(value) => setField("customer_name", value)}
                    autoComplete="name"
                    maxLength={80}
                    editable={!pending && !retryAvailable}
                    style={[styles.field, errors.customer_name && fieldErrorStyle]}
                />
                {errors.customer_name ? <FieldError>{errors.customer_name}</FieldError> : null}
            </View>

            <View ref={(node) => { fieldViews.current.phone = node; }}>
                <Label>WhatsApp / phone number</Label>
                <TextInput
                    ref={(node) => { fieldInputs.current.phone = node; }}
                    accessibilityLabel="WhatsApp or phone number"
                    value={formDraft.phone}
                    onChangeText={(value) => setField("phone", value)}
                    keyboardType="phone-pad"
                    autoComplete="tel"
                    editable={!pending && !retryAvailable}
                    placeholder="0801 234 5678"
                    style={[styles.field, errors.phone && fieldErrorStyle]}
                />
                {errors.phone ? <FieldError>{errors.phone}</FieldError> : null}
            </View>

            <View ref={(node) => { fieldViews.current.email = node; }}>
                <Label>Email (optional)</Label>
                <TextInput
                    ref={(node) => { fieldInputs.current.email = node; }}
                    accessibilityLabel="Email address (optional)"
                    value={formDraft.email}
                    onChangeText={(value) => setField("email", value)}
                    keyboardType="email-address"
                    autoCapitalize="none"
                    autoComplete="email"
                    editable={!pending && !retryAvailable}
                    style={[styles.field, errors.email && fieldErrorStyle]}
                />
                {errors.email ? <FieldError>{errors.email}</FieldError> : null}
            </View>

            <View ref={(node) => { fieldViews.current.consent = node; }} style={{ gap: 8 }}>
                <Pressable
                    accessibilityRole="checkbox"
                    disabled={pending || retryAvailable}
                    accessibilityState={{ checked: formDraft.consent }}
                    onPress={() => setField("consent", !formDraft.consent)}
                    style={[styles.row, { alignItems: "flex-start", paddingVertical: 8 }]}
                >
                    <MaterialCommunityIcons name={formDraft.consent ? "checkbox-marked" : "checkbox-blank-outline"} size={24} color={formDraft.consent ? colors.leaf : colors.muted} />
                    <AppText style={{ flex: 1 }}>By submitting, you agree we may contact you about this request via WhatsApp, phone or email.</AppText>
                </Pressable>
                <Text accessibilityRole="link" onPress={() => void Linking.openURL(`${WEB_URL}/privacy`)} style={{ color: colors.leaf, textDecorationLine: "underline", fontWeight: "700" }}>Privacy policy</Text>
                {errors.consent ? <FieldError>{errors.consent}</FieldError> : null}
            </View>

            <View ref={(node) => { fieldViews.current.turnstile_token = node; }}>
                <Label>Security check</Label>
                <TurnstileChallenge attempt={turnstileAttempt} onToken={receiveTurnstileToken} onStatus={updateTurnstile} />
                <AppText accessibilityLiveRegion="polite" style={styles.muted}>
                    {turnstileStatus === "verified" ? "Security check complete." : turnstileStatus === "error" ? "Security check failed. Retry it before sending." : "Verifying your request…"}
                </AppText>
                {errors.turnstile_token ? <FieldError>{errors.turnstile_token}</FieldError> : null}
            </View>

            {requestMessage ? (
                <View style={{ gap: 10 }}>
                    <ErrorNotice message={requestMessage} />
                    {retryAvailable ? (
                        <ActionButton secondary onPress={retryRequest}>Retry quote request</ActionButton>
                    ) : null}
                    {retryAvailable ? (
                        <ActionButton secondary icon={<MaterialCommunityIcons name="whatsapp" size={19} color={colors.forest} />} onPress={() => void Linking.openURL(whatsappUrl(fallbackMessage(lines, formDraft)))}>
                            Contact the farm on WhatsApp
                        </ActionButton>
                    ) : null}
                </View>
            ) : null}

            <SubmitAction pending={pending} disabledReason={disabledReason} onPress={handleSubmit} />
            {turnstileStatus === "error" ? <ActionButton secondary onPress={retryRequest}>Retry security check</ActionButton> : null}
        </Screen>
    );
}

function Label({ children }: { children: string }) {
    return <AppText style={{ fontSize: 15, fontWeight: "800", color: colors.forest, marginBottom: 6 }}>{children}</AppText>;
}

function FieldError({ children }: { children?: string }) {
    return <AppText accessibilityRole="alert" style={{ color: colors.danger, fontSize: 13, marginTop: 5 }}>{children}</AppText>;
}

function Choice({ selected, label, onPress, disabled = false }: { selected: boolean; label: string; onPress: () => void; disabled?: boolean }) {
    return (
        <Pressable accessibilityRole="radio" accessibilityState={{ checked: selected, disabled }} disabled={disabled} onPress={onPress} style={{ minHeight: 46, paddingHorizontal: 14, borderRadius: 24, borderWidth: 1, borderColor: selected ? colors.leaf : colors.border, backgroundColor: selected ? colors.mint : colors.white, alignItems: "center", justifyContent: "center", opacity: disabled ? 0.55 : 1 }}>
            <Text style={{ color: selected ? colors.forest : colors.ink, fontWeight: "700" }}>{label}</Text>
        </Pressable>
    );
}

function formatDate(dateKey: string) {
    if (!dateKey) return "Choose a date";
    return new Intl.DateTimeFormat("en-NG", { dateStyle: "full", timeZone: "Africa/Lagos" }).format(localDateForPicker(dateKey));
}

function fishLabel(value: string) {
    return value === "any" ? "Either fish type" : `${value.charAt(0).toUpperCase()}${value.slice(1)} catfish`;
}

function fallbackMessage(lines: CheckoutLine[], draft: CheckoutDraft) {
    const summary = lines.map((line) => `${line.quantity_kg}kg ${line.size_label} ${line.fish_type}`).join(", ");
    return `Hi HCT Fish Farms, I had trouble sending my quote request. I'd like ${summary}. Preferred date: ${draft.preferred_date}. Please help me complete it.`;
}

const fieldErrorStyle = { borderColor: colors.danger, borderWidth: 2 } as const;