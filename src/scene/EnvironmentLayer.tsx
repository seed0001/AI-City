import { Environment } from "@react-three/drei";

type EnvPreset =
  | "city"
  | "sunset"
  | "dawn"
  | "night"
  | "warehouse"
  | "forest"
  | "apartment"
  | "studio"
  | "park"
  | "lobby";

type Props = {
  preset: EnvPreset;
};

/**
 * Isolated so HDR / preset fetch never blocks the GLB in another Suspense boundary.
 */
export default function EnvironmentLayer({ preset }: Props) {
  return (
    <Environment
      preset={preset}
      background={false}
      environmentIntensity={0.22}
    />
  );
}
