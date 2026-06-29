import React from "react";
import { Linking, type StyleProp, Text, type TextStyle } from "react-native";

// Split on URLs while KEEPING the URLs as their own parts (capturing group).
const URL_SPLIT = /(https?:\/\/[^\s]+)/g;
const isUrl = (s: string) => /^https?:\/\//.test(s);

/**
 * Renders a plain string, turning any http(s) URLs into tappable links.
 *
 * For READ-ONLY display of user-entered text (e.g. a market description that may
 * contain a pasted article link). Editable <TextInput>s cannot render live links,
 * so this is for display surfaces only — the compose field stays plain text.
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
  const parts = text.split(URL_SPLIT);
  return (
    <Text style={style} numberOfLines={numberOfLines}>
      {parts.map((part, i) =>
        isUrl(part) ? (
          <Text
            key={i}
            style={linkStyle}
            onPress={() => {
              void Linking.openURL(part).catch(() => undefined);
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
