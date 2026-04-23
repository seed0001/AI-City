import { useCitySim } from "../../hooks/useCitySim";
import { HUMAN_ENTITY_ID } from "../../data/townCharacters";
import { EDGE_TTS_VOICE_OPTIONS } from "../../speech/edgeTtsVoiceCatalog";
import { MAX_ACTIVE_CONVERSATIONS } from "../../constants";

/**
 * Developer-only HUD. Shows engine truth including controller type.
 * Never import this into PromptBuilder or LLM paths.
 */
export default function CitySimDebugPanel() {
  const { getSnapshot, simVersion, manager, bump } = useCitySim();
  const { entities, tick } = getSnapshot();
  const now = Date.now();
  const convDebug = manager.conversations.getDebugSnapshot(entities, now);

  return (
    <div
      onPointerDownCapture={() => {
        if (document.pointerLockElement) document.exitPointerLock();
      }}
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
      <div
        style={{
          marginBottom: 10,
          padding: 8,
          background: "rgba(20,30,50,0.5)",
          border: "1px solid rgba(100,150,255,0.2)",
          borderRadius: 6,
          color: "#b8c8e8",
        }}
      >
        <div style={{ fontWeight: 600, color: "#8ab4ff" }}>Conversations</div>
        <div style={{ fontSize: 9, color: "#6a7a8a" }}>
          active: {manager.conversations.getActiveCount()} (max {MAX_ACTIVE_CONVERSATIONS})
        </div>
        {convDebug.activeConversations.length ? (
          convDebug.activeConversations.map((c) => (
            <div
              key={c.id}
              style={{
                marginTop: 6,
                fontSize: 9,
                padding: 6,
                background: "rgba(0,0,0,0.25)",
                borderRadius: 4,
              }}
            >
              <div style={{ color: "#a8c4ff" }}>
                {c.id.slice(0, 20)}…
              </div>
              <div>{c.displayNames}</div>
              <div style={{ color: "#7a8a9a" }}>loc: {c.locationId}</div>
              <div style={{ marginTop: 2, color: "#9ab0c8" }}>
                last: “{c.lastTurnText.length > 80
                  ? `${c.lastTurnText.slice(0, 80)}…`
                  : c.lastTurnText}”
              </div>
              <div style={{ color: "#5a6a7a" }}>
                {c.turns} turns · {Math.round(c.msSinceLastTurn / 100) / 10}s since last
              </div>
            </div>
          ))
        ) : (
          <div style={{ fontSize: 9, color: "#5a5a6a" }}>none</div>
        )}
        <div style={{ marginTop: 8, color: "#7a8a9a" }}>entity state</div>
        {convDebug.entityConversation.map((r) => (
          <div key={r.id} style={{ fontSize: 8, color: "#6a7a8a" }}>
            {r.name}: in={String(r.inConversation)}
            {r.conversationId
              ? ` · ${r.conversationId.slice(0, 16)}…`
              : ""}
          </div>
        ))}
      </div>
      {manager.burgerService ? (
        <div
          style={{
            marginBottom: 10,
            padding: 8,
            background: "rgba(30,50,20,0.4)",
            border: "1px solid rgba(120,200,100,0.25)",
            borderRadius: 6,
            color: "#b8e8a8",
          }}
        >
          <div style={{ fontWeight: 600, color: "#86efac" }}>Burger service</div>
          <div>
            phase: {manager.burgerService.runtime.workerPhase} · order:{" "}
            {manager.burgerService.runtime.activeOrderId ?? "—"}
          </div>
          <div>
            till: ${manager.burgerService.runtime.cashInDrawer.toFixed(0)} · open orders:{" "}
            {manager.burgerService.runtime.orders.length}
          </div>
          {(() => {
            const b = manager.burgerService.getDebugSnapshot();
            return (
              <div style={{ marginTop: 4, fontSize: 9, color: "#7a9a7a" }}>
                player ${b.humanMoney?.toFixed(0) ?? "—"} · prep @{" "}
                {b.prepCompleteAt
                  ? new Date(b.prepCompleteAt).toLocaleTimeString()
                  : "—"}{" "}
                · lock {b.primaryWorker ? String(b.primaryWorker.lock) : "—"}
              </div>
            );
          })()}
          <div style={{ fontSize: 9, color: "#5a6a5a" }}>
            orders:{" "}
            {manager.burgerService.runtime.orders
              .map((o) => `${o.id.slice(-6)}:${o.state}`)
              .join(" · ") || "—"}
          </div>
        </div>
      ) : (
        <div
          style={{
            marginBottom: 8,
            fontSize: 9,
            color: "#5a5a6a",
          }}
        >
          Burger joint: inactive (place required sub-markers + relaunch)
        </div>
      )}
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
              {e.gender} · {e.id === HUMAN_ENTITY_ID ? "human" : e.controllerType} ·
              d{e.townDaysLived} ·
              {Math.round(e.lifeAdaptation * 100)}% roots · $
              {e.money.toFixed(0)}
            </span>
            {e.id === "npc_maya" && manager.burgerService ? (
              <span style={{ color: "#a7f3d0" }}> · burger line</span>
            ) : null}
            {e.id === "npc_river" && manager.burgerService ? (
              <span style={{ color: "#a7c4f3" }}> · shift lead (bench)</span>
            ) : null}
          </div>
          <div style={{ color: "#8a8a9a", marginTop: 2, fontSize: 9 }}>
            {e.controllerType === "ai" && e.townRoleOptions.length ? (
              <>
                <span style={{ color: "#b8c4d8" }}>{e.role}</span>
                {e.townRoleOptions.filter((r) => r !== e.role).length
                  ? ` — could be: ${e.townRoleOptions
                      .filter((r) => r !== e.role)
                      .join(", ")}`
                  : null}
              </>
            ) : null}
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
