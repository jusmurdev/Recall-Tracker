import { Ionicons } from "@expo/vector-icons";
import { CameraView, useCameraPermissions, type BarcodeScanningResult } from "expo-camera";
import * as Haptics from "expo-haptics";
import * as ImageManipulator from "expo-image-manipulator";
import { router } from "expo-router";
import React, { useRef, useState } from "react";
import { Pressable, ScrollView, StyleSheet, Switch, Text, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import type { ReceiptScanResponse, ScanMatchResponse } from "@recall/shared";
import { api, ApiError } from "@/api/client";
import { Body, Button, Card, Empty, Input, PremiumTag, RecallRow, Screen, Small, Subtitle } from "@/components/ui";
import { useMe, useScanMatch, useScanReceipt } from "@/hooks/queries";
import { recognizeText } from "@/lib/ocr";
import { colors, radius, spacing } from "@/lib/theme";
import { ReceiptResults } from "@/components/ReceiptResults";

type Target = "product" | "receipt";
type Mode = "camera" | "manual" | "product-result" | "receipt-result";

/**
 * One tap: snap it, we read it, you get a verdict. Two targets share the camera:
 * a product (barcode or label) and a receipt (every line checked).
 */
export default function ScanScreen() {
  const [permission, requestPermission] = useCameraPermissions();
  const camera = useRef<CameraView>(null);
  const me = useMe();
  const premium = me.data?.tier === "premium";
  const scan = useScanMatch();
  const receipt = useScanReceipt();
  const [target, setTarget] = useState<Target>("product");
  const [mode, setMode] = useState<Mode>("camera");
  const [busy, setBusy] = useState<string | null>(null);
  const [text, setText] = useState("");
  const [photo, setPhoto] = useState<{ uri: string; base64?: string } | null>(null);
  const [watch, setWatch] = useState(true);
  const [productResult, setProductResult] = useState<ScanMatchResponse | null>(null);
  const [receiptResult, setReceiptResult] = useState<ReceiptScanResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const lastBarcode = useRef<string | null>(null);

  const reset = () => {
    setMode("camera");
    setText("");
    setPhoto(null);
    setProductResult(null);
    setReceiptResult(null);
    setError(null);
    lastBarcode.current = null;
  };

  const checkProduct = async (input: { upc?: string; ocrText?: string }) => {
    setBusy("Checking…");
    setError(null);
    try {
      const res = await scan.mutateAsync({ ...input, watch });
      setProductResult(res);
      setMode("product-result");
      void Haptics.notificationAsync(res.matches.length ? Haptics.NotificationFeedbackType.Warning : Haptics.NotificationFeedbackType.Success);
    } catch (e) {
      setError((e as Error).message);
      setMode("manual");
    } finally {
      setBusy(null);
    }
  };

  const checkReceipt = async (input: { ocrText?: string; imageBase64?: string }) => {
    setBusy("Reading your receipt…");
    setError(null);
    try {
      const res = await receipt.mutateAsync({ ...input, watch });
      setReceiptResult(res);
      setMode("receipt-result");
      void Haptics.notificationAsync(res.flagged ? Haptics.NotificationFeedbackType.Warning : Haptics.NotificationFeedbackType.Success);
    } catch (e) {
      if (e instanceof ApiError && e.premiumRequired) router.push("/premium");
      setError((e as Error).message);
      setMode("manual");
    } finally {
      setBusy(null);
    }
  };

  const onBarcode = (r: BarcodeScanningResult) => {
    if (target !== "product" || mode !== "camera" || busy) return;
    const digits = r.data.replace(/\D/g, "");
    if (digits.length < 8 || digits === lastBarcode.current) return;
    lastBarcode.current = digits;
    void Haptics.selectionAsync();
    void checkProduct({ upc: digits });
  };

  const capture = async () => {
    if (!camera.current || busy) return;
    setBusy("Reading…");
    try {
      const shot = await camera.current.takePictureAsync({ quality: 0.85, skipProcessing: true });
      if (!shot) return;
      const small = await ImageManipulator.manipulateAsync(shot.uri, [{ resize: { width: target === "receipt" ? 1600 : 1280 } }], { compress: 0.75, format: ImageManipulator.SaveFormat.JPEG, base64: true });
      setPhoto({ uri: small.uri, base64: small.base64 });
      const ocr = (await recognizeText(small.uri)) ?? "";
      setText(ocr);
      if (target === "receipt") {
        if (ocr.trim().length > 10) await checkReceipt({ ocrText: ocr, ...(premium && small.base64 ? { imageBase64: small.base64 } : {}) });
        else if (premium && small.base64) await checkReceipt({ imageBase64: small.base64 });
        else {
          setError("Couldn't read the receipt. Try better light, or type a few lines below.");
          setMode("manual");
        }
      } else if (ocr.trim().length > 2) await checkProduct({ ocrText: ocr });
      else {
        setError("Couldn't read the label. Try again closer, or type the name below.");
        setMode("manual");
      }
    } finally {
      setBusy(null);
    }
  };

  const identifyWithAi = async () => {
    if (!photo?.base64) return;
    setBusy("Looking closely…");
    try {
      const res = await api.scanIdentify({ imageBase64: photo.base64, mediaType: "image/jpeg", ocrText: text || undefined });
      setProductResult(res);
      setMode("product-result");
    } catch (e) {
      if (e instanceof ApiError && e.premiumRequired) router.push("/premium");
      else setError((e as Error).message);
    } finally {
      setBusy(null);
    }
  };

  if (!permission) return <Screen />;

  // ---------- Results ----------
  if (mode === "product-result" && productResult) {
    const hit = productResult.matches.length > 0;
    return (
      <Screen>
        <ScrollView contentContainerStyle={{ padding: spacing(2), gap: spacing(2), paddingBottom: spacing(6) }}>
          <Card tone={hit ? (productResult.matches.some((m) => m.recall.severity === "critical") ? "critical" : "high") : "success"}>
            <View style={styles.heroRow}>
              <Ionicons name={hit ? "alert-circle" : "checkmark-circle"} size={32} color={hit ? colors.critical : colors.success} />
              <View style={{ flex: 1 }}>
                <Subtitle>{hit ? (productResult.matches.length === 1 ? "This might be recalled" : `${productResult.matches.length} possible recalls`) : "Looks fine"}</Subtitle>
                <Small>
                  {hit ? "Open one and compare the codes on your package." : `No recall matches ${productResult.extracted.brand ?? productResult.extracted.terms[0] ?? "this"} in the last six months.`}
                  {productResult.watchItem ? " We'll keep an eye on it." : ""}
                </Small>
              </View>
            </View>
          </Card>
          {productResult.matches.map((m) => (
            <RecallRow key={m.recall.id} recall={m.recall} onPress={() => router.push(`/recall/${m.recall.id}`)} />
          ))}
          {!hit && photo && premium ? <Button title="Not the right product? Look closer with AI" variant="secondary" icon="sparkles" loading={!!busy} onPress={() => void identifyWithAi()} /> : null}
          <Button title="Scan another" icon="scan" onPress={reset} />
        </ScrollView>
      </Screen>
    );
  }

  if (mode === "receipt-result" && receiptResult) {
    return (
      <Screen>
        <ScrollView contentContainerStyle={{ padding: spacing(2), gap: spacing(2), paddingBottom: spacing(6) }}>
          <ReceiptResults result={receiptResult} />
          {!receiptResult.watched ? (
            <Button
              title={`Watch all ${receiptResult.items.length} items`}
              icon="eye"
              variant="secondary"
              loading={receipt.isPending}
              onPress={() => void receipt.mutateAsync({ ocrText: text || undefined, watch: true }).then(setReceiptResult)}
            />
          ) : null}
          <Button title="Scan another" icon="scan" onPress={reset} />
        </ScrollView>
      </Screen>
    );
  }

  // ---------- Manual entry ----------
  if (mode === "manual" || !permission.granted) {
    return (
      <SafeAreaView style={{ flex: 1, backgroundColor: colors.bg }} edges={["top"]}>
        <Screen>
          <ScrollView contentContainerStyle={{ padding: spacing(2), gap: spacing(2) }} keyboardShouldPersistTaps="handled">
            <TargetSwitch target={target} onChange={setTarget} />
            {!permission.granted ? (
              <Empty icon="camera-outline" title={target === "receipt" ? "Snap your receipt" : "Point, snap, done"} body={target === "receipt" ? "We'll check every item on it against current recalls." : "Scan a barcode or the label and we'll tell you in a second if it's been recalled."} />
            ) : null}
            {!permission.granted ? <Button title="Turn on the camera" icon="camera" onPress={() => void requestPermission()} /> : <Button title="Use the camera" icon="camera" variant="secondary" onPress={() => setMode("camera")} />}
            <Card>
              <Subtitle>{target === "receipt" ? "Or type what's on the receipt" : "Or type it in"}</Subtitle>
              <Input
                multiline
                placeholder={target === "receipt" ? "One item per line, e.g.\nJIF CRMY PNT BTR 16Z\nBOARS HEAD LVRWRST" : "Brand and product, e.g. Jif creamy peanut butter"}
                value={text}
                onChangeText={setText}
                style={{ minHeight: target === "receipt" ? 140 : 70 }}
                autoCapitalize="characters"
              />
              <View style={styles.switchRow}>
                <Body style={{ flex: 1 }}>{target === "receipt" ? "Keep an eye on all of these" : "Keep an eye on this for me"}</Body>
                <Switch value={watch} onValueChange={setWatch} trackColor={{ true: colors.accent }} />
              </View>
              <Button title={busy ?? "Check it"} icon="search" loading={!!busy} disabled={text.trim().length < 2} onPress={() => (target === "receipt" ? void checkReceipt({ ocrText: text }) : void checkProduct({ ocrText: text }))} />
              {error ? <Body style={{ color: colors.critical }}>{error}</Body> : null}
              {photo && target === "product" ? <Button title="Use the photo instead" variant="ghost" icon="sparkles" onPress={() => void identifyWithAi()} /> : null}
            </Card>
          </ScrollView>
        </Screen>
      </SafeAreaView>
    );
  }

  // ---------- Camera ----------
  return (
    <Screen>
      <CameraView ref={camera} style={{ flex: 1 }} facing="back" barcodeScannerSettings={{ barcodeTypes: ["upc_a", "upc_e", "ean13", "ean8"] }} onBarcodeScanned={onBarcode} />
      <SafeAreaView edges={["top"]} style={styles.topBar}>
        <TargetSwitch target={target} onChange={setTarget} onDark />
      </SafeAreaView>
      <View pointerEvents="none" style={styles.frameWrap}>
        <View style={[styles.frame, target === "receipt" && styles.frameTall]} />
      </View>
      <View style={styles.overlay}>
        <Text style={styles.hint}>{busy ?? (target === "receipt" ? "Lay the receipt flat and get the whole thing in the frame" : "Line up the barcode, or snap the front of the label")}</Text>
        <Button title={target === "receipt" ? "Snap the receipt" : "Snap the label"} icon="camera" loading={!!busy} onPress={() => void capture()} />
        <Button title="Type it in instead" variant="ghost" onPress={() => setMode("manual")} />
      </View>
    </Screen>
  );
}

function TargetSwitch({ target, onChange, onDark }: { target: Target; onChange: (t: Target) => void; onDark?: boolean }) {
  return (
    <View style={[styles.segment, onDark && { backgroundColor: "rgba(0,0,0,0.45)" }]}>
      {(["product", "receipt"] as Target[]).map((t) => {
        const on = target === t;
        return (
          <Pressable key={t} accessibilityRole="button" accessibilityState={{ selected: on }} onPress={() => onChange(t)} style={[styles.segmentItem, on && styles.segmentOn]}>
            <Ionicons name={t === "product" ? "cube-outline" : "receipt-outline"} size={16} color={on ? colors.accent : onDark ? "#fff" : colors.muted} />
            <Text style={[styles.segmentText, on ? { color: colors.accent } : onDark ? { color: "#fff" } : null]}>{t === "product" ? "A product" : "A receipt"}</Text>
          </Pressable>
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  heroRow: { flexDirection: "row", alignItems: "center", gap: 12 },
  switchRow: { flexDirection: "row", alignItems: "center", gap: 12 },
  topBar: { position: "absolute", top: 0, left: 0, right: 0, alignItems: "center", paddingTop: 8 },
  segment: { flexDirection: "row", backgroundColor: colors.cardAlt, borderRadius: radius.pill, padding: 4, alignSelf: "center" },
  segmentItem: { flexDirection: "row", alignItems: "center", gap: 6, paddingVertical: 8, paddingHorizontal: 16, borderRadius: radius.pill },
  segmentOn: { backgroundColor: colors.card },
  segmentText: { fontWeight: "700", color: colors.muted, fontSize: 14 },
  frameWrap: { position: "absolute", top: 0, left: 0, right: 0, bottom: 0, alignItems: "center", justifyContent: "center" },
  frame: { width: "78%", aspectRatio: 1.4, borderWidth: 3, borderColor: "rgba(255,255,255,0.9)", borderRadius: 18 },
  frameTall: { aspectRatio: 0.6, width: "62%" },
  overlay: { position: "absolute", left: 0, right: 0, bottom: 0, padding: spacing(2), gap: spacing(1), backgroundColor: "rgba(247,244,238,0.95)", borderTopLeftRadius: 22, borderTopRightRadius: 22 },
  hint: { color: colors.text, textAlign: "center", marginBottom: 4, fontWeight: "600" },
});
