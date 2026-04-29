import { useMemo, useState, type CSSProperties } from "react";

/**
 * Default entry: pick how to run the app without typing query strings.
 * Modes: full (editor + sim), host (full + LAN hub), client (thin mobile joiner).
 */
export default function ModeLanding() {
  const [guestHost, setGuestHost] = useState("");
  const defaultGuestHint = useMemo(() => {
    if (typeof window === "undefined") return "";
    const { hostname, port } = window.location;
    const p = port ? `:${port}` : "";
    return `${hostname}${p}`;
  }, []);

  const go = (params: Record<string, string>) => {
    const u = new URL(window.location.href);
    for (const [k, v] of Object.entries(params)) {
      u.searchParams.set(k, v);
    }
    window.location.assign(u.toString());
  };

  return (
    <div
      style={{
        minHeight: "100dvh",
        padding: "max(24px, env(safe-area-inset-top)) max(20px, env(safe-area-inset-right)) max(28px, env(safe-area-inset-bottom)) max(20px, env(safe-area-inset-left))",
        background:
          "radial-gradient(ellipse 120% 80% at 50% -20%, rgba(99,102,241,0.25), transparent 50%), #05050a",
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        justifyContent: "center",
        gap: 20,
        fontFamily:
          "system-ui, -apple-system, Segoe UI, Roboto, sans-serif",
        color: "#e8e8ef",
        boxSizing: "border-box",
      }}
    >
      <div style={{ textAlign: "center", maxWidth: 420 }}>
        <h1 style={{ margin: "0 0 8px", fontSize: 28, fontWeight: 700, letterSpacing: "-0.02em" }}>
          AI City
        </h1>
        <p style={{ margin: 0, fontSize: 15, color: "#94a3b8", lineHeight: 1.5 }}>
          Choose how you want to open the app — no URLs to type.
        </p>
      </div>

      <div
        style={{
          width: "100%",
          maxWidth: 380,
          display: "flex",
          flexDirection: "column",
          gap: 12,
        }}
      >
        <button
          type="button"
          onClick={() => go({ mode: "full" })}
          style={btnPrimary}
        >
          Full app (map, layout, AI settings)
        </button>
        <button
          type="button"
          onClick={() => go({ mode: "host" })}
          style={btnAccent}
        >
          Host + LAN share (same machine runs the AI sim)
        </button>

        <div
          style={{
            marginTop: 8,
            paddingTop: 20,
            borderTop: "1px solid rgba(255,255,255,0.08)",
          }}
        >
          <p style={{ margin: "0 0 10px", fontSize: 13, color: "#94a3b8" }}>
            On your phone — join the host on your network:
          </p>
          <label style={{ fontSize: 12, color: "#64748b", display: "block", marginBottom: 6 }}>
            Host address (usually your PC&apos;s LAN IP + port)
          </label>
          <input
            type="text"
            placeholder={defaultGuestHint || "192.168.x.x:5173"}
            value={guestHost}
            onChange={(e) => setGuestHost(e.target.value)}
            style={inputStyle}
          />
          <button
            type="button"
            onClick={() => {
              const h = guestHost.trim();
              go(
                h
                  ? { mode: "client", host: h }
                  : { mode: "client" }
              );
            }}
            style={{ ...btnGhost, marginTop: 12 }}
          >
            Open guest view (movement + chat)
          </button>
          <p style={{ margin: "10px 0 0", fontSize: 11, color: "#64748b", lineHeight: 1.4 }}>
            Tip: start the host on your PC first, then open this URL on your phone — or paste the PC&apos;s address above once.
          </p>
        </div>
      </div>
    </div>
  );
}

const btnPrimary: CSSProperties = {
  width: "100%",
  padding: "16px 18px",
  fontSize: 16,
  fontWeight: 600,
  borderRadius: 14,
  border: "1px solid rgba(255,255,255,0.12)",
  background: "linear-gradient(180deg, rgba(55,65,120,0.55), rgba(30,36,62,0.9))",
  color: "#f1f5f9",
  cursor: "pointer",
  boxShadow: "0 8px 32px rgba(0,0,0,0.35)",
};

const btnAccent: CSSProperties = {
  ...btnPrimary,
  background: "linear-gradient(180deg, rgba(99,102,241,0.45), rgba(79,70,229,0.35))",
  borderColor: "rgba(129,140,248,0.35)",
};

const btnGhost: CSSProperties = {
  width: "100%",
  padding: "14px 16px",
  fontSize: 15,
  fontWeight: 600,
  borderRadius: 14,
  border: "1px solid rgba(34,211,238,0.35)",
  background: "rgba(15,23,42,0.6)",
  color: "#e0f2fe",
  cursor: "pointer",
};

const inputStyle: CSSProperties = {
  width: "100%",
  padding: "12px 14px",
  fontSize: 15,
  borderRadius: 12,
  border: "1px solid rgba(255,255,255,0.12)",
  background: "rgba(0,0,0,0.35)",
  color: "#f8fafc",
  boxSizing: "border-box",
};
