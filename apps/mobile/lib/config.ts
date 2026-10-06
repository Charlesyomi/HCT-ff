const apiUrl = process.env.EXPO_PUBLIC_API_URL;
const webUrl = process.env.EXPO_PUBLIC_WEB_URL;
export const TURNSTILE_SITE_KEY = process.env.EXPO_PUBLIC_TURNSTILE_SITE_KEY ?? "";

if (!apiUrl || !webUrl) {
    throw new Error("Set EXPO_PUBLIC_API_URL and EXPO_PUBLIC_WEB_URL in apps/mobile/.env.local.");
}

export const API_URL = apiUrl.replace(/\/$/, "");
export const WEB_URL = webUrl.replace(/\/$/, "");

export function imageUrl(imagePath: string): string {
    return new URL(imagePath, `${WEB_URL}/`).toString();
}