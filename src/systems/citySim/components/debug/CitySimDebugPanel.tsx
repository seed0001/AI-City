import { useCitySim } from "../../hooks/useCitySim";
import { HUMAN_ENTITY_ID } from "../../data/townCharacters";
import { EDGE_TTS_VOICE_OPTIONS } from "../../speech/edgeTtsVoiceCatalog";

/**
 * Developer-only HUD. Shows engine truth including controller type.
 * Never import this into PromptBuilder or LLM paths.
 */
export default function CitySimDebugPanel() {
  const { getSnapshot, simVersion, manager, bump } = useCitySim();
  const { entities, tick } = getSnapshot();

  return (
    <div
      style={{
        position: "fixed",
        top: 8,
        right: 8,
        width: 320,
        maxHeight: "70vh",
        overflow: "auto",
        zIndex: 1000,
        fontFamily: "ui-monospace, Menlo, Consolas, monospace",
        fontSize: 10,
        lineHeight: 1.35,
        color: "#d0d0d8",
        background: "rgba(6,8,14,0.88)",
        border: "1px solid rgba(255,255,255,0.1)",
        borderRadius: 8,
        padding: "10px 12px",
        pointerEvents: "auto",
      }}
    >
      <div style={{ fontWeight: 700, marginBottom: 6, color: "#ffb870" }}>
        City sim (debug) · v{simVersion} · t{tick}
      </div>
      {entities.map((e) => (
        <div
          key={e.id}
          style={{
            marginBottom: 10,
            paddingBottom: 8,
            borderBottom: "1px solid rgba(255,255,255,0.06)",
          }}
        >
          <div>
            <b>{e.displayName}</b>{" "}
            <span style={{ color: "#7a7a8a" }}>
              {e.id === HUMAN_ENTITY_ID ? "human" : e.controllerType}
            </span>
          </div>
          {e.controllerType === "ai" ? (
            <label
              style={{
                display: "block",
                marginTop: 6,
                color: "#c8e0ff",
              }}
            >
              <span style={{ display: "block", marginBottom: 2 }}>TTS voice</span>
              <select
                value={e.ttsVoiceId}
                onChange={(ev) => {
                  manager.setNpcTtsVoice(e.id, ev.target.value);
                  bump();
                }}
                style={{
                  width: "100%",
                  maxWidth: "100%",
                  fontSize: 10,
                  fontFamily: "inherit",
                  padding: "4px 6px",
                  borderRadius: 4,
                  border: "1px solid rgba(255,255,255,0.15)",
                  background: "rgba(0,0,0,0.35)",
                  color: "#e8e8f0",
                }}
              >
                {!EDGE_TTS_VOICE_OPTIONS.some((o) => o.id === e.ttsVoiceId) ? (
                  <option value={e.ttsVoiceId}>{e.ttsVoiceId} (custom)</option>
                ) : null}
                {EDGE_TTS_VOICE_OPTIONS.map((o) => (
                  <option key={o.id} value={o.id}>
                    {o.label} · {o.id}
                  </option>
                ))}
              </select>
            </label>
          ) : null}
          <div>mood: {e.mood}</div>
          <div>action: {e.currentAction}</div>
          <div>goal: {e.currentGoal}</div>
          {e.dailyPlan ? (
            <div style={{ marginTop: 6, color: "#a8c8ff" }}>
              <div style={{ fontWeight: 600 }}>day {e.dailyPlan.dayKey}</div>
              <div>{e.dailyPlan.headline}</div>
              <div>
                arc {(e.dailyPlan.arcProgress * 100).toFixed(0)}% · fulfillment{" "}
                {(e.dailyPlan.fulfillment * 100).toFixed(0)}%
              </div>
              <div style={{ marginTop: 3, color: "#8ab0e8" }}>objectives:</div>
              {e.dailyPlan.objectives.map((o) => (
                <div key={o.id} style={{ paddingLeft: 6 }}>
                  {o.completed ? "✓ " : "○ "}
                  {o.summary}
                </div>
              ))}
              <div style={{ marginTop: 3, color: "#8ab0e8" }}>needs:</div>
              {e.dailyPlan.needs.map((n) => (
                <div key={n.kind} style={{ paddingLeft: 6 }}>
                  {n.kind}: {(n.satisfaction * 100).toFixed(0)}% — {n.label}
                </div>
              ))}
              <div style={{ marginTop: 3, color: "#8ab0e8" }}>desires:</div>
              {e.dailyPlan.desires.map((d) => (
                <div key={d.id} style={{ paddingLeft: 6 }}>
                  ({(d.salience * 100).toFixed(0)}%) {d.label}
                </div>
              ))}
            </div>
          ) : null}
          <div>
            pos: ({e.position.x.toFixed(1)}, {e.position.y.toFixed(1)},{" "}
            {e.position.z.toFixed(1)})
          </div>
          <div>dest: {e.destinationLocationId ?? "—"}</div>
          <div>avoiding: {e.avoidingEntityId ?? "—"}</div>
          <div style={{ marginTop: 4, color: "#9a9aaa" }}>relationships:</div>
          {Object.entries(e.relationships).map(([oid, r]) => (
            <div key={oid} style={{ paddingLeft: 6 }}>
              {oid.slice(0, 8)}… T{r.tension.toFixed(2)} / Tr
              {r.trust.toFixed(2)} / F{r.familiarity.toFixed(2)}
            </div>
          ))}
          <div style={{ marginTop: 4, color: "#9a9aaa" }}>memories:</div>
          <div style={{ paddingLeft: 6, color: "#8a8a9a" }}>
            {e.memoryIds.length ? `${e.memoryIds.length} stored` : "none"}
          </div>
        </div>
      ))}
    </div>
  );
}
