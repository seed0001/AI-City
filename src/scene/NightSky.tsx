import { useFrame, useThree } from "@react-three/fiber";
import { useMemo, useRef } from "react";
import {
  BackSide,
  Mesh,
  PerspectiveCamera,
  ShaderMaterial,
  Vector3,
  type ShaderMaterialParameters,
} from "three";
import { nightSkyFragmentShader, nightSkyVertexShader } from "./nightSkyShader";
import { SKY_RADIUS } from "./skyConstants";

/**
 * Procedural night sky. `args={[params]}` matches THREE.ShaderMaterial constructor
 * so uniforms and shaders are applied reliably (spread props can fail silently).
 */
export default function NightSky() {
  const meshRef = useRef<Mesh>(null);
  const { camera } = useThree();

  const shaderArgs = useMemo((): [ShaderMaterialParameters] => [
    {
      uniforms: {
          uCameraPosition: { value: new Vector3() },
          uTime: { value: 0 },
          uStarExponent: { value: 72 },
          uStarMult: { value: 18 },
          uStarCull: { value: 0.45 },
          uNebulaBlue: { value: 1.0 },
          uNebulaPurple: { value: 1.0 },
          uNightGroundTint: { value: new Vector3(0.03, 0.04, 0.08) },
          uNightGroundStr: { value: 0.4 },
        },
        vertexShader: nightSkyVertexShader,
        fragmentShader: nightSkyFragmentShader,
        side: BackSide,
        depthWrite: false,
        depthTest: false,
        toneMapped: false,
        fog: false,
      },
    ],
  []);

  useFrame(({ clock }) => {
    const mesh = meshRef.current;
    if (!mesh) return;
    mesh.position.copy(camera.position);
    const mat = mesh.material as ShaderMaterial;
    if (!mat.uniforms) return;
    mat.uniforms.uCameraPosition.value.copy(camera.position);
    mat.uniforms.uTime.value = clock.elapsedTime;

    if (camera instanceof PerspectiveCamera) {
      const minFar = SKY_RADIUS * 1.25;
      if (camera.far < minFar) {
        camera.far = minFar;
        camera.updateProjectionMatrix();
      }
    }
  });

  return (
    <mesh ref={meshRef} frustumCulled={false} renderOrder={-1000}>
      <sphereGeometry args={[SKY_RADIUS, 64, 48]} />
      <shaderMaterial attach="material" args={shaderArgs} />
    </mesh>
  );
}
