import { useFrame, useLoader } from "@react-three/fiber";
import { useEffect, useLayoutEffect, useRef } from "react";
import { AnimationMixer, Group, LoopRepeat, type Mesh } from "three";
import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader.js";
import type { GLTFParser } from "three/examples/jsm/loaders/GLTFLoader.js";
import { VRMLoaderPlugin, VRM } from "@pixiv/three-vrm";
import {
  createVRMAnimationClip,
  VRMAnimationLoaderPlugin,
  VRMLookAtQuaternionProxy,
  type VRMAnimation,
} from "@pixiv/three-vrm-animation";
import { useCitySimContext } from "../../CitySimContext";
import { getNpcHeightMeters } from "./npcMeshBounds";

const MODEL_URL = "/models/npc/Luna.vrm";
/** Standing idle from Luna 5.0 pack — served from `public/models/npc/standing2.vrma` */
const STANDING_VRMA_URL = "/models/npc/standing2.vrma";
const TARGET_HEIGHT = 1.65;

type Props = { entityId: string };

/**
 * Luna (VRM) — loads optional VRMA standing loop when the file is present.
 */
export default function LunaVrmNpc({ entityId }: Props) {
  const { manager } = useCitySimContext();
  const groupRef = useRef<Group>(null);
  const vrmRef = useRef<VRM | null>(null);
  const mixerRef = useRef<AnimationMixer | null>(null);

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
      o.frustumCulled = false;
    });
    const hM = getNpcHeightMeters(scene);
    if (hM > 0.05 && hM < 20) {
      scene.scale.setScalar(TARGET_HEIGHT / hM);
    }
    scene.updateMatrixWorld(true);

    if (vrm?.lookAt && !vrm.scene.getObjectByName("lookAtQuaternionProxy")) {
      const proxy = new VRMLookAtQuaternionProxy(vrm.lookAt);
      proxy.name = "lookAtQuaternionProxy";
      vrm.scene.add(proxy);
    }
  }, [gltf, vrm]);

  useEffect(() => {
    if (!vrm) return;
    let cancelled = false;

    const loader = new GLTFLoader();
    loader.register(
      (parser: GLTFParser) => new VRMAnimationLoaderPlugin(parser)
    );

    void loader
      .loadAsync(STANDING_VRMA_URL)
      .then((gltfAnim) => {
        if (cancelled) return;
        const raw = gltfAnim.userData as { vrmAnimations?: VRMAnimation[] };
        const vrmAnimation = raw.vrmAnimations?.[0];
        if (!vrmAnimation) {
          console.warn("[LunaVrmNpc] No vrmAnimations in", STANDING_VRMA_URL);
          return;
        }
        const clip = createVRMAnimationClip(vrmAnimation, vrm);
        const mixer = new AnimationMixer(vrm.scene);
        mixerRef.current = mixer;
        const action = mixer.clipAction(clip);
        action.loop = LoopRepeat;
        action.play();
      })
      .catch((err) => {
        console.warn("[LunaVrmNpc] Standing VRMA failed:", err);
      });

    return () => {
      cancelled = true;
      mixerRef.current?.stopAllAction();
      mixerRef.current = null;
    };
  }, [vrm]);

  useFrame((_, delta) => {
    mixerRef.current?.update(delta);
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
