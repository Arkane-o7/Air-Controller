import AsyncStorage from "@react-native-async-storage/async-storage";
import React, { useEffect, useMemo, useRef, useState } from "react";
import {
  KeyboardAvoidingView,
  Platform,
  Pressable,
  SafeAreaView,
  StatusBar,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";
import { WebView } from "react-native-webview";

const STORAGE_KEY = "air_controller_server_origin";

function normalizeOrigin(rawValue) {
  const raw = String(rawValue || "").trim();
  if (!raw) {
    return "";
  }

  const withProtocol = /^https?:\/\//i.test(raw) ? raw : `http://${raw}`;

  try {
    const url = new URL(withProtocol);
    const origin = `${url.protocol}//${url.host}`;
    return origin.replace(/\/+$/, "");
  } catch (_error) {
    return "";
  }
}

export default function App() {
  const webRef = useRef(null);
  const [serverInput, setServerInput] = useState("");
  const [savedOrigin, setSavedOrigin] = useState("");
  const [controllerOpen, setControllerOpen] = useState(false);
  const [reloadToken, setReloadToken] = useState(0);
  const [errorText, setErrorText] = useState("");

  useEffect(() => {
    (async () => {
      const stored = await AsyncStorage.getItem(STORAGE_KEY);
      const normalized = normalizeOrigin(stored);
      if (normalized) {
        setSavedOrigin(normalized);
        setServerInput(normalized);
      }
    })();
  }, []);

  const controllerUrl = useMemo(() => {
    if (!savedOrigin) {
      return "";
    }

    return `${savedOrigin}/controller`;
  }, [savedOrigin]);

  async function saveServerOrigin() {
    const normalized = normalizeOrigin(serverInput);

    if (!normalized) {
      setErrorText("Enter a valid PC URL like 192.168.1.20:3000");
      return false;
    }

    await AsyncStorage.setItem(STORAGE_KEY, normalized);
    setSavedOrigin(normalized);
    setServerInput(normalized);
    setErrorText("");
    return true;
  }

  async function openController() {
    const ok = await saveServerOrigin();
    if (ok) {
      setControllerOpen(true);
      setReloadToken((value) => value + 1);
    }
  }

  if (controllerOpen && controllerUrl) {
    return (
      <SafeAreaView style={styles.viewerRoot}>
        <StatusBar barStyle="light-content" />

        <View style={styles.viewerHeader}>
          <Pressable style={[styles.actionBtn, styles.backBtn]} onPress={() => setControllerOpen(false)}>
            <Text style={styles.actionBtnText}>Back</Text>
          </Pressable>
          <Text style={styles.viewerTitle}>AIR Controller</Text>
          <Pressable
            style={styles.actionBtn}
            onPress={() => {
              if (webRef.current) {
                webRef.current.reload();
              } else {
                setReloadToken((value) => value + 1);
              }
            }}
          >
            <Text style={styles.actionBtnText}>Reload</Text>
          </Pressable>
        </View>

        <WebView
          key={`${controllerUrl}-${reloadToken}`}
          ref={webRef}
          source={{ uri: controllerUrl }}
          originWhitelist={["*"]}
          javaScriptEnabled
          domStorageEnabled
          startInLoadingState
          style={styles.webview}
        />
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={styles.root}>
      <StatusBar barStyle="light-content" />
      <KeyboardAvoidingView
        style={styles.flex}
        behavior={Platform.OS === "ios" ? "padding" : undefined}
      >
        <View style={styles.panel}>
          <Text style={styles.brand}>AIR CTRL</Text>
          <Text style={styles.headline}>Phone Controller App</Text>
          <Text style={styles.subline}>Enter your desktop AIR server URL, then open the controller.</Text>

          <Text style={styles.label}>Desktop URL</Text>
          <TextInput
            value={serverInput}
            onChangeText={setServerInput}
            style={styles.input}
            autoCapitalize="none"
            autoCorrect={false}
            placeholder="192.168.1.20:3000"
            placeholderTextColor="rgba(236, 248, 255, 0.5)"
          />

          <View style={styles.actionsRow}>
            <Pressable style={[styles.primaryBtn, styles.secondaryBtn]} onPress={saveServerOrigin}>
              <Text style={styles.secondaryBtnText}>Save URL</Text>
            </Pressable>
            <Pressable style={styles.primaryBtn} onPress={openController}>
              <Text style={styles.primaryBtnText}>Open Controller</Text>
            </Pressable>
          </View>

          {savedOrigin ? (
            <Text style={styles.savedText}>Saved: {savedOrigin}</Text>
          ) : (
            <Text style={styles.savedText}>No desktop URL saved yet.</Text>
          )}

          {errorText ? <Text style={styles.errorText}>{errorText}</Text> : null}

          <Text style={styles.noteText}>
            Tip: use the LAN URL shown in the desktop app (same Wi-Fi), then join with the 6-character session code.
          </Text>
        </View>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  flex: {
    flex: 1,
    justifyContent: "center",
  },
  root: {
    flex: 1,
    backgroundColor: "#050b13",
    padding: 18,
  },
  panel: {
    borderRadius: 24,
    padding: 18,
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.15)",
    backgroundColor: "rgba(8, 20, 37, 0.9)",
  },
  brand: {
    color: "#3df2cb",
    letterSpacing: 2.8,
    fontSize: 25,
    fontWeight: "700",
  },
  headline: {
    color: "#ecf8ff",
    fontSize: 24,
    marginTop: 2,
    fontWeight: "700",
  },
  subline: {
    color: "rgba(236,248,255,0.8)",
    marginTop: 8,
    fontSize: 14,
    lineHeight: 20,
  },
  label: {
    color: "rgba(236,248,255,0.9)",
    fontWeight: "700",
    marginTop: 14,
    marginBottom: 6,
    fontSize: 13,
    textTransform: "uppercase",
    letterSpacing: 0.6,
  },
  input: {
    color: "#ecf8ff",
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.26)",
    borderRadius: 11,
    paddingVertical: 11,
    paddingHorizontal: 12,
    backgroundColor: "rgba(255,255,255,0.06)",
    fontSize: 16,
  },
  actionsRow: {
    marginTop: 14,
    flexDirection: "row",
    gap: 8,
  },
  primaryBtn: {
    flex: 1,
    borderRadius: 10,
    paddingVertical: 11,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "#3df2cb",
  },
  primaryBtnText: {
    color: "#022119",
    fontWeight: "700",
    fontSize: 15,
  },
  secondaryBtn: {
    backgroundColor: "rgba(255,255,255,0.12)",
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.25)",
  },
  secondaryBtnText: {
    color: "#ecf8ff",
    fontWeight: "700",
    fontSize: 15,
  },
  savedText: {
    color: "rgba(236,248,255,0.86)",
    marginTop: 12,
    fontSize: 13,
  },
  errorText: {
    color: "#ffb6a6",
    marginTop: 8,
    fontSize: 13,
    fontWeight: "600",
  },
  noteText: {
    color: "rgba(236,248,255,0.72)",
    fontSize: 12,
    marginTop: 14,
    lineHeight: 18,
  },
  viewerRoot: {
    flex: 1,
    backgroundColor: "#050b13",
  },
  viewerHeader: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: 10,
    paddingVertical: 8,
    borderBottomWidth: 1,
    borderBottomColor: "rgba(255,255,255,0.14)",
    backgroundColor: "rgba(8,20,37,0.98)",
  },
  viewerTitle: {
    color: "#ecf8ff",
    fontWeight: "700",
    fontSize: 16,
    letterSpacing: 0.3,
  },
  actionBtn: {
    borderRadius: 8,
    backgroundColor: "#3df2cb",
    paddingHorizontal: 12,
    paddingVertical: 7,
  },
  backBtn: {
    backgroundColor: "rgba(255,255,255,0.13)",
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.24)",
  },
  actionBtnText: {
    color: "#ecf8ff",
    fontWeight: "700",
    fontSize: 13,
  },
  webview: {
    flex: 1,
    backgroundColor: "#050b13",
  },
});
