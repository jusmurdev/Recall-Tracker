import { Platform } from "react-native";

/**
 * On-device OCR via Google ML Kit (@react-native-ml-kit/text-recognition). The module needs a
 * native build (expo prebuild / EAS), so it is loaded lazily: in Expo Go or on web we fall back
 * to barcode-only scanning plus manual entry.
 */
export async function recognizeText(imageUri: string): Promise<string | null> {
  if (Platform.OS === "web") return null;
  try {
    const mod = (await import("@react-native-ml-kit/text-recognition")) as unknown as {
      default: { recognize: (uri: string) => Promise<{ text: string }> };
    };
    const result = await mod.default.recognize(imageUri);
    return result.text?.trim() || null;
  } catch (err) {
    console.warn("OCR unavailable in this build", err);
    return null;
  }
}
