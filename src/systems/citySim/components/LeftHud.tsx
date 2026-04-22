import { useState } from "react";
import AiSettingsPanel from "./AiSettingsPanel";
import DialogueChatPanel from "./DialogueChatPanel";
import TownLayoutEditorPanel from "./townLayout/TownLayoutEditorPanel";

/**
 * Left column: town layout or AI settings above, rolling chat + TTS below.
 */
export default function LeftHud() {
  const [topTab, setTopTab] = useState<"layout" | "ai">("layout");

  return (
    <div
      style={{
        position: "fixed",
        left: 8,
        top: 8,
        bottom: 8,
        width: 320,
        zIndex: 1001,
        display: "flex",
        flexDirection: "column",
        gap: 8,
        pointerEvents: "none",
      }}
    >
      <div
        style={{
          flex: "1 1 52%",
          minHeight: 0,
          display: "flex",
          flexDirection: "column",
          pointerEvents: "auto",
          gap: 6,
        }}
      >
        <div
          style={{
            display: "flex",
            gap: 6,
            flexShrink: 0,
            fontSize: 11,
            fontFamily: "system-ui, Segoe UI, sans-serif",
          }}
        >
          <TopTab
            label="Town layout"
            active={topTab === "layout"}
            onClick={() => setTopTab("layout")}
          />
          <TopTab
            label="AI & voice"
            active={topTab === "ai"}
            onClick={() => setTopTab("ai")}
          />
        </div>
        {topTab === "layout" ? (
          <div
            style={{
              flex: 1,
              minHeight: 0,
              display: "flex",
              flexDirection: "column",
            }}
          >
            <TownLayoutEditorPanel />
          </div>
        ) : (
          <div
            style={{
              width: "100%",
              height: "100%",
              minHeight: 0,
              flex: 1,
              overflow: "auto",
              fontFamily: "system-ui, Segoe UI, sans-serif",
              color: "#e4e4ec",
              background: "rgba(8,10,18,0.92)",
              border: "1px solid rgba(255,255,255,0.12)",
              borderRadius: 10,
              padding: "12px 14px",
              boxSizing: "border-box",
            }}
          >
            <AiSettingsPanel />
          </div>
        )}
      </div>
      <div
        style={{
          flex: "1 1 48%",
          minHeight: 140,
          display: "flex",
          flexDirection: "column",
          pointerEvents: "auto",
        }}
      >
        <DialogueChatPanel />
      </div>
    </div>
  );
}

function TopTab({
  label,
  active,
  onClick,
}: {
  label: string;
  active: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      style={{
        flex: 1,
        padding: "6px 8px",
        borderRadius: 7,
        border: active
          ? "1px solid rgba(251,191,36,0.5)"
          : "1px solid rgba(255,255,255,0.1)",
        background: active
          ? "rgba(180,80,0,0.2)"
          : "rgba(255,255,255,0.05)",
        color: active ? "#fde68a" : "#9ca3af",
        fontSize: 11,
        fontWeight: active ? 600 : 500,
        cursor: "pointer",
      }}
    >
      {label}
    </button>
  );
}
