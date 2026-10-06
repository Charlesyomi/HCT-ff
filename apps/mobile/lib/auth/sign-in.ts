import * as Linking from "expo-linking";
import * as WebBrowser from "expo-web-browser";
import { API_URL, WEB_URL } from "../config";
import { apiError } from "../api/errors";
import { createPKCEPair } from "./pkce";
import { saveAccessToken } from "./token";

WebBrowser.maybeCompleteAuthSession();

export async function signInWithGoogle(fetcher: typeof fetch = fetch): Promise<string> {
    const { codeVerifier, codeChallenge } = await createPKCEPair();
    const redirectUri = Linking.createURL("auth");
    const startUrl = new URL("/api/v1/auth/google/start", `${WEB_URL}/`);
    startUrl.searchParams.set("client", "mobile");
    startUrl.searchParams.set("redirect_uri", redirectUri);
    startUrl.searchParams.set("code_challenge", codeChallenge);

    const result = await WebBrowser.openAuthSessionAsync(startUrl.toString(), redirectUri);
    if (result.type !== "success") {
        throw new Error(result.type === "cancel" ? "Google sign-in was cancelled." : "Google sign-in did not finish.");
    }

    const codeValue = Linking.parse(result.url).queryParams?.code;
    const code = Array.isArray(codeValue) ? codeValue[0] : codeValue;
    if (typeof code !== "string" || !code) {
        throw new Error("Google sign-in returned no authorization code.");
    }

    const response = await fetcher(`${API_URL}/api/v1/auth/mobile/token`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ code, code_verifier: codeVerifier }),
    });
    const body: unknown = await response.json();
    if (!response.ok) throw apiError(response.status, body);

    if (typeof body !== "object" || body === null || !("access_token" in body)) {
        throw new Error("The sign-in response did not include an access token.");
    }
    const token = body.access_token;
    if (typeof token !== "string" || !token) {
        throw new Error("The sign-in response included an invalid access token.");
    }

    await saveAccessToken(token);
    return token;
}