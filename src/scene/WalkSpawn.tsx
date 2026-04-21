import { useEffect } from "react";
import { useThree } from "@react-three/fiber";
import type { BoundsInfo } from "./BurgerPizModel";

export default function WalkSpawn({ bounds }: { bounds: BoundsInfo | null }) {
  const { camera } = useThree();
  useEffect(() => {
    if (!bounds) return;
    const z = bounds.maxExtent * 0.14;
    camera.position.set(0, bounds.eyeHeight, z);
    camera.lookAt(0, bounds.eyeHeight, 0);
  }, [bounds, camera]);
  return null;
}
