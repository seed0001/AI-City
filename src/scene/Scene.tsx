import { Suspense, useCallback, useMemo, useState } from "react";
import { Canvas } from "@react-three/fiber";
import TownLayoutScene from "../systems/citySim/components/townLayout/TownLayoutScene";
import TownDebugOverlay from "../systems/citySim/components/townLayout/TownDebugOverlay";
import {
  AdaptiveDpr,
  AdaptiveEvents,
  PerformanceMonitor,
  Preload,
} from "@react-three/drei";
import { ACESFilmicToneMapping, SRGBColorSpace } from "three";

import BurgerPizModel, { type BoundsInfo } from "./BurgerPizModel";
import Lighting from "./Lighting";
import Ground from "./Ground";
import WalkControls from "./WalkControls";
import EnvironmentLayer from "./EnvironmentLayer";
import WalkSpawn from "./WalkSpawn";
import NightSky from "./NightSky";
import CitySimLoop from "../systems/citySim/components/CitySimLoop";
import CitySimVisuals from "../systems/citySim/components/CitySimVisuals";

const EXPOSURE = 1;
const WALK_SPEED = 4.5;

function SceneContent() {
  const [bounds, setBounds] = useState<BoundsInfo | null>(null);

  const onBoundsReady = useCallback((info: BoundsInfo) => {
    setBounds(info);
  }, []);

  const glConfig = useMemo(
    () => ({
      antialias: true,
      powerPreference: "high-performance" as const,
      toneMapping: ACESFilmicToneMapping,
      outputColorSpace: SRGBColorSpace,
    }),
    []
  );

  return (
    <Canvas
      shadows
      dpr={[1, 2]}
      gl={glConfig}
      camera={{ fov: 45, near: 0.05, far: 250000, position: [12, 8, 14] }}
      onCreated={({ gl }) => {
        gl.toneMappingExposure = EXPOSURE;
      }}
    >
      <PerformanceMonitor
        onDecline={() => {
          /* adaptive DPR + events handle dynamic downscaling */
        }}
      />
      <AdaptiveDpr pixelated={false} />
      <AdaptiveEvents />

      <color attach="background" args={["#000000"]} />

      <NightSky />

      <Lighting />

      <Suspense fallback={null}>
        <BurgerPizModel url="/models/BurgerPiz.glb" onBoundsReady={onBoundsReady} />
      </Suspense>

      <Suspense fallback={null}>
        <EnvironmentLayer preset="night" />
      </Suspense>

      <WalkSpawn bounds={bounds} />

      <Ground />

      <CitySimLoop />
      <TownLayoutScene />
      <TownDebugOverlay />
      <CitySimVisuals />

      {bounds && (
        <WalkControls
          enabled
          moveSpeed={WALK_SPEED}
          eyeHeight={bounds.eyeHeight}
        />
      )}

      <Preload all />
    </Canvas>
  );
}

export default function Scene() {
  return <SceneContent />;
}
