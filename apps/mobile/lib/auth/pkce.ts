import * as Crypto from "expo-crypto";

const BASE64 = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_";

function base64Url(bytes: Uint8Array): string {
    let result = "";
    for (let index = 0; index < bytes.length; index += 3) {
        const first = bytes[index] ?? 0;
        const second = bytes[index + 1];
        const third = bytes[index + 2];
        result += BASE64[first >> 2];
        result += BASE64[((first & 3) << 4) | ((second ?? 0) >> 4)];
        if (second !== undefined) result += BASE64[((second & 15) << 2) | ((third ?? 0) >> 6)];
        if (third !== undefined) result += BASE64[third & 63];
    }
    return result;
}

function base64StringToUrl(value: string): string {
    return value.replace(/=/g, "").replace(/\+/g, "-").replace(/\//g, "_");
}

export async function createPKCEPair(): Promise<{
    codeVerifier: string;
    codeChallenge: string;
}> {
    const codeVerifier = base64Url(await Crypto.getRandomBytesAsync(32));
    const digest = await Crypto.digestStringAsync(
        Crypto.CryptoDigestAlgorithm.SHA256,
        codeVerifier,
        { encoding: Crypto.CryptoEncoding.BASE64 },
    );
    return { codeVerifier, codeChallenge: base64StringToUrl(digest) };
}