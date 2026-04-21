import { useFrame, useThree } from "@react-three/fiber";
import { useCitySimContext } from "../CitySimContext";

let frameCount = 0;

/**
 * Drives simulation time from the R3F render loop and syncs the human entity to the camera.
 */
export default function CitySimLoop() {
  const { manager, bump } = useCitySimContext();
  const { camera } = useThree();

  useFrame((_, delta) => {
    manager.tick(
      delta,
      {
        x: camera.position.x,
        y: camera.position.y,
        z: camera.position.z,
      },
      camera.rotation.y
    );
    frameCount += 1;
    if (frameCount % 12 === 0) bump();
  });

  return null;
}
