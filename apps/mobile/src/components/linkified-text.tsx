import React from "react";
import { Linking, type StyleProp, Text, type TextStyle } from "react-native";
import { useRouter } from "expo-router";

// Split on URLs while KEEPING the URLs as their own parts (capturing group).
const URL_SPLIT = /(https?:\/\/[^\s]+)/g;
const isUrl = (s: string) => /^https?:\/\//.test(s);

function isInternalUrl(url: string): boolean {
  try {
    return new URL(url).hostname.replace(/^www\./, "") === "predictfuture.app";
  } catch {
    return false;
  }
}

function getInternalPath(url: string): string {
  try {
    const u = new URL(url);
    return u.pathname + u.search + u.hash;
  } catch {
    return "/";
  }
}

/**
 * Renders a plain string, turning any http(s) URLs into tappable links.
 *
 * For READ-ONLY display of user-entered text (e.g. a market description that may
 * contain a pasted article link). Editable <TextInput>s cannot render live links,
 * so this is for display surfaces only — the compose field stays plain text.
 *
 * URLs on the predictfuture.app domain are routed in-app via expo-router.
 * All other URLs open in the system browser via Linking.openURL.
 */
export function LinkifiedText({
  text,
  style,
  linkStyle,
  numberOfLines,
}: {
  text: string;
  style?: StyleProp<TextStyle>;
  linkStyle?: StyleProp<TextStyle>;
  numberOfLines?: number;
}) {
  const router = useRouter();
  const parts = text.split(URL_SPLIT);
  return (
    <Text style={style} numberOfLines={numberOfLines}>
      {parts.map((part, i) =>
        isUrl(part) ? (
          <Text
            key={i}
            style={linkStyle}
            onPress={() => {
              if (isInternalUrl(part)) {
                router.push(getInternalPath(part) as Parameters<typeof router.push>[0]);
              } else {
                void Linking.openURL(part).catch(() => undefined);
              }
            }}
          >
            {part}
          </Text>
        ) : (
          <Text key={i}>{part}</Text>
        )
      )}
    </Text>
  );
}
