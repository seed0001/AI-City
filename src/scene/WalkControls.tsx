import { PointerLockControls } from "@react-three/drei";
import { useFrame, useThree } from "@react-three/fiber";
import { useEffect, useRef } from "react";
import { Vector3 } from "three";

type Props = {
  enabled: boolean;
  moveSpeed: number;
  eyeHeight: number;
  /**
   * Clicks on these elements (only) call `lock()`. Default is the scene WebGL canvas
   * — never `document` — so UI buttons/inputs do not require Esc to get the mouse back.
   */
  pointerLockSelector?: string;
};

const KEYS = ["KeyW", "KeyS", "KeyA", "KeyD", "ShiftLeft"] as const;

function isEditableTarget(t: EventTarget | null): boolean {
  if (!t || !(t as Node)) return false;
  const el = t as Element;
  if (el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement) {
    return el.type !== "button" && el.type !== "submit" && el.type !== "reset";
  }
  if (el instanceof HTMLSelectElement) return true;
  if (el instanceof HTMLElement && el.isContentEditable) return true;
  return el.closest?.("input, textarea, select, [contenteditable='true']") != null;
}

function clearKeyMap(
  m: React.MutableRefObject<Record<string, boolean>>
): void {
  for (const k of KEYS) m.current[k] = false;
}

export default function WalkControls({
  enabled,
  moveSpeed,
  eyeHeight,
  pointerLockSelector = ".city-scene-canvas-wrap canvas",
}: Props) {
  const { camera } = useThree();
  const keys = useRef<Record<string, boolean>>({});

  // Optional: if selector matches 0 elements (e.g. tests), fall back to the actual gl canvas
  const selector = pointerLockSelector;

  useEffect(() => {
    const down = (e: KeyboardEvent) => {
      if (isEditableTarget(e.target) || e.defaultPrevented) return;
      if (KEYS.includes(e.code as (typeof KEYS)[number]))
        keys.current[e.code] = true;
    };
    const up = (e: KeyboardEvent) => {
      if (isEditableTarget(e.target)) return;
      if (KEYS.includes(e.code as (typeof KEYS)[number]))
        keys.current[e.code] = false;
    };
    const onFocusIn = (e: FocusEvent) => {
      if (isEditableTarget(e.target)) {
        clearKeyMap(keys);
        if (document.pointerLockElement) document.exitPointerLock();
      }
    };
    window.addEventListener("keydown", down);
    window.addEventListener("keyup", up);
    document.addEventListener("focusin", onFocusIn);
    return () => {
      window.removeEventListener("keydown", down);
      window.removeEventListener("keyup", up);
      document.removeEventListener("focusin", onFocusIn);
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

  return (
    <PointerLockControls
      makeDefault
      // Critical: do NOT use default [document] — that locks on any page click.
      selector={selector}
    />
  );
}
