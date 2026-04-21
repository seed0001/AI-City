import { useMemo } from "react";
import { Vector2 } from "three";

export default function Lighting() {
  const shadowMapSize = useMemo(() => new Vector2(2048, 2048), []);

  return (
    <>
      <hemisphereLight args={["#c8d8ff", "#1a1410", 0.55]} />

      <ambientLight intensity={0.55} />

      <directionalLight
        castShadow
        position={[18, 24, 12]}
        intensity={2.8}
        color="#fff4e0"
        shadow-mapSize={shadowMapSize}
        shadow-bias={-0.00015}
        shadow-normalBias={0.06}
        shadow-camera-near={0.5}
        shadow-camera-far={800}
        shadow-camera-left={-220}
        shadow-camera-right={220}
        shadow-camera-top={220}
        shadow-camera-bottom={-220}
      />

      <directionalLight
        position={[-15, 10, -10]}
        intensity={0.85}
        color="#7fb0ff"
      />
    </>
  );
}
