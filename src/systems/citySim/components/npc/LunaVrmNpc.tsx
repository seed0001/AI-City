import { useFrame, useLoader } from "@react-three/fiber";
import { useEffect, useLayoutEffect, useRef } from "react";
import { Group, type Mesh } from "three";
import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader.js";
import type { GLTFParser } from "three/examples/jsm/loaders/GLTFLoader.js";
import { VRMLoaderPlugin, VRM } from "@pixiv/three-vrm";
import { useCitySimContext } from "../../CitySimContext";
import { getNpcHeightMeters } from "./npcMeshBounds";

const MODEL_URL = "/models/npc/Luna.vrm";
const TARGET_HEIGHT = 1.65;

type Props = { entityId: string };

/**
 * Luna (VRM) — first AI character slot (npc_tom).
 */
export default function LunaVrmNpc({ entityId }: Props) {
  const { manager } = useCitySimContext();
  const groupRef = useRef<Group>(null);
  const vrmRef = useRef<VRM | null>(null);

  const gltf = useLoader(
    GLTFLoader,
    MODEL_URL,
    (loader) => {
      loader.register((parser: GLTFParser) => new VRMLoaderPlugin(parser));
    }
  );

  const vrm = (gltf.userData.vrm as VRM | undefined) ?? null;

  useEffect(() => {
    vrmRef.current = vrm;
  }, [vrm]);

  useLayoutEffect(() => {
    const scene = gltf.scene;
    scene.scale.set(1, 1, 1);
    scene.traverse((o) => {
      const m = o as Mesh;
      if (m.isMesh) {
        m.castShadow = true;
        m.receiveShadow = true;
      }
    });
    const hM = getNpcHeightMeters(scene);
    if (hM > 0.05 && hM < 20) {
      scene.scale.setScalar(TARGET_HEIGHT / hM);
    }
    scene.updateMatrixWorld(true);
  }, [gltf]);

  useFrame((_, delta) => {
    vrmRef.current?.update(delta);
    const e = manager.entities.get(entityId);
    if (!e || !groupRef.current) return;
    groupRef.current.position.set(e.position.x, e.position.y, e.position.z);
    groupRef.current.rotation.y = e.rotation;
  });

  return (
    <group ref={groupRef}>
      <primitive object={gltf.scene} />
    </group>
  );
}
