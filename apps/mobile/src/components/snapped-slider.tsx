import { useState } from "react";
import {
  GestureResponderEvent,
  LayoutChangeEvent,
  StyleSheet,
  View,
  ViewStyle,
} from "react-native";

/**
 * JS-only snapped slider — no native module dependency.
 * Drop-in replacement for @react-native-community/slider with step=1.
 *
 * Renders a track with N tick marks and a thumb that snaps to the nearest
 * tick on tap or pan. Works identically across iOS/Android and never
 * requires a native rebuild.
 */
type Props = {
  value: number;
  minimumValue?: number;
  maximumValue?: number;
  step?: number;
  onValueChange?: (value: number) => void;
  disabled?: boolean;
  minimumTrackTintColor?: string;
  maximumTrackTintColor?: string;
  thumbTintColor?: string;
  style?: ViewStyle;
};

const THUMB_SIZE = 20;
const TRACK_HEIGHT = 4;
const TICK_SIZE = 8;

export function SnappedSlider({
  value,
  minimumValue = 0,
  maximumValue = 4,
  step = 1,
  onValueChange,
  disabled = false,
  minimumTrackTintColor = "#3A86FF",
  maximumTrackTintColor = "#e5e7eb",
  thumbTintColor = "#3A86FF",
  style,
}: Props) {
  const [width, setWidth] = useState(0);
  const positions = Math.floor((maximumValue - minimumValue) / step) + 1;
  const clamped = Math.max(minimumValue, Math.min(maximumValue, value));

  const onLayout = (e: LayoutChangeEvent) => {
    setWidth(e.nativeEvent.layout.width);
  };

  const updateFromX = (x: number) => {
    if (disabled || width <= 0 || !onValueChange) return;
    const usable = Math.max(1, width - THUMB_SIZE);
    const clampedX = Math.max(0, Math.min(usable, x - THUMB_SIZE / 2));
    const ratio = clampedX / usable;
    const rawIndex = Math.round(ratio * (positions - 1));
    const next = minimumValue + rawIndex * step;
    if (next !== clamped) {
      onValueChange(next);
    }
  };

  const handleStart = (e: GestureResponderEvent) => {
    updateFromX(e.nativeEvent.locationX);
  };
  const handleMove = (e: GestureResponderEvent) => {
    updateFromX(e.nativeEvent.locationX);
  };

  const usableWidth = Math.max(0, width - THUMB_SIZE);
  const ratio = positions > 1 ? (clamped - minimumValue) / (maximumValue - minimumValue) : 0;
  const thumbLeft = ratio * usableWidth;

  return (
    <View
      style={[styles.container, style]}
      onLayout={onLayout}
      onStartShouldSetResponder={() => !disabled}
      onMoveShouldSetResponder={() => !disabled}
      onResponderGrant={handleStart}
      onResponderMove={handleMove}
      onResponderRelease={handleMove}
    >
      {/* Background track */}
      <View
        style={[
          styles.track,
          {
            backgroundColor: maximumTrackTintColor,
            left: THUMB_SIZE / 2,
            right: THUMB_SIZE / 2,
          },
        ]}
      />
      {/* Filled track up to thumb */}
      <View
        style={[
          styles.track,
          {
            backgroundColor: minimumTrackTintColor,
            left: THUMB_SIZE / 2,
            width: thumbLeft,
            opacity: disabled ? 0.5 : 1,
          },
        ]}
      />
      {/* Tick marks */}
      {Array.from({ length: positions }).map((_, i) => {
        const tickRatio = positions > 1 ? i / (positions - 1) : 0;
        const tickLeft = tickRatio * usableWidth + THUMB_SIZE / 2 - TICK_SIZE / 2;
        const isActive = i === clamped - minimumValue;
        return (
          <View
            key={i}
            pointerEvents="none"
            style={[
              styles.tick,
              {
                left: tickLeft,
                backgroundColor: isActive ? thumbTintColor : maximumTrackTintColor,
                opacity: disabled ? 0.5 : 1,
              },
            ]}
          />
        );
      })}
      {/* Thumb */}
      <View
        pointerEvents="none"
        style={[
          styles.thumb,
          {
            left: thumbLeft,
            backgroundColor: thumbTintColor,
            opacity: disabled ? 0.6 : 1,
          },
        ]}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    width: "100%",
    height: THUMB_SIZE + 8,
    justifyContent: "center",
  },
  track: {
    position: "absolute",
    top: (THUMB_SIZE + 8 - TRACK_HEIGHT) / 2,
    height: TRACK_HEIGHT,
    borderRadius: TRACK_HEIGHT / 2,
  },
  tick: {
    position: "absolute",
    top: (THUMB_SIZE + 8 - TICK_SIZE) / 2,
    width: TICK_SIZE,
    height: TICK_SIZE,
    borderRadius: TICK_SIZE / 2,
  },
  thumb: {
    position: "absolute",
    top: 4,
    width: THUMB_SIZE,
    height: THUMB_SIZE,
    borderRadius: THUMB_SIZE / 2,
    shadowColor: "#000",
    shadowOpacity: 0.15,
    shadowRadius: 3,
    shadowOffset: { width: 0, height: 1 },
    elevation: 3,
  },
});
