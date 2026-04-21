import { PointerLockControls } from "@react-three/drei";
import { useThree, useFrame } from "@react-three/fiber";
import { useEffect, useRef } from "react";
import { Vector3 } from "three";

type Props = {
  enabled: boolean;
  moveSpeed: number;
  eyeHeight: number;
};

const KEYS = ["KeyW", "KeyS", "KeyA", "KeyD", "ShiftLeft"];

export default function WalkControls({
  enabled,
  moveSpeed,
  eyeHeight,
}: Props) {
  const { camera } = useThree();
  const keys = useRef<Record<string, boolean>>({});

  useEffect(() => {
    const down = (e: KeyboardEvent) => {
      if (KEYS.includes(e.code)) keys.current[e.code] = true;
    };
    const up = (e: KeyboardEvent) => {
      if (KEYS.includes(e.code)) keys.current[e.code] = false;
    };
    window.addEventListener("keydown", down);
    window.addEventListener("keyup", up);
    return () => {
      window.removeEventListener("keydown", down);
      window.removeEventListener("keyup", up);
    };
  }, []);

  const forward = useRef(new Vector3());
  const right = useRef(new Vector3());
  const move = useRef(new Vector3());

  useFrame((_, delta) => {
    if (!enabled) return;

    camera.getWorldDirection(forward.current);
    forward.current.y = 0;
    if (forward.current.lengthSq() < 1e-6) {
      forward.current.set(0, 0, -1);
    } else {
      forward.current.normalize();
    }

    right.current
      .crossVectors(forward.current, new Vector3(0, 1, 0))
      .normalize();

    move.current.set(0, 0, 0);
    if (keys.current.KeyW) move.current.add(forward.current);
    if (keys.current.KeyS) move.current.sub(forward.current);
    if (keys.current.KeyA) move.current.sub(right.current);
    if (keys.current.KeyD) move.current.add(right.current);

    const sprint = keys.current.ShiftLeft ? 2.2 : 1;

    if (move.current.lengthSq() > 0) {
      move.current.normalize().multiplyScalar(moveSpeed * sprint * delta);
      camera.position.add(move.current);
    }

    camera.position.y = eyeHeight;
  });

  if (!enabled) return null;

  return <PointerLockControls makeDefault />;
}
