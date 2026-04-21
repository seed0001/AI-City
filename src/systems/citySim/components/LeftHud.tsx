import DialogueChatPanel from "./DialogueChatPanel";
import TownLayoutEditorPanel from "./townLayout/TownLayoutEditorPanel";

/**
 * Left column: town layout / staging above, rolling chat + TTS below.
 */
export default function LeftHud() {
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
        }}
      >
        <TownLayoutEditorPanel />
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
