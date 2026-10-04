import { requireOptionalNativeModule } from "expo-modules-core";

/** A recognised line of text with its normalised bounding box (0..1, origin top-left). */
export interface OcrLine {
  text: string;
  confidence: number;
  box: { x: number; y: number; width: number; height: number };
}
export interface OcrResult {
  text: string;
  lines: OcrLine[];
  width: number;
  height: number;
  /** "vision" (Apple), "mlkit" (Android) */
  engine: string;
  /** Milliseconds spent in the recogniser. */
  durationMs: number;
}
export interface Barcode {
  payload: string;
  symbology: string;
}
export interface RecognizeOptions {
  /** "accurate" uses the neural recogniser (default); "fast" is the lightweight path. */
  level?: "accurate" | "fast";
  /** Hint the languages (BCP-47). Defaults to device languages + en-US. */
  languages?: string[];
  /** Apply language correction (helps labels, hurts receipts' SKU codes). Default true. */
  languageCorrection?: boolean;
}

interface NativeModule {
  recognize(uri: string, options: RecognizeOptions): Promise<OcrResult>;
  detectBarcodes(uri: string): Promise<Barcode[]>;
  isAvailable(): boolean;
}

const native = requireOptionalNativeModule<NativeModule>("VisionOcr");

export function isNativeOcrAvailable(): boolean {
  return !!native && native.isAvailable();
}

export async function recognize(uri: string, options: RecognizeOptions = {}): Promise<OcrResult | null> {
  if (!native) return null;
  return native.recognize(uri, { level: "accurate", languageCorrection: true, ...options });
}

export async function detectBarcodes(uri: string): Promise<Barcode[]> {
  if (!native) return [];
  return native.detectBarcodes(uri);
}
