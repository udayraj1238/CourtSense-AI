import React, { useRef } from 'react';
import { useFrame } from '@react-three/fiber';
import { Trail } from '@react-three/drei';
import * as THREE from 'three';

interface BallProps {
  position: [number, number, number];
}

export const Ball: React.FC<BallProps> = ({ position }) => {
  const ballRef = useRef<THREE.Mesh>(null);

  useFrame((_state, delta) => {
    if (ballRef.current) {
      const target = new THREE.Vector3(...position);
      ballRef.current.position.lerp(target, Math.min(delta * 12, 1));
    }
  });

  return (
    <Trail
      width={0.4}
      length={12}
      color={'#ccff00'}
      attenuation={(t) => t * t * t}
    >
      <mesh ref={ballRef} position={position} castShadow>
        <sphereGeometry args={[0.07, 24, 24]} />
        <meshStandardMaterial
          color="#ccff00"
          emissive="#668800"
          emissiveIntensity={0.8}
          roughness={0.3}
          metalness={0.1}
        />
      </mesh>
    </Trail>
  );
};
