import { createPKCEPair } from "./pkce";
import { signInWithGoogle } from "./sign-in";

jest.mock("expo-crypto", () => ({
    CryptoDigestAlgorithm: { SHA256: "SHA-256" },
    CryptoEncoding: { BASE64: "base64" },
    getRandomBytesAsync: jest.fn(async () => Uint8Array.from(Array.from({ length: 32 }, (_, index) => index))),
    digestStringAsync: jest.fn(async () => "a+b/c=="),
}));

jest.mock("expo-linking", () => ({
    createURL: jest.fn(() => "adesoba://auth"),
    parse: jest.fn((url: string) => ({ queryParams: { code: new URL(url).searchParams.get("code") } })),
}));

jest.mock("expo-web-browser", () => ({
    maybeCompleteAuthSession: jest.fn(),
    openAuthSessionAsync: jest.fn(async () => ({ type: "success", url: "adesoba://auth?code=single-use-code" })),
}));

jest.mock("expo-secure-store", () => ({
    getItemAsync: jest.fn(async () => null),
    setItemAsync: jest.fn(async () => undefined),
    deleteItemAsync: jest.fn(async () => undefined),
}));

describe("mobile Google PKCE sign-in", () => {
    it("creates an RFC 7636 S256 verifier and challenge", async () => {
        const pair = await createPKCEPair();

        expect(pair.codeVerifier).toBe("AAECAwQFBgcICQoLDA0ODxAREhMUFRYXGBkaGxwdHh8");
        expect(pair.codeChallenge).toBe("a-b_c");
    });

    it("opens the backend flow and exchanges the returned code with its verifier", async () => {
        const fetcher = jest.fn(async () => ({
            ok: true,
            status: 200,
            json: async () => ({ access_token: "mobile-access-token", token_type: "Bearer" }),
        }) as Response);

        await expect(signInWithGoogle(fetcher)).resolves.toBe("mobile-access-token");

        const { openAuthSessionAsync } = jest.requireMock("expo-web-browser") as {
            openAuthSessionAsync: jest.Mock;
        };
        const [startUrl, redirectUri] = openAuthSessionAsync.mock.calls[0] as [string, string];
        const authUrl = new URL(startUrl);
        expect(authUrl.origin).toBe("https://shop.example.test");
        expect(authUrl.pathname).toBe("/api/v1/auth/google/start");
        expect(authUrl.searchParams.get("client")).toBe("mobile");
        expect(authUrl.searchParams.get("redirect_uri")).toBe("adesoba://auth");
        expect(authUrl.searchParams.get("code_challenge")).toBe("a-b_c");
        expect(redirectUri).toBe("adesoba://auth");
        expect(fetcher).toHaveBeenCalledWith(
            "https://api.example.test/api/v1/auth/mobile/token",
            expect.objectContaining({
                method: "POST",
                body: JSON.stringify({
                    code: "single-use-code",
                    code_verifier: "AAECAwQFBgcICQoLDA0ODxAREhMUFRYXGBkaGxwdHh8",
                }),
            }),
        );

        const { setItemAsync } = jest.requireMock("expo-secure-store") as { setItemAsync: jest.Mock };
        expect(setItemAsync).toHaveBeenCalledWith("adesoba.access-token", "mobile-access-token");
    });
});