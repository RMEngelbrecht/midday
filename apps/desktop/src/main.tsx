import { invoke } from "@tauri-apps/api/core";
import React, { useEffect, useState } from "react";
import ReactDOM from "react-dom/client";

type ServerConfig = { appUrl: string; apiUrl: string; desktopScheme: string };

// First-run / "Change Server..." screen. The Rust side validates the URL against
// `<url>/api/instance`, saves it, and navigates this window to the dashboard.
function Setup() {
  const [url, setUrl] = useState("");
  const [saved, setSaved] = useState<ServerConfig | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    invoke<ServerConfig | null>("get_server_config").then((config) => {
      setSaved(config);
      if (config) setUrl(config.appUrl);
    });
  }, []);

  async function connect(event: React.FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await invoke("connect_server", { url });
    } catch (e) {
      setError(String(e));
      setBusy(false);
    }
  }

  return (
    <main style={styles.main}>
      <form onSubmit={connect} style={styles.form}>
        <h1 style={styles.title}>Connect to your Midday server</h1>
        <p style={styles.hint}>
          Enter the address of your self-hosted dashboard, for example
          https://midday.example.com
        </p>
        <input
          // biome-ignore lint/a11y/noAutofocus: single-field screen
          autoFocus
          style={styles.input}
          value={url}
          onChange={(e) => setUrl(e.target.value)}
          placeholder="https://midday.example.com"
          spellCheck={false}
        />
        {error && <p style={styles.error}>{error}</p>}
        <div style={styles.row}>
          <button type="submit" disabled={busy || !url.trim()} style={styles.primary}>
            {busy ? "Connecting..." : "Connect"}
          </button>
          {saved && (
            <button type="button" onClick={() => invoke("cancel_setup")} style={styles.secondary}>
              Cancel
            </button>
          )}
        </div>
      </form>
    </main>
  );
}

const styles: Record<string, React.CSSProperties> = {
  main: { display: "flex", height: "100vh", alignItems: "center", justifyContent: "center", background: "#0c0c0c", color: "#fafafa", fontFamily: "system-ui, sans-serif" },
  form: { width: 420, display: "flex", flexDirection: "column", gap: 12 },
  title: { fontSize: 20, fontWeight: 500, margin: 0 },
  hint: { color: "#888", fontSize: 13, margin: 0 },
  input: { padding: "10px 12px", background: "#161616", border: "1px solid #333", borderRadius: 6, color: "inherit", fontSize: 14 },
  error: { color: "#f87171", fontSize: 13, margin: 0 },
  row: { display: "flex", gap: 8 },
  primary: { padding: "9px 16px", background: "#fafafa", color: "#0c0c0c", border: 0, borderRadius: 6, fontWeight: 500, cursor: "pointer" },
  secondary: { padding: "9px 16px", background: "transparent", color: "#fafafa", border: "1px solid #333", borderRadius: 6, cursor: "pointer" },
};

ReactDOM.createRoot(document.getElementById("root") as HTMLElement).render(
  <React.StrictMode>
    <Setup />
  </React.StrictMode>,
);
