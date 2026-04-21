import { Html, Line } from "@react-three/drei";
import { useCitySim } from "../../hooks/useCitySim";
import { useTownLayout } from "../../townLayout/TownLayoutContext";
import { HUMAN_ENTITY_ID } from "../../data/townCharacters";

/**
 * Simulation-only: lines to destination + floating NPC labels when debug overlay is on.
 */
export default function TownDebugOverlay() {
  const { manager, simVersion } = useCitySim();
  const { debugOverlay, mode } = useTownLayout();

  if (mode !== "simulation" || !debugOverlay) return null;

  const entities = manager.entities.all();
  void simVersion;

  return (
    <>
      {entities.map((e) => {
        if (e.id === HUMAN_ENTITY_ID) return null;
        const dest = e.destinationPosition;
        return (
          <group key={e.id}>
            {dest && (
              <Line
                points={[
                  [e.position.x, e.position.y + 0.2, e.position.z],
                  [dest.x, dest.y + 0.2, dest.z],
                ]}
                color="#fde047"
                lineWidth={1.5}
              />
            )}
            <Html position={[e.position.x, e.position.y + 2.1, e.position.z]} center distanceFactor={8}>
              <div
                style={{
                  pointerEvents: "none",
                  color: "#fef08a",
                  fontSize: 9,
                  fontFamily: "ui-monospace, monospace",
                  textShadow: "0 1px 3px #000",
                  whiteSpace: "nowrap",
                  background: "rgba(0,0,0,0.5)",
                  padding: "2px 5px",
                  borderRadius: 4,
                }}
              >
                <div>{e.displayName}</div>
                <div style={{ opacity: 0.85 }}>
                  {e.currentAction} · {e.mood}
                </div>
                <div style={{ opacity: 0.75 }}>{e.currentGoal}</div>
                <div style={{ opacity: 0.65 }}>
                  → {e.destinationLocationId ?? "—"}
                </div>
              </div>
            </Html>
          </group>
        );
      })}
    </>
  );
}
