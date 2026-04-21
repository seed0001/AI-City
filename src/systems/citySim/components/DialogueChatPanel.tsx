import { useEffect, useRef, useState, type CSSProperties } from "react";
import { useCitySim } from "../hooks/useCitySim";
import { initSpeechVoices, stopAllSpeech } from "../speech/characterSpeech";
import { HUMAN_ENTITY_ID } from "../data/townCharacters";

/**
 * Rolling chat + optional player typing. NPC speech is logged from ConversationSystem
 * and spoken via Web Speech API (Edge often exposes Microsoft neural voices).
 */
export default function DialogueChatPanel() {
  const { manager, simVersion } = useCitySim();
  const scrollRef = useRef<HTMLDivElement>(null);
  const lines = manager.dialogueLog;
  const [draft, setDraft] = useState("");

  useEffect(() => {
    initSpeechVoices();
  }, []);

  useEffect(() => {
    const el = scrollRef.current;
    if (el) el.scrollTo({ top: el.scrollHeight, behavior: "smooth" });
  }, [simVersion, lines.length]);

  const submit = () => {
    const t = draft.trim();
    if (!t) return;
    const human = manager.getHuman();
    manager.appendDialogueLine({
      speakerId: HUMAN_ENTITY_ID,
      speakerName: human?.displayName ?? "You",
      text: t,
    });
    setDraft("");
  };

  return (
    <div
      style={{
        height: "100%",
        display: "flex",
        flexDirection: "column",
        fontFamily: "system-ui, Segoe UI, sans-serif",
        fontSize: 12,
        lineHeight: 1.35,
        color: "#e4e4ec",
        background: "rgba(8,10,18,0.92)",
        border: "1px solid rgba(255,255,255,0.12)",
        borderRadius: 10,
        padding: "10px 12px",
        minHeight: 0,
      }}
    >
      <div
        style={{
          fontWeight: 700,
          marginBottom: 6,
          color: "#86efac",
          display: "flex",
          justifyContent: "space-between",
          alignItems: "center",
        }}
      >
        <span>Town chat</span>
        <button
          type="button"
          onClick={() => stopAllSpeech()}
          style={btnSmall}
          title="Stop speech"
        >
          Stop TTS
        </button>
      </div>

      <p style={{ margin: "0 0 8px", fontSize: 10, color: "#9ca3af" }}>
        Walk near NPCs in simulation — they talk when the sim triggers a chat. Your lines
        below are local practice (not sent to the LLM yet).
      </p>

      <div
        ref={scrollRef}
        style={{
          flex: 1,
          minHeight: 80,
          overflowY: "auto",
          paddingRight: 4,
          borderTop: "1px solid rgba(255,255,255,0.06)",
          paddingTop: 8,
        }}
      >
        {lines.length === 0 ? (
          <div style={{ color: "#6b7280", fontStyle: "italic" }}>
            No dialogue yet. Relaunch sim and bump into townspeople.
          </div>
        ) : (
          lines.map((line) => {
            const isYou = line.speakerId === HUMAN_ENTITY_ID;
            return (
              <div
                key={line.id}
                style={{
                  marginBottom: 10,
                  paddingBottom: 8,
                  borderBottom: "1px solid rgba(255,255,255,0.05)",
                }}
              >
                <div
                  style={{
                    color: isYou ? "#93c5fd" : "#c4b5fd",
                    fontWeight: 600,
                    fontSize: 11,
                  }}
                >
                  {line.speakerName}
                </div>
                <div style={{ color: "#e8e8ef", marginTop: 2 }}>{line.text}</div>
              </div>
            );
          })
        )}
      </div>

      <div style={{ marginTop: 8, display: "flex", gap: 6 }}>
        <input
          type="text"
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") submit();
          }}
          placeholder="Type a line as your resident…"
          style={inputStyle}
        />
        <button type="button" onClick={submit} style={btnSend}>
          Send
        </button>
      </div>
    </div>
  );
}

const btnSmall: CSSProperties = {
  fontSize: 10,
  padding: "3px 8px",
  borderRadius: 6,
  border: "1px solid rgba(255,255,255,0.15)",
  background: "rgba(255,255,255,0.06)",
  color: "#cbd5e1",
  cursor: "pointer",
};

const btnSend: CSSProperties = {
  ...btnSmall,
  padding: "6px 10px",
  background: "rgba(34,197,94,0.25)",
  borderColor: "rgba(74,222,128,0.35)",
};

const inputStyle: CSSProperties = {
  flex: 1,
  minWidth: 0,
  padding: "6px 8px",
  borderRadius: 6,
  border: "1px solid rgba(255,255,255,0.12)",
  background: "rgba(0,0,0,0.35)",
  color: "#f3f4f6",
  fontSize: 12,
};
