import { useEffect, type CSSProperties } from "react";
import { PRESET_BY_KEY, PRESET_MARKER_ORDER } from "../../data/presetMarkers";
import { useTownLayout } from "../../townLayout/TownLayoutContext";

/**
 * HTML panel: mode, inventory, armed placement, validation, save, relaunch, layout/debug toggles.
 */
export default function TownLayoutEditorPanel() {
  const {
    mode,
    markers,
    armedKey,
    selectedKey,
    debugOverlay,
    setDebugOverlay,
    inventoryKeys,
    validation,
    armMarker,
    deleteMarker,
    saveLayout,
    enterLayoutMode,
    relaunchSimulation,
  } = useTownLayout();

  useEffect(() => {
    if (mode !== "layout") return;
    const onKey = (ev: KeyboardEvent) => {
      if (ev.key === "Delete" || ev.key === "Backspace") {
        if (selectedKey && document.activeElement?.tagName !== "INPUT") {
          ev.preventDefault();
          deleteMarker(selectedKey);
        }
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [mode, selectedKey, deleteMarker]);

  const relaunch = () => {
    const r = relaunchSimulation();
    if (!r.ok) {
      window.alert(`Missing required markers:\n${r.missing.join("\n")}`);
    }
  };

  return (
    <div
      style={{
        width: "100%",
        height: "100%",
        maxHeight: "100%",
        overflow: "auto",
        fontFamily: "system-ui, Segoe UI, sans-serif",
        fontSize: 12,
        lineHeight: 1.4,
        color: "#e4e4ec",
        background: "rgba(8,10,18,0.92)",
        border: "1px solid rgba(255,255,255,0.12)",
        borderRadius: 10,
        padding: "12px 14px",
        boxSizing: "border-box",
      }}
    >
      <div style={{ fontWeight: 700, marginBottom: 8, color: "#a5b4fc" }}>
        Town layout
      </div>

      <div style={{ marginBottom: 10, color: "#9ca3af" }}>
        Mode:{" "}
        <span style={{ color: "#fbbf24" }}>
          {mode === "layout" ? "Layout (staging)" : "Simulation"}
        </span>
      </div>

      {mode === "simulation" && (
        <button
          type="button"
          onClick={enterLayoutMode}
          style={btn}
        >
          Edit layout
        </button>
      )}

      {mode === "layout" && (
        <>
          <div style={{ marginTop: 12, fontWeight: 600, color: "#cbd5e1" }}>
            Inventory (unplaced)
          </div>
          <ul style={{ margin: "6px 0 10px", paddingLeft: 18 }}>
            {inventoryKeys.length === 0 ? (
              <li style={{ color: "#6b7280" }}>All markers placed</li>
            ) : (
              inventoryKeys.map((key) => {
                const d = PRESET_BY_KEY[key];
                return (
                  <li key={key} style={{ marginBottom: 4 }}>
                    <button
                      type="button"
                      onClick={() => armMarker(key)}
                      style={{
                        ...linkBtn,
                        fontWeight: armedKey === key ? 700 : 400,
                        color: armedKey === key ? "#fde047" : "#93c5fd",
                      }}
                    >
                      {d.label}
                    </button>
                    <span style={{ color: "#6b7280", marginLeft: 6 }}>
                      {d.type}
                      {d.required ? " · required" : ""}
                      {d.assignedTo ? ` · ${d.assignedTo}` : ""}
                    </span>
                  </li>
                );
              })
            )}
          </ul>

          <div style={{ fontSize: 11, color: "#9ca3af", marginBottom: 8 }}>
            {armedKey
              ? `Armed: ${PRESET_BY_KEY[armedKey]?.label} — click ground to place`
              : "Select an inventory item to arm placement"}
          </div>

          {selectedKey && (
            <div style={{ marginBottom: 10, fontSize: 11, color: "#d1d5db" }}>
              Selected:{" "}
              <b>{markers[selectedKey]?.label ?? selectedKey}</b> — drag to move,
              Delete to return to inventory
            </div>
          )}
        </>
      )}

      <div style={{ marginTop: 8, marginBottom: 6 }}>
        Validation:{" "}
        {validation.ok ? (
          <span style={{ color: "#4ade80" }}>All required markers placed</span>
        ) : (
          <span style={{ color: "#f87171" }}>
            Missing {validation.missing.length} required
          </span>
        )}
      </div>
      {!validation.ok && mode === "layout" && (
        <ul style={{ fontSize: 11, color: "#fca5a5", margin: "4px 0 8px 18px" }}>
          {validation.missing.map((m) => (
            <li key={m}>{m}</li>
          ))}
        </ul>
      )}

      <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
        <button type="button" onClick={saveLayout} style={btn}>
          Save layout
        </button>
        <button type="button" onClick={relaunch} style={btnPrimary}>
          Relaunch simulation
        </button>
        <label
          style={{
            display: "flex",
            alignItems: "center",
            gap: 8,
            cursor: "pointer",
            fontSize: 11,
            color: "#a8a8b8",
          }}
        >
          <input
            type="checkbox"
            checked={debugOverlay}
            onChange={(e) => setDebugOverlay(e.target.checked)}
          />
          Debug overlay (markers + NPC lines + labels)
        </label>
      </div>

      <div style={{ marginTop: 12, fontSize: 10, color: "#6b7280" }}>
        Preset order:{" "}
        {PRESET_MARKER_ORDER.map((k) => PRESET_BY_KEY[k].label).join(" → ")}
      </div>
    </div>
  );
}

const btn: CSSProperties = {
  width: "100%",
  padding: "8px 10px",
  borderRadius: 6,
  border: "1px solid rgba(255,255,255,0.15)",
  background: "rgba(255,255,255,0.06)",
  color: "#e5e7eb",
  cursor: "pointer",
};

const btnPrimary: CSSProperties = {
  ...btn,
  background: "rgba(79,70,229,0.45)",
  borderColor: "rgba(129,140,248,0.5)",
};

const linkBtn: CSSProperties = {
  background: "none",
  border: "none",
  padding: 0,
  cursor: "pointer",
  textAlign: "left",
  color: "inherit",
};
