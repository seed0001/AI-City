import { useLayoutEffect, useMemo, useRef } from "react";
import { useGLTF } from "@react-three/drei";
import { useThree } from "@react-three/fiber";
import {
  Box3,
  Group,
  Mesh,
  MeshStandardMaterial,
  PerspectiveCamera,
  Raycaster,
  Vector3,
} from "three";
import type { OrbitControls as OrbitControlsImpl } from "three-stdlib";

import { SKY_RADIUS } from "./skyConstants";

export type BoundsInfo = {
  maxExtent: number;
  size: Vector3;
  eyeHeight: number;
};

type Props = {
  url: string;
  onBoundsReady?: (info: BoundsInfo) => void;
};

export default function BurgerPizModel({ url, onBoundsReady }: Props) {
  const gltf = useGLTF(url);
  const ref = useRef<Group>(null);

  const { camera, controls } = useThree(
    (s) => ({
      camera: s.camera,
      controls: s.controls as OrbitControlsImpl | null,
    })
  );

  const scene = useMemo(() => gltf.scene.clone(true), [gltf.scene]);

  useLayoutEffect(() => {
    let cancelled = false;
    let attempts = 0;

    const fit = () => {
      if (cancelled || !ref.current) return;
      attempts += 1;

      scene.traverse((obj) => {
        if ((obj as Mesh).isMesh) {
          const mesh = obj as Mesh;
          mesh.castShadow = true;
          mesh.receiveShadow = true;

          const mat = mesh.material as
            | MeshStandardMaterial
            | MeshStandardMaterial[];
          const mats = Array.isArray(mat) ? mat : [mat];
          for (const m of mats) {
            if (!m) continue;
            if ("map" in m && m.map) {
              m.map.anisotropy = 8;
            }
            m.needsUpdate = true;
          }
        }
      });

      ref.current!.updateMatrixWorld(true);
      const box = new Box3().setFromObject(ref.current!);
      if (box.isEmpty()) {
        if (attempts < 8) {
          requestAnimationFrame(fit);
        } else {
          console.warn("BurgerPiz: bounding box stayed empty after retries");
        }
        return;
      }

      const center = new Vector3();
      const size = new Vector3();
      box.getCenter(center);
      box.getSize(size);

      ref.current!.position.x -= center.x;
      ref.current!.position.z -= center.z;
      ref.current!.position.y -= box.min.y;

      ref.current!.updateMatrixWorld(true);
      const box2 = new Box3().setFromObject(ref.current!);
      box2.getSize(size);

      const maxExtent = Math.max(size.x, size.y, size.z, 1);
      const spawnZ = maxExtent * 0.14;

      // Ray from high above spawn: intersections are sorted by distance from ray origin (top).
      // The last hit is the lowest surface along the ray — the walkable ground (not roof tops).
      const raycaster = new Raycaster();
      const rayDir = new Vector3(0, -1, 0);
      const rayHeight = box2.max.y + maxExtent * 4;

      const groundHits = (x: number, z: number) => {
        raycaster.set(new Vector3(x, rayHeight, z), rayDir);
        return raycaster.intersectObjects([ref.current!], true);
      };

      let hits = groundHits(0, spawnZ);
      if (hits.length === 0) {
        hits = groundHits(0, 0);
      }

      let groundY = box2.min.y;
      if (hits.length > 0) {
        groundY = hits[hits.length - 1]!.point.y;
      }

      // Eye offset above ground: scales slightly with scene height, stays human-sized.
      const eyeOffset = Math.min(Math.max(size.y * 0.024, 1.35), 2.2);
      const eyeHeight = groundY + eyeOffset;

      onBoundsReady?.({ maxExtent, size: size.clone(), eyeHeight });

      if (camera instanceof PerspectiveCamera) {
        const fitDistance =
          (maxExtent * 0.5) / Math.tan((camera.fov * Math.PI) / 360);
        const dir = new Vector3(1, 0.55, 1).normalize();
        camera.position.copy(dir.multiplyScalar(fitDistance * 1.65));
        camera.near = Math.max(0.01, maxExtent / 8000);
        camera.far = Math.max(100_000, maxExtent * 80, SKY_RADIUS * 1.25);
        camera.updateProjectionMatrix();
        const lookY = maxExtent * 0.06;
        camera.lookAt(0, lookY, 0);

        if (controls) {
          controls.target.set(0, lookY, 0);
          controls.minDistance = maxExtent * 0.12;
          controls.maxDistance = maxExtent * 10;
          controls.update();
        }
      }
    };

    const id = requestAnimationFrame(fit);
    return () => {
      cancelled = true;
      cancelAnimationFrame(id);
    };
  }, [scene, camera, controls, onBoundsReady]);

  return (
    <group ref={ref}>
      <primitive object={scene} />
    </group>
  );
}

useGLTF.preload("/models/BurgerPiz.glb");
