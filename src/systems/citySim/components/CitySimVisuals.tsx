import { Html } from "@react-three/drei";
import { useFrame } from "@react-three/fiber";
import { useRef } from "react";
import { CapsuleGeometry, Group, Mesh, MeshStandardMaterial } from "three";
import { useCitySimContext } from "../CitySimContext";
import BobVrmNpc from "./npc/BobVrmNpc";
import LunaVrmNpc from "./npc/LunaVrmNpc";
import SarahVrmNpc from "./npc/SarahVrmNpc";

const geom = new CapsuleGeometry(0.35, 1.1, 6, 12);
const matBob = new MeshStandardMaterial({ color: "#94d2bd" });
const matSarah = new MeshStandardMaterial({ color: "#ff9e00" });
const matAdam = new MeshStandardMaterial({ color: "#ff6b6b" });

function capsuleMaterial(id: string) {
  if (id === "npc_bob") return matBob;
  if (id === "npc_sarah") return matSarah;
  return matAdam;
}

function NpcCapsuleVisual({
  id,
  displayName,
}: {
  id: string;
  displayName: string;
}) {
  const { manager } = useCitySimContext();
  const groupRef = useRef<Group>(null);
  const meshRef = useRef<Mesh>(null);

  useFrame(() => {
    const e = manager.entities.get(id);
    if (!e || !groupRef.current || !meshRef.current) return;
    groupRef.current.position.set(e.position.x, e.position.y, e.position.z);
    meshRef.current.position.set(0, -0.55, 0);
    meshRef.current.rotation.y = e.rotation;
  });

  return (
    <group ref={groupRef}>
      <mesh
        ref={meshRef}
        castShadow
        material={capsuleMaterial(id)}
        geometry={geom}
      />
      <Html position={[0, 1.15, 0]} center distanceFactor={8}>
        <div
          style={{
            pointerEvents: "none",
            color: "#e8e8ef",
            fontSize: 10,
            fontFamily: "system-ui, sans-serif",
            textShadow: "0 1px 4px #000",
            whiteSpace: "nowrap",
          }}
        >
          {displayName}
        </div>
      </Html>
    </group>
  );
}

function NpcLabel({
  entityId,
  displayName,
}: {
  entityId: string;
  displayName: string;
}) {
  const { manager } = useCitySimContext();
  const groupRef = useRef<Group>(null);

  useFrame(() => {
    const e = manager.entities.get(entityId);
    if (!e || !groupRef.current) return;
    groupRef.current.position.set(e.position.x, e.position.y + 1.85, e.position.z);
  });

  return (
    <group ref={groupRef}>
      <Html center distanceFactor={8}>
        <div
          style={{
            pointerEvents: "none",
            color: "#e8e8ef",
            fontSize: 10,
            fontFamily: "system-ui, sans-serif",
            textShadow: "0 1px 4px #000",
            whiteSpace: "nowrap",
          }}
        >
          {displayName}
        </div>
      </Html>
    </group>
  );
}

/** Mix of capsule/VRM NPC visuals while simulation is running. */
export default function CitySimVisuals() {
  const { manager } = useCitySimContext();
  if (!manager.simulationEnabled) return null;
  const hasNpc = Boolean(manager.entities.get("npc_bob"));
  if (!hasNpc) return null;

  return (
    <>
      <BobVrmNpc entityId="npc_bob" />
      <NpcLabel entityId="npc_bob" displayName="Bob" />
      <SarahVrmNpc entityId="npc_sarah" />
      <NpcLabel entityId="npc_sarah" displayName="Sarah" />
      <LunaVrmNpc entityId="npc_luna" />
      <NpcLabel entityId="npc_luna" displayName="Luna" />
      <NpcCapsuleVisual id="npc_adam" displayName="Adam" />
    </>
  );
}
