import { Platform } from "react-native";
import * as VisionOcr from "../../modules/vision-ocr";
import { receiptTextFromLines } from "./receiptLayout";

export interface OcrOutcome {
  text: string;
  /** Lines with positions when the native engine supplied them. */
  lines: VisionOcr.OcrLine[];
  engine: "vision" | "mlkit" | "mlkit-legacy" | "none";
  durationMs: number;
}

/**
 * On-device OCR, best engine first:
 *  1. Our native module: Apple Vision (accurate mode, Neural Engine) on iOS, ML Kit bundled on
 *     Android. Returns positioned lines, so receipts can be rebuilt into rows.
 *  2. The @react-native-ml-kit/text-recognition package (older builds).
 *  3. Nothing (Expo Go / web): the caller falls back to typing.
 * Text never leaves the phone until the user taps "Check it".
 */
export async function recognizeText(imageUri: string, kind: "label" | "receipt" = "label"): Promise<OcrOutcome> {
  if (Platform.OS === "web") return { text: "", lines: [], engine: "none", durationMs: 0 };
  const started = Date.now();
  try {
    if (VisionOcr.isNativeOcrAvailable()) {
      // Receipts: no language correction (it "fixes" SKU codes and abbreviations), and an
      // explicit English hint keeps the recogniser from guessing other scripts on cryptic text.
      const result = await VisionOcr.recognize(imageUri, kind === "receipt" ? { level: "accurate", languageCorrection: false, languages: ["en-US"] } : { level: "accurate", languageCorrection: true });
      if (result) {
        const text = kind === "receipt" && result.lines.length ? receiptTextFromLines(result.lines) : result.text;
        return { text: text.trim(), lines: result.lines, engine: result.engine === "vision" ? "vision" : "mlkit", durationMs: result.durationMs };
      }
    }
  } catch (err) {
    console.warn("native OCR failed; trying legacy", err);
  }
  try {
    const mod = (await import("@react-native-ml-kit/text-recognition")) as unknown as { default: { recognize: (uri: string) => Promise<{ text: string }> } };
    const result = await mod.default.recognize(imageUri);
    return { text: result.text?.trim() ?? "", lines: [], engine: "mlkit-legacy", durationMs: Date.now() - started };
  } catch (err) {
    console.warn("OCR unavailable in this build", err);
    return { text: "", lines: [], engine: "none", durationMs: Date.now() - started };
  }
}

/** Barcodes in a still photo (so a label snap also yields the UPC when it's in frame). */
export async function barcodesInPhoto(imageUri: string): Promise<string[]> {
  if (Platform.OS === "web") return [];
  try {
    const codes = await VisionOcr.detectBarcodes(imageUri);
    return codes.map((c) => c.payload.replace(/\D/g, "")).filter((d) => d.length >= 8 && d.length <= 14);
  } catch {
    return [];
  }
}
