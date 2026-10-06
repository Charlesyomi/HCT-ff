# HCT Fish Farms Mobile

Standalone HCT Fish Farms Expo SDK 57 app using React Native, TypeScript, Expo Router, TanStack Query, and the backend OpenAPI contract. It runs in Expo Go and sends quote requests without collecting payment.

## Run in Expo Go (WSL)

From WSL, install the mobile app's own dependencies and start the tunnel:

```bash
cd apps/mobile
npm install
cp .env.example .env.local
# Set the deployed API and website origins in .env.local.
npx expo start --tunnel
```

Open the Expo Go app on the phone and scan the terminal QR code. WSL tunnel mode is required when the phone cannot reach the WSL network interface directly. Use a current Expo Go release that supports SDK 57.

## Environment

`EXPO_PUBLIC_API_URL` is the API origin only, with no `/api/v1` suffix (for example, `https://<api-service>.onrender.com`). `EXPO_PUBLIC_WEB_URL` is the public website origin; catalogue `image_path` values and the Turnstile WebView origin use it. `EXPO_PUBLIC_TURNSTILE_SITE_KEY` must match the public Cloudflare site key used by the website. Never put `TURNSTILE_SECRET_KEY` in the mobile app.

The Cloudflare Turnstile widget must allow the hostname in `EXPO_PUBLIC_WEB_URL`. The app sends the one-use token with the quote request; the backend verifies it.

After changing either value, restart Expo with its cache cleared:

```bash
npx expo start --tunnel --clear
```

## Backend Google redirect allowlist

OAuth starts at `EXPO_PUBLIC_WEB_URL` so the temporary state cookie shares the website host with the configured Google callback; the existing web rewrite forwards the start and callback requests to the API. The one-time mobile-code exchange and subsequent authenticated API requests use `EXPO_PUBLIC_API_URL` directly.

The app's configured scheme produces the production redirect URI `adesoba://auth`. Add that exact value to the API environment:

```env
MOBILE_REDIRECT_ALLOWLIST=adesoba://auth
```

For Expo Go development, `Linking.createURL("auth")` produces an `exp://...` URL. Allow the development prefix and opt into it outside a development API environment with:

```env
MOBILE_REDIRECT_ALLOWLIST=adesoba://auth,exp://
MOBILE_ALLOW_EXPO_REDIRECTS=true
```

Keep `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`, and the deployed API's Google callback configuration set on the backend. The mobile app does not use a native Google SDK or contain OAuth client secrets.

## API types and tests

Regenerate API types from the repository OpenAPI document with `npm run generate:api`. Run `npm test`, `npm run typecheck`, and `npm run lint` from `apps/mobile`.

## APK preparation

`eas.json` has a `preview` profile configured to produce an Android APK. No build is run as part of this setup.