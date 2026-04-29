import { useEffect, useMemo, useRef, useState } from "react";
import {
  getResidentBrainDebug,
  type BrainDebugResponse,
} from "../../brains/residentBrainClient";

const POLL_INTERVAL_MS = 5000;

export type ResidentBrainDebugEntityHandle = {
  id: string;
  brainKind: "local" | "engine";
  brainConnected: boolean;
};

export default function ResidentBrainDebugSection({
  entities,
  brainServiceConnected,
}: {
  entities: ResidentBrainDebugEntityHandle[];
  brainServiceConnected: boolean;
}) {
  const [debugByEntity, setDebugByEntity] = useState<Record<string, BrainDebugResponse | null>>({});
  const [expanded, setExpanded] = useState<Record<string, boolean>>({});
  const inFlight = useRef<Record<string, boolean>>({});

  // Stable view of which ids are currently engine-backed. Only those ids get
  // polled. An entity that has not yet been initialized (brainKind="local")
  // would 404 on /debug — skipping it removes the noise AND lines up with the
  // init-retry path in ResidentBrainAdapter.updateEntity, which will flip the
  // entity to brainKind="engine" once init succeeds, at which point this
  // component will start polling on its next render.
  const pollableIds = useMemo(
    () => entities.filter((e) => e.brainKind === "engine").map((e) => e.id),
    [entities]
  );
  const pollableIdsKey = pollableIds.join("|");

  useEffect(() => {
    if (!brainServiceConnected) return;
    if (pollableIds.length === 0) return;
    let cancelled = false;

    async function pollOnce(): Promise<void> {
      for (const id of pollableIds) {
        if (inFlight.current[id]) continue;
        inFlight.current[id] = true;
        const data = await getResidentBrainDebug(id);
        inFlight.current[id] = false;
        if (cancelled) return;
        setDebugByEntity((prev) => ({ ...prev, [id]: data }));
      }
    }

    void pollOnce();
    const t = window.setInterval(pollOnce, POLL_INTERVAL_MS);
    return () => {
      cancelled = true;
      window.clearInterval(t);
    };
    // pollableIdsKey captures membership changes without re-running on every
    // unrelated re-render of the parent. brainServiceConnected toggles the
    // whole effect on/off. The other deps are intentionally elided.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pollableIdsKey, brainServiceConnected]);

  return (
    <div
      style={{
        marginTop: 12,
        padding: 8,
        background: "rgba(20,18,30,0.55)",
        border: "1px solid rgba(180,140,255,0.25)",
        borderRadius: 6,
      }}
    >
      <div style={{ fontWeight: 600, color: "#c4b5fd", marginBottom: 6 }}>
        Engine brain (per resident)
      </div>
      {!brainServiceConnected ? (
        <div style={{ color: "#fca5a5", fontSize: 9 }}>
          brain service offline — residents are running on local fallback
        </div>
      ) : null}
      {entities.map((handle) => {
        const id = handle.id;
        const isOpen = expanded[id] ?? false;
        if (handle.brainKind !== "engine") {
          return (
            <div key={id} style={{ marginTop: 6, fontSize: 9, color: "#7a7a8a" }}>
              {id} · awaiting brain init (running on local fallback)
            </div>
          );
        }
        const dbg = debugByEntity[id];
        if (!dbg) {
          return (
            <div key={id} style={{ marginTop: 6, fontSize: 9, color: "#7a7a8a" }}>
              {id} · loading…
            </div>
          );
        }
        const totalEngines = dbg.totalEnginesDiscovered;
        const instantiated = dbg.totalEnginesInstantiated;
        const disabledCount = Object.keys(dbg.disabledEngines).length;
        const decisionSource = dbg.lastDecisionSource;
        const synth = decisionSource === "full_brain_synthesis";
        return (
          <div
            key={id}
            style={{
              marginTop: 8,
              padding: 6,
              background: "rgba(0,0,0,0.25)",
              borderRadius: 4,
              fontSize: 9,
            }}
          >
            <div style={{ color: "#e0d4ff" }}>
              <b>{dbg.displayName}</b> <span style={{ color: "#9a9aaa" }}>({id})</span>
            </div>
            <div style={{ color: "#bfa9ff" }}>
              engines: {instantiated}/{totalEngines} active · disabled {disabledCount} ·
              composites {dbg.totalCompositesWired} · excluded data containers{" "}
              {dbg.totalExcludedDataContainers}
            </div>
            <div style={{ color: synth ? "#86efac" : "#fcd34d" }}>
              last decision source:{" "}
              <b>{synth ? "full_brain_synthesis" : decisionSource}</b>
              {dbg.lastDecisionOutput ? (
                <>
                  {" "}
                  · intent:{" "}
                  <span style={{ color: "#dbeafe" }}>
                    {String(
                      (dbg.lastDecisionOutput as { intent?: string }).intent ?? "—"
                    )}
                  </span>
                </>
              ) : null}
            </div>
            {dbg.lastEmotionSummary ? (
              <div style={{ color: "#c4b5fd" }}>
                emotion: {dbg.lastEmotionSummary}
              </div>
            ) : null}
            {dbg.lastMemorySummary ? (
              <div style={{ color: "#86efac" }}>
                memory: {dbg.lastMemorySummary}
              </div>
            ) : null}
            <div style={{ marginTop: 4 }}>
              <span style={{ color: "#9a9aaa" }}>active by role: </span>
              {Object.entries(dbg.activeEnginesByRole)
                .map(([role, list]) => `${role}:${list.length}`)
                .join(" · ")}
            </div>
            {dbg.contributingEngines || dbg.silentEngines ? (
              <div style={{ marginTop: 4, color: "#a8c4ff" }}>
                contributing: <b>{dbg.contributingEngines?.length ?? 0}</b>
                {" · "}silent: <b>{dbg.silentEngines?.length ?? 0}</b>
              </div>
            ) : null}
            {dbg.lastEventTags && dbg.lastEventTags.length > 0 ? (
              <div style={{ marginTop: 2, color: "#fbcfe8" }}>
                last event tags: {dbg.lastEventTags.join(" · ")}
              </div>
            ) : null}
            {dbg.decisionBreakdown && dbg.decisionBreakdown.length > 0 ? (
              <div style={{ marginTop: 4 }}>
                <span style={{ color: "#9a9aaa" }}>decision breakdown (top 4):</span>
                {dbg.decisionBreakdown.slice(0, 4).map((entry, i) => (
                  <div
                    key={`${entry.engineKey}-${entry.method}-${i}`}
                    style={{ paddingLeft: 6, color: "#dbeafe" }}
                  >
                    <span style={{ color: "#a78bfa" }}>{entry.role}</span>{" "}
                    <span style={{ color: "#7a8a9a" }}>{entry.method}</span>{" "}
                    <span style={{ color: "#86efac" }}>→ {entry.intent}</span>{" "}
                    <span style={{ color: "#fcd34d" }}>w={entry.weight.toFixed(2)}</span>{" "}
                    <span style={{ color: "#7a8a9a" }}>
                      {entry.engineKey.split(".").slice(-1)[0]}
                    </span>
                  </div>
                ))}
              </div>
            ) : null}
            <button
              type="button"
              onClick={() =>
                setExpanded((prev) => ({ ...prev, [id]: !isOpen }))
              }
              style={{
                marginTop: 4,
                fontSize: 9,
                padding: "2px 6px",
                borderRadius: 4,
                border: "1px solid rgba(180,140,255,0.4)",
                background: "rgba(50,40,80,0.4)",
                color: "#dbcfff",
                cursor: "pointer",
              }}
            >
              {isOpen ? "hide engine inventory" : "show engine inventory"}
            </button>
            {isOpen ? (
              <div style={{ marginTop: 6 }}>
                {disabledCount > 0 ? (
                  <div style={{ color: "#fca5a5" }}>
                    <div style={{ fontWeight: 600 }}>disabled engines:</div>
                    {Object.entries(dbg.disabledEngines).map(([k, reason]) => (
                      <div key={k} style={{ paddingLeft: 6, color: "#f1a5a5" }}>
                        {k.split(".").slice(-1)[0]} — {String(reason).slice(0, 120)}
                      </div>
                    ))}
                  </div>
                ) : (
                  <div style={{ color: "#86efac" }}>no disabled engines</div>
                )}
                <div style={{ marginTop: 6, color: "#9a9aaa", fontWeight: 600 }}>
                  active engines by role:
                </div>
                {Object.entries(dbg.activeEnginesByRole).map(([role, list]) => (
                  <div key={role} style={{ paddingLeft: 6 }}>
                    <span style={{ color: "#a8c4ff" }}>{role}</span>{" "}
                    <span style={{ color: "#7a8a9a" }}>({list.length})</span>:{" "}
                    {list
                      .map((k) => k.split(".").slice(-1)[0])
                      .join(", ")}
                  </div>
                ))}
                {dbg.silentEngines && dbg.silentEngines.length > 0 ? (
                  <div style={{ marginTop: 6, color: "#9a9aaa" }}>
                    <div style={{ fontWeight: 600 }}>
                      silent engines ({dbg.silentEngines.length}) — active but no captured output
                    </div>
                    <div style={{ paddingLeft: 6, color: "#7a8a9a" }}>
                      {dbg.silentEngines
                        .slice(0, 30)
                        .map((k) => k.split(".").slice(-1)[0])
                        .join(", ")}
                      {dbg.silentEngines.length > 30 ? " …" : ""}
                    </div>
                  </div>
                ) : null}
                {dbg.contributionCounters &&
                Object.keys(dbg.contributionCounters).length > 0 ? (
                  <div style={{ marginTop: 6, color: "#9a9aaa" }}>
                    <div style={{ fontWeight: 600 }}>
                      decision contributor counters (top 8)
                    </div>
                    {Object.entries(dbg.contributionCounters)
                      .slice(0, 8)
                      .map(([k, v]) => (
                        <div key={k} style={{ paddingLeft: 6, color: "#dbeafe" }}>
                          <span style={{ color: "#fcd34d" }}>{v}</span>{" "}
                          <span style={{ color: "#7a8a9a" }}>
                            {k.split(".").slice(-1)[0]}
                          </span>
                        </div>
                      ))}
                  </div>
                ) : null}
                {dbg.contextSources && dbg.contextSources.length > 0 ? (
                  <div style={{ marginTop: 6, color: "#9a9aaa" }}>
                    <div style={{ fontWeight: 600 }}>
                      conversation context sources ({dbg.contextSources.length})
                    </div>
                    <div style={{ paddingLeft: 6 }}>
                      {dbg.contextSources.slice(0, 12).map((s, i) => (
                        <div
                          key={`${s.engineKey}-${i}`}
                          style={{ color: "#dbeafe" }}
                        >
                          <span style={{ color: "#a78bfa" }}>{s.field}</span>{" "}
                          <span style={{ color: "#7a8a9a" }}>
                            {s.engineKey.split(".").slice(-1)[0]}
                          </span>
                        </div>
                      ))}
                    </div>
                  </div>
                ) : null}
                {dbg.excludedClasses.length > 0 ? (
                  <div style={{ marginTop: 6, color: "#7a8a9a" }}>
                    <div style={{ fontWeight: 600 }}>
                      excluded data containers ({dbg.excludedClasses.length})
                    </div>
                    <div style={{ paddingLeft: 6 }}>
                      {dbg.excludedClasses
                        .map((row) => row.class)
                        .join(", ")}
                    </div>
                  </div>
                ) : null}
              </div>
            ) : null}
          </div>
        );
      })}
    </div>
  );
}
