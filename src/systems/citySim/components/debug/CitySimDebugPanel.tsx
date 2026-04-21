import { useCitySim } from "../../hooks/useCitySim";
import { HUMAN_ENTITY_ID } from "../../data/townCharacters";

/**
 * Developer-only HUD. Shows engine truth including controller type.
 * Never import this into PromptBuilder or LLM paths.
 */
export default function CitySimDebugPanel() {
  const { getSnapshot, simVersion } = useCitySim();
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
          <div>mood: {e.mood}</div>
          <div>action: {e.currentAction}</div>
          <div>goal: {e.currentGoal}</div>
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
