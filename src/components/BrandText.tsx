import React from "react";
import { StyleSheet, Text as NativeText, type TextProps } from "react-native";

const FONT_BY_WEIGHT: Record<string, string> = {
  "400": "Manrope_400Regular",
  normal: "Manrope_400Regular",
  "500": "Manrope_500Medium",
  "600": "Manrope_600SemiBold",
  "700": "Manrope_700Bold",
  bold: "Manrope_700Bold",
  "800": "Manrope_800ExtraBold",
  "900": "Manrope_800ExtraBold",
};

export function BrandText({ style, ...props }: TextProps) {
  const flattened = StyleSheet.flatten(style);
  const weight = flattened?.fontWeight;
  const fontFamily = FONT_BY_WEIGHT[String(weight ?? "400")] ?? "Manrope_400Regular";
  return <NativeText {...props} style={[style, { fontFamily }]} />;
}
