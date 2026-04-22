import { useEffect, useState, type CSSProperties, type ReactNode } from "react";
import {
  CHARACTER_SEEDS,
  HUMAN_ENTITY_ID,
} from "../data/townCharacters";
import {
  getAiSettings,
  patchCharacterOverride,
  resetAiSettingsToDefaults,
  setAiSettings,
  subscribeAiSettings,
  type CharacterPersonaOverride,
} from "../settings/aiSimSettings";
import { getAvailableVoicesList, initSpeechVoices } from "../speech/characterSpeech";

const MOODS = ["calm", "annoyed", "friendly", "nervous", "angry"] as const;

const HUMAN_LABEL = { id: HUMAN_ENTITY_ID, displayName: "You (resident)" };

/**
 * Per-character persona (for LLM scene JSON + optional TTS voice), global prompt suffixes, and TTS master controls.
 * Persisted in localStorage.
 */
export default function AiSettingsPanel() {
  const [, setTick] = useState(0);
  const [voices, setVoices] = useState<SpeechSynthesisVoice[]>([]);

  useEffect(() => {
    return subscribeAiSettings(() => setTick((n) => n + 1));
  }, []);

  useEffect(() => {
    initSpeechVoices();
    const sync = () => setVoices(getAvailableVoicesList());
    sync();
    if (window.speechSynthesis) {
      window.speechSynthesis.onvoiceschanged = sync;
    }
    return () => {
      if (window.speechSynthesis) window.speechSynthesis.onvoiceschanged = null;
    };
  }, []);

  const s = getAiSettings();

  const onGlobal = (field: "globalNpcSystemSuffix" | "globalPlayerSystemSuffix", v: string) => {
    setAiSettings({ [field]: v });
  };

  const oRow = (id: string, label: string) => {
    const o: CharacterPersonaOverride = s.perCharacter[id] ?? {};
    return (
      <div
        key={id}
        style={{
          marginTop: 12,
          paddingTop: 10,
          borderTop: "1px solid rgba(255,255,255,0.08)",
        }}
      >
        <div style={{ fontWeight: 700, color: "#f9a8d4", marginBottom: 6 }}>{label}</div>
        <div style={grid2}>
          <Field label="Display name" hint="Blank = use sim default">
            <input
              style={inp}
              value={o.displayName ?? ""}
              placeholder="(default)"
              onChange={(e) => patchCharacterOverride(id, { displayName: e.target.value || undefined })}
            />
          </Field>
          <Field label="Role" hint="Blank = default">
            <input
              style={inp}
              value={o.role ?? ""}
              placeholder="(default)"
              onChange={(e) => patchCharacterOverride(id, { role: e.target.value || undefined })}
            />
          </Field>
        </div>
        <div style={grid2}>
          <Field label="Mood" hint="LLM + state">
            <select
              style={inp}
              value={o.mood ?? ""}
              onChange={(e) => patchCharacterOverride(id, { mood: e.target.value || undefined })}
            >
              <option value="">(default from sim)</option>
              {MOODS.map((m) => (
                <option key={m} value={m}>
                  {m}
                </option>
              ))}
            </select>
          </Field>
          <Field label="TTS voice" hint="Web Speech in this browser">
            <select
              style={inp}
              value={o.voiceUri ?? ""}
              onChange={(e) => patchCharacterOverride(id, { voiceUri: e.target.value || undefined })}
            >
              <option value="">Auto (stable per id)</option>
              {voices.map((v) => (
                <option key={v.voiceURI} value={v.voiceURI}>
                  {v.name} ({v.lang})
                </option>
              ))}
            </select>
          </Field>
        </div>
        <Field label="Trait tags" hint="Comma‑separated; blank = sim seed">
          <input
            style={inp}
            value={o.traits ?? ""}
            placeholder="e.g. gruff, well-read"
            onChange={(e) => patchCharacterOverride(id, { traits: e.target.value || undefined })}
          />
        </Field>
        <Field label="Persona & voice (notes)" hint="Manner, dialect, backstory for the model">
          <textarea
            style={ta}
            value={o.personaNotes ?? ""}
            placeholder="e.g. Speaks in short clauses; ex‑teacher; avoids small talk"
            onChange={(e) => patchCharacterOverride(id, { personaNotes: e.target.value || undefined })}
          />
        </Field>
        <button
          type="button"
          style={btnGhost}
          onClick={() => setAiSettings({ perCharacter: { [id]: undefined } })}
        >
          Reset this character
        </button>
      </div>
    );
  };

  return (
    <div
      style={{
        display: "flex",
        flexDirection: "column",
        gap: 0,
        minHeight: 0,
        fontFamily: "system-ui, Segoe UI, sans-serif",
        fontSize: 12,
        lineHeight: 1.4,
        color: "#e4e4ec",
      }}
    >
      <div
        style={{
          fontWeight: 700,
          color: "#fda4af",
          marginBottom: 8,
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
        }}
      >
        <span>AI &amp; voice</span>
        <span style={{ fontSize: 10, fontWeight: 500, color: "#6b7280" }}>saved locally</span>
      </div>

      <div style={sectionLabel}>System prompt extras (Ollama)</div>
      <p style={hintP}>
        Appended to the built‑in dialogue system prompts. Use for town tone, safety, or genre.
      </p>
      <div style={fieldBlock}>
        <div style={miniLabel}>NPC↔NPC dialogue</div>
        <textarea
          style={ta}
          value={s.globalNpcSystemSuffix}
          onChange={(e) => onGlobal("globalNpcSystemSuffix", e.target.value)}
          placeholder="e.g. Keep it PG, small-town Americana, no slurs…"
        />
      </div>
      <div style={fieldBlock}>
        <div style={miniLabel}>Player↔NPC replies</div>
        <textarea
          style={ta}
          value={s.globalPlayerSystemSuffix}
          onChange={(e) => onGlobal("globalPlayerSystemSuffix", e.target.value)}
          placeholder="e.g. NPCs never break the fourth wall about being AIs…"
        />
      </div>

      <div style={{ marginTop: 10, ...sectionLabel }}>TTS (browser speech)</div>
      <label style={checkRow}>
        <input
          type="checkbox"
          checked={s.ttsEnabled}
          onChange={(e) => setAiSettings({ ttsEnabled: e.target.checked })}
        />
        <span>Enable TTS for NPC lines</span>
      </label>
      <div style={grid2}>
        <Field label="Rate" hint="0.5–2">
          <input
            type="range"
            min={0.5}
            max={2}
            step={0.05}
            value={s.ttsRate}
            onChange={(e) => setAiSettings({ ttsRate: Number(e.target.value) })}
            style={{ width: "100%" }}
          />
          <div style={rangeVal}>{s.ttsRate.toFixed(2)}</div>
        </Field>
        <Field label="Pitch" hint="0.5–2">
          <input
            type="range"
            min={0.5}
            max={2}
            step={0.05}
            value={s.ttsPitch}
            onChange={(e) => setAiSettings({ ttsPitch: Number(e.target.value) })}
            style={{ width: "100%" }}
          />
          <div style={rangeVal}>{s.ttsPitch.toFixed(2)}</div>
        </Field>
      </div>

      <div style={{ marginTop: 4, ...sectionLabel }}>Characters</div>
      <p style={hintP}>
        Overrides what the model and TTS know about each resident. Leave fields blank to use the live sim
        (seed) values. Voice list depends on the browser; Edge on Windows often has the richest set.
      </p>

      {CHARACTER_SEEDS.map((c) => oRow(c.id, c.displayName))}
      {oRow(HUMAN_LABEL.id, HUMAN_LABEL.displayName)}

      <div style={{ marginTop: 14, display: "flex", gap: 8, flexWrap: "wrap" }}>
        <button
          type="button"
          style={btnDanger}
          onClick={() => {
            if (window.confirm("Remove all character overrides, prompt extras, and reset TTS?")) {
              resetAiSettingsToDefaults();
            }
          }}
        >
          Reset all AI settings
        </button>
      </div>
    </div>
  );
}

function Field({
  label,
  hint,
  children,
}: {
  label: string;
  hint: string;
  children: ReactNode;
}) {
  return (
    <div>
      <div style={{ fontSize: 10, color: "#9ca3af", marginBottom: 3 }}>{label}</div>
      {children}
      <div style={{ fontSize: 9, color: "#4b5563", marginTop: 2 }}>{hint}</div>
    </div>
  );
}

const sectionLabel: CSSProperties = {
  fontWeight: 600,
  color: "#a5b4fc",
  fontSize: 11,
};

const fieldBlock: CSSProperties = { marginBottom: 8 };

const miniLabel: CSSProperties = { fontSize: 10, color: "#9ca3af", marginBottom: 4 };

const hintP: CSSProperties = { margin: "0 0 8px", fontSize: 10, color: "#6b7280" };

const grid2: CSSProperties = {
  display: "grid",
  gridTemplateColumns: "1fr 1fr",
  gap: 8,
  marginBottom: 6,
};

const inp: CSSProperties = {
  width: "100%",
  boxSizing: "border-box",
  padding: "5px 7px",
  borderRadius: 6,
  border: "1px solid rgba(255,255,255,0.12)",
  background: "rgba(0,0,0,0.35)",
  color: "#f3f4f6",
  fontSize: 12,
};

const ta: CSSProperties = {
  ...inp,
  minHeight: 52,
  resize: "vertical" as const,
  fontFamily: "inherit",
};

const checkRow: CSSProperties = {
  display: "flex",
  alignItems: "center",
  gap: 8,
  fontSize: 12,
  marginBottom: 8,
  color: "#cbd5e1",
  cursor: "pointer",
};

const rangeVal: CSSProperties = { fontSize: 10, color: "#6b7280", textAlign: "right" };

const btnGhost: CSSProperties = {
  marginTop: 6,
  fontSize: 10,
  padding: "3px 8px",
  borderRadius: 6,
  border: "1px solid rgba(255,255,255,0.1)",
  background: "rgba(255,255,255,0.04)",
  color: "#9ca3af",
  cursor: "pointer",
};

const btnDanger: CSSProperties = {
  fontSize: 11,
  padding: "6px 10px",
  borderRadius: 6,
  border: "1px solid rgba(248,113,113,0.35)",
  background: "rgba(127,29,29,0.25)",
  color: "#fecaca",
  cursor: "pointer",
};
