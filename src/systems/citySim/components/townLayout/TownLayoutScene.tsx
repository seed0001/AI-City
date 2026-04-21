import { Html } from "@react-three/drei";
import { useFrame, useThree } from "@react-three/fiber";
import { useEffect, useMemo, useRef, useState } from "react";
import {
  CylinderGeometry,
  DoubleSide,
  MeshBasicMaterial,
  MeshStandardMaterial,
  Plane,
  RingGeometry,
  Vector3,
} from "three";
import { useTownLayout } from "../../townLayout/TownLayoutContext";
import type { PlacedMarkerRecord } from "../../townLayout/types";

const groundPlane = new Plane(new Vector3(0, 1, 0), 0);
const hit = new Vector3();

const cylGeo = new CylinderGeometry(0.6, 0.6, 0.35, 16);
const ringGeo = new RingGeometry(0.92, 1, 48);

const matHome = new MeshStandardMaterial({ color: "#3b82f6" });
const matStore = new MeshStandardMaterial({ color: "#22c55e" });
const matPark = new MeshStandardMaterial({ color: "#84cc16" });
const matSocial = new MeshStandardMaterial({ color: "#a855f7" });
const matSel = new MeshStandardMaterial({ color: "#fbbf24" });
const matRing = new MeshBasicMaterial({
  color: "#ffffff",
  opacity: 0.35,
  transparent: true,
  side: DoubleSide,
});

function pickMat(m: PlacedMarkerRecord, selected: boolean) {
  if (selected) return matSel;
  switch (m.type) {
    case "home":
      return matHome;
    case "store":
      return matStore;
    case "park":
      return matPark;
    case "social":
      return matSocial;
    default:
      return matHome;
  }
}

/**
 * Layout-mode placement surface + placed markers. In simulation, only shown when debug overlay is on.
 */
export default function TownLayoutScene() {
  const {
    mode,
    markers,
    armedKey,
    selectedKey,
    debugOverlay,
    placeMarkerAt,
    moveMarkerTo,
    selectMarker,
    armMarker,
  } = useTownLayout();

  const showMarkers = mode === "layout" || debugOverlay;
  const interactive = mode === "layout";

  const { camera, raycaster, pointer } = useThree();
  const dragKeyRef = useRef<string | null>(null);
  const [dragKey, setDragKey] = useState<string | null>(null);
  dragKeyRef.current = dragKey;

  useFrame(() => {
    const key = dragKeyRef.current;
    if (!key || !interactive) return;
    raycaster.setFromCamera(pointer, camera);
    if (raycaster.ray.intersectPlane(groundPlane, hit)) {
      moveMarkerTo(key, { x: hit.x, y: 0, z: hit.z });
    }
  });

  useEffect(() => {
    if (!interactive) {
      setDragKey(null);
      return;
    }
    const up = () => setDragKey(null);
    window.addEventListener("pointerup", up);
    return () => window.removeEventListener("pointerup", up);
  }, [interactive]);

  const placed = useMemo(() => Object.values(markers), [markers]);

  if (!showMarkers && !interactive) return null;

  return (
    <>
      {interactive && (
        <mesh
          rotation={[-Math.PI / 2, 0, 0]}
          position={[0, 0.02, 0]}
          onPointerDown={(e) => {
            e.stopPropagation();
            if (armedKey) {
              placeMarkerAt(armedKey, {
                x: e.point.x,
                y: e.point.y,
                z: e.point.z,
              });
            } else {
              selectMarker(null);
              armMarker(null);
            }
          }}
        >
          <planeGeometry args={[400, 400]} />
          <meshBasicMaterial
            color={armedKey ? "#4f46e5" : "#000000"}
            opacity={armedKey ? 0.07 : 0}
            transparent
            depthWrite={false}
          />
        </mesh>
      )}

      {placed.map((m) => (
        <MarkerMesh
          key={m.key}
          m={m}
          selected={selectedKey === m.key}
          interactive={interactive}
          showRing={mode === "layout" || debugOverlay}
          showLabel={mode === "layout" || debugOverlay}
          onSelect={() => {
            selectMarker(m.key);
            armMarker(null);
          }}
          onDragStart={() => setDragKey(m.key)}
        />
      ))}
    </>
  );
}

function MarkerMesh({
  m,
  selected,
  interactive,
  showRing,
  showLabel,
  onSelect,
  onDragStart,
}: {
  m: PlacedMarkerRecord;
  selected: boolean;
  interactive: boolean;
  showRing: boolean;
  showLabel: boolean;
  onSelect: () => void;
  onDragStart: () => void;
}) {
  const y = 0.175;
  return (
    <group position={[m.position.x, y, m.position.z]}>
      <mesh
        rotation={[0, m.rotation, 0]}
        castShadow
        material={pickMat(m, selected)}
        geometry={cylGeo}
        onPointerDown={(e) => {
          if (!interactive) return;
          e.stopPropagation();
          onSelect();
          (e.target as Element).setPointerCapture?.(e.pointerId);
          onDragStart();
        }}
      />
      {showRing && (
        <mesh
          rotation={[-Math.PI / 2, 0, 0]}
          position={[0, -y + 0.02, 0]}
          material={matRing}
          geometry={ringGeo}
          scale={[m.radius, m.radius, 1]}
        />
      )}
      {showLabel && (
        <Html position={[0, 0.5, 0]} center distanceFactor={10}>
          <div
            style={{
              pointerEvents: "none",
              color: "#f0f0f8",
              fontSize: 10,
              fontFamily: "system-ui, sans-serif",
              textShadow: "0 1px 4px #000",
              whiteSpace: "nowrap",
              background: "rgba(0,0,0,0.45)",
              padding: "2px 6px",
              borderRadius: 4,
            }}
          >
            {m.label}
            {m.assignedTo ? ` · ${m.assignedTo}` : ""}
          </div>
        </Html>
      )}
    </group>
  );
}
