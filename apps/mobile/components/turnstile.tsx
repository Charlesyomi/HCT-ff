import { Text, View } from "react-native";
import WebView, { type WebViewMessageEvent } from "react-native-webview";
import { TURNSTILE_SITE_KEY, WEB_URL } from "../lib/config";
import { colors, styles } from "../lib/theme";

interface TurnstileMessage {
    type: "token" | "status" | "error" | "expired";
    value?: string;
}

function widgetHtml(siteKey: string): string {
    const safeSiteKey = JSON.stringify(siteKey).replace(/</g, "\\u003c");
    return `<!doctype html>
<html><head><meta name="viewport" content="width=device-width,initial-scale=1,maximum-scale=1" />
<style>html,body{margin:0;padding:0;background:transparent;color:#637268;font:14px sans-serif}#widget{min-height:160px}</style>
<script>
function send(type,value){if(window.ReactNativeWebView){window.ReactNativeWebView.postMessage(JSON.stringify({type:type,value:value}));}}
function startWidget(){
  if(!window.turnstile){send('error');return;}
  send('status','verifying');
  try{
    var widgetId=window.turnstile.render('#widget',{
      sitekey:${safeSiteKey},size:'invisible',appearance:'execute',execution:'execute',
      callback:function(token){send('token',token);},
      'expired-callback':function(){send('expired');},
      'error-callback':function(){send('error');}
    });
    window.turnstile.execute(widgetId);
  }catch(_error){send('error');}
}
</script>
<script src="https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit" async defer onload="startWidget()" onerror="send('error')"></script>
</head><body><div id="widget"></div></body></html>`;
}

export function TurnstileChallenge({
    attempt,
    onToken,
    onStatus,
}: {
    attempt: number;
    onToken: (token: string | null) => void;
    onStatus: (status: "loading" | "verifying" | "verified" | "error" | "missing-config") => void;
}) {
    function handleMessage(event: WebViewMessageEvent) {
        let message: TurnstileMessage;
        try {
            message = JSON.parse(event.nativeEvent.data) as TurnstileMessage;
        } catch {
            onToken(null);
            onStatus("error");
            return;
        }
        if (message.type === "token" && message.value) {
            onToken(message.value);
            onStatus("verified");
        } else if (message.type === "status") {
            onStatus("verifying");
        } else if (message.type === "expired") {
            onToken(null);
            onStatus("error");
        } else if (message.type === "error") {
            onToken(null);
            onStatus("error");
        }
    }

    if (!TURNSTILE_SITE_KEY) {
        return (
            <View style={styles.errorPanel}>
                <Text style={{ color: colors.danger, fontWeight: "700" }}>
                    Turnstile site key is missing. Set EXPO_PUBLIC_TURNSTILE_SITE_KEY to the public Cloudflare site key.
                </Text>
            </View>
        );
    }

    return (
        <WebView
            key={attempt}
            source={{ html: widgetHtml(TURNSTILE_SITE_KEY), baseUrl: `${WEB_URL}/` }}
            originWhitelist={["https://*", "about:blank"]}
            javaScriptEnabled
            domStorageEnabled
            scrollEnabled={false}
            automaticallyAdjustContentInsets={false}
            onMessage={handleMessage}
            onError={() => {
                onToken(null);
                onStatus("error");
            }}
            style={{ height: 180, backgroundColor: "transparent" }}
        />
    );
}