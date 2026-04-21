import { ContactShadows } from "@react-three/drei";

export default function Ground() {
  return (
    <>
      <ContactShadows
        position={[0, 0.001, 0]}
        opacity={0.55}
        scale={80}
        blur={2.2}
        far={20}
        resolution={2048}
        color="#000000"
      />
      <mesh rotation={[-Math.PI / 2, 0, 0]} receiveShadow>
        <planeGeometry args={[400, 400]} />
        <shadowMaterial transparent opacity={0.25} />
      </mesh>
    </>
  );
}
