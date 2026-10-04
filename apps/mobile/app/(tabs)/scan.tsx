import { CameraView, useCameraPermissions, type BarcodeScanningResult } from "expo-camera";
import * as Haptics from "expo-haptics";
import * as ImageManipulator from "expo-image-manipulator";
import { router } from "expo-router";
import React, { useRef, useState } from "react";
import { ScrollView, StyleSheet, Switch, Text, View } from "react-native";
import type { ScanMatchResponse } from "@recall/shared";
import { api, ApiError } from "@/api/client";
import { Body, Button, Card, Empty, Input, PremiumTag, RecallRow, Screen, Subtitle } from "@/components/ui";
import { useMe, useScanMatch } from "@/hooks/queries";
import { recognizeText } from "@/lib/ocr";
import { colors, spacing } from "@/lib/theme";

type Mode = "camera" | "review";

export default function ScanScreen() {
  const [permission, requestPermission] = useCameraPermissions();
  const camera = useRef<CameraView>(null);
  const me = useMe();
  const scan = useScanMatch();
  const [mode, setMode] = useState<Mode>("camera");
  const [busy, setBusy] = useState(false);
  const [upc, setUpc] = useState<string | null>(null);
  const [ocrText, setOcrText] = useState("");
  const [context, setContext] = useState("");
  const [watch, setWatch] = useState(true);
  const [photo, setPhoto] = useState<{ uri: string; base64?: string } | null>(null);
  const [result, setResult] = useState<ScanMatchResponse | null>(null);
  const [aiBusy, setAiBusy] = useState(false);
  const lastBarcode = useRef<string | null>(null);

  if (!permission) return <Screen />;
  if (!permission.granted) {
    return (
      <Screen style={styles.center}>
        <Empty icon="camera-outline" title="Point, scan, done" body="Scan a barcode or snap the label and we'll tell you in a second if it's been recalled." />
        <Button title="Turn on the camera" icon="camera" onPress={() => void requestPermission()} />
        <Button title="Type it in instead" variant="ghost" onPress={() => setMode("review")} />
      </Screen>
    );
  }

  const onBarcode = (r: BarcodeScanningResult) => {
    const digits = r.data.replace(/\D/g, "");
    if (digits.length < 8 || digits === lastBarcode.current || mode !== "camera") return;
    lastBarcode.current = digits;
    void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    setUpc(digits);
    setMode("review");
  };

  const capture = async () => {
    if (!camera.current || busy) return;
    setBusy(true);
    try {
      const shot = await camera.current.takePictureAsync({ quality: 0.8, skipProcessing: true });
      if (!shot) return;
      const small = await ImageManipulator.manipulateAsync(shot.uri, [{ resize: { width: 1280 } }], { compress: 0.7, format: ImageManipulator.SaveFormat.JPEG, base64: true });
      setPhoto({ uri: small.uri, base64: small.base64 });
      const text = await recognizeText(small.uri);
      setOcrText(text ?? "");
      setMode("review");
    } finally {
      setBusy(false);
    }
  };

  const submit = async () => {
    const res = await scan.mutateAsync({ ocrText: ocrText || undefined, upc: upc ?? undefined, context: context || undefined, watch });
    setResult(res);
  };

  const identifyWithAi = async () => {
    if (!photo?.base64) return;
    setAiBusy(true);
    try {
      const res = await api.scanIdentify({ imageBase64: photo.base64, mediaType: "image/jpeg", ocrText: ocrText || undefined, context: context || undefined });
      setResult(res);
      if (!ocrText && res.identified.productName) setOcrText(`${res.identified.brand ?? ""} ${res.identified.productName}`.trim());
    } catch (err) {
      if (err instanceof ApiError && err.premiumRequired) router.push("/premium");
      else throw err;
    } finally {
      setAiBusy(false);
    }
  };

  const reset = () => {
    setMode("camera");
    setUpc(null);
    setOcrText("");
    setContext("");
    setPhoto(null);
    setResult(null);
    lastBarcode.current = null;
  };

  if (mode === "camera") {
    return (
      <Screen>
        <CameraView
          ref={camera}
          style={{ flex: 1 }}
          facing="back"
          barcodeScannerSettings={{ barcodeTypes: ["upc_a", "upc_e", "ean13", "ean8"] }}
          onBarcodeScanned={onBarcode}
        />
        <View style={styles.overlay}>
          <Text style={styles.hint}>Line up the barcode, or snap the front of the label</Text>
          <Button title={busy ? "Reading…" : "Snap the label"} icon="camera" loading={busy} onPress={() => void capture()} />
          <Button title="Type it in instead" variant="ghost" onPress={() => setMode("review")} />
        </View>
      </Screen>
    );
  }

  return (
    <Screen>
      <ScrollView contentContainerStyle={{ padding: spacing(2), gap: spacing(2) }} keyboardShouldPersistTaps="handled">
        <Card>
          <Subtitle>{upc ? "Got the barcode" : "What's on the label?"}</Subtitle>
          {upc ? <Body muted>Barcode {upc}</Body> : null}
          <Input
            multiline
            placeholder={upc ? "Add the product name too (optional)" : "Brand and product, e.g. Jif creamy peanut butter"}
            value={ocrText}
            onChangeText={setOcrText}
            style={{ minHeight: 80 }}
          />
          <Input placeholder="Anything else? (where you bought it, who it's for)" value={context} onChangeText={setContext} />
          <View style={styles.switchRow}>
            <Body style={{ flex: 1 }}>Keep an eye on this for me</Body>
            <Switch value={watch} onValueChange={setWatch} trackColor={{ true: colors.accent }} />
          </View>
          <Button title="Check it" icon="search" loading={scan.isPending} onPress={() => void submit()} disabled={!upc && !ocrText.trim()} />
          {photo ? (
            <View style={{ gap: 6 }}>
              <Button
                title="Can't read it? Use the photo"
                variant="premium"
                loading={aiBusy}
                onPress={() => void identifyWithAi()}
              />
              {me.data?.tier !== "premium" ? <PremiumTag /> : null}
            </View>
          ) : null}
          <Button title="Scan another" variant="ghost" onPress={reset} />
        </Card>

        {scan.error ? <Body style={{ color: colors.critical }}>{String((scan.error as Error).message)}</Body> : null}

        {result ? (
          <View style={{ gap: spacing(1.5) }}>
            {result.matches.length ? (
              <Card tone={result.matches.some((m) => m.recall.severity === "critical") ? "critical" : "high"}>
                <Subtitle>{result.matches.length === 1 ? "This might be recalled" : `${result.matches.length} possible recalls`}</Subtitle>
                <Body muted>Open one to check the batch codes on your package.</Body>
              </Card>
            ) : (
              <Card tone="success">
                <Subtitle>Looks fine 👍</Subtitle>
                <Body muted>No recall matches this in the last six months.{result.watchItem ? " We'll let you know if that changes." : ""}</Body>
              </Card>
            )}
            {result.matches.map((m) => (
              <RecallRow key={m.recall.id} recall={m.recall} onPress={() => router.push(`/recall/${m.recall.id}`)} />
            ))}
          </View>
        ) : null}
      </ScrollView>
    </Screen>
  );
}

const styles = StyleSheet.create({
  center: { alignItems: "center", justifyContent: "center", padding: spacing(3), gap: spacing(2) },
  overlay: { position: "absolute", left: 0, right: 0, bottom: 0, padding: spacing(2), gap: spacing(1), backgroundColor: "rgba(247,244,238,0.94)", borderTopLeftRadius: 22, borderTopRightRadius: 22 },
  hint: { color: colors.text, textAlign: "center", marginBottom: 4, fontWeight: "600" },
  switchRow: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: 12 },
  why: { color: colors.accent, fontSize: 12, marginTop: 4 },
});
