import React, { useState } from "react";
import { Alert as RNAlert, ScrollView, StyleSheet, Text, View } from "react-native";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import type { ConnectorProvider } from "@recall/shared";
import { api, ApiError } from "@/api/client";
import { Body, Button, Card, Empty, Input, Pill, Screen, Subtitle } from "@/components/ui";
import { useConnectors, useImportPurchases, useMe } from "@/hooks/queries";
import { useBottomPad } from "@/hooks/useBottomPad";
import { colors, spacing } from "@/lib/theme";

export default function ConnectorsScreen() {
  const me = useMe();
  const premium = me.data?.tier === "premium";
  const connectors = useConnectors(!!premium);
  const providers = useQuery({ queryKey: ["providers"], queryFn: api.providers });
  const imp = useImportPurchases();
  const qc = useQueryClient();
  const bottomPad = useBottomPad();
  const [provider, setProvider] = useState<ConnectorProvider>("instacart");
  const [name, setName] = useState("");
  const [url, setUrl] = useState("");
  const [token, setToken] = useState("");
  const [saving, setSaving] = useState(false);
  const [lastSummary, setLastSummary] = useState<string | null>(null);

  if (!premium) {
    return (
      <Screen edges={["bottom"]}>
        <Empty title="Premium required" body="Connected accounts import your purchase history through MCP so recalls match what you actually buy." />
      </Screen>
    );
  }

  const add = async () => {
    setSaving(true);
    try {
      await api.createConnector({ provider, displayName: name.trim() || provider, mcpUrl: url.trim(), authorizationToken: token.trim() || undefined });
      setName("");
      setUrl("");
      setToken("");
      void qc.invalidateQueries({ queryKey: ["connectors"] });
    } catch (err) {
      RNAlert.alert("Could not add account", err instanceof ApiError ? err.message : String(err));
    } finally {
      setSaving(false);
    }
  };

  return (
    <Screen edges={["bottom"]}>
      <ScrollView contentContainerStyle={{ padding: spacing(2), gap: spacing(2), paddingBottom: bottomPad }} keyboardShouldPersistTaps="handled">
        <Card>
          <Subtitle>Connect a shopping account</Subtitle>
          <Body muted>We'll read what you've bought and watch all of it for recalls. Paste the connection link and access code from the retailer's app.</Body>
          <ScrollView horizontal showsHorizontalScrollIndicator={false}>
            {(providers.data?.providers ?? []).map((p) => (
              <Pill key={p.id} label={p.label} active={provider === p.id} onPress={() => setProvider(p.id as ConnectorProvider)} />
            ))}
          </ScrollView>
          <Input placeholder="Display name (optional)" value={name} onChangeText={setName} />
          <Input placeholder="Connection link" value={url} onChangeText={setUrl} autoCapitalize="none" keyboardType="url" />
          <Input placeholder="Access code (kept encrypted)" value={token} onChangeText={setToken} autoCapitalize="none" secureTextEntry />
          <Button title="Connect" loading={saving} disabled={!/^https:\/\//.test(url.trim())} onPress={() => void add()} />
        </Card>

        <Subtitle>Connected</Subtitle>
        {(connectors.data?.items ?? []).map((c) => (
          <Card key={c.id}>
            <View style={styles.header}>
              <Text style={styles.name}>{c.displayName}</Text>
              <Text style={styles.status}>{c.lastSyncStatus === "ok" ? `synced ${new Date(c.lastSyncAt!).toLocaleDateString()}` : c.lastSyncStatus === "error" ? "last import failed" : "never imported"}</Text>
            </View>
            <Body muted>{c.provider} · {c.mcpUrl}</Body>
            {c.lastSyncError ? <Body style={{ color: colors.critical }}>{c.lastSyncError}</Body> : null}
            <View style={{ flexDirection: "row", gap: 12 }}>
              <Button
                title="Import my purchases"
                style={{ flex: 1 }}
                loading={imp.isPending && imp.variables === c.id}
                onPress={() =>
                  imp.mutate(c.id, {
                    onSuccess: (r) => setLastSummary(`${r.created.length} new items watched, ${r.skippedDuplicates} already there. ${r.summary}`),
                    onError: (err) => RNAlert.alert("Import failed", err instanceof ApiError ? err.message : String(err)),
                  })
                }
              />
              <Button
                title="Remove"
                variant="ghost"
                onPress={() =>
                  RNAlert.alert("Remove account?", c.displayName, [
                    { text: "Cancel", style: "cancel" },
                    { text: "Remove", style: "destructive", onPress: () => void api.deleteConnector(c.id).then(() => qc.invalidateQueries({ queryKey: ["connectors"] })) },
                  ])
                }
              />
            </View>
          </Card>
        ))}
        {connectors.data && !connectors.data.items.length ? <Body muted>No accounts connected yet.</Body> : null}
        {lastSummary ? (
          <Card>
            <Subtitle>Last import</Subtitle>
            <Body>{lastSummary}</Body>
          </Card>
        ) : null}
      </ScrollView>
    </Screen>
  );
}

const styles = StyleSheet.create({
  header: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", gap: 8 },
  name: { color: colors.text, fontWeight: "700", fontSize: 16 },
  status: { color: colors.muted, fontSize: 12 },
});
