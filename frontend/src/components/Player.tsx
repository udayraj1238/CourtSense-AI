import React, { useRef } from 'react';
import { useFrame } from '@react-three/fiber';
import * as THREE from 'three';

interface PlayerProps {
  position: [number, number, number];
  color?: string;
  accentColor?: string;
}

export const Player: React.FC<PlayerProps> = ({
  position,
  color = "#3b82f6",
  accentColor = "#1d4ed8",
}) => {
  const groupRef = useRef<THREE.Group>(null);

  useFrame((_state, delta) => {
    if (groupRef.current) {
      const target = new THREE.Vector3(position[0], 0, position[2]);
      // Gentle lerp — absorbs remaining jitter from data
      groupRef.current.position.lerp(target, Math.min(delta * 5, 1));
    }
  });

  return (
    <group ref={groupRef} position={[position[0], 0, position[2]]}>
      {/* Shadow disc on ground */}
      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, 0.01, 0]}>
        <circleGeometry args={[0.45, 32]} />
        <meshBasicMaterial color="#000000" transparent opacity={0.3} />
      </mesh>

      {/* --- Humanoid Body --- */}

      {/* Legs */}
      <mesh position={[-0.12, 0.38, 0]} castShadow>
        <cylinderGeometry args={[0.06, 0.07, 0.76, 8]} />
        <meshStandardMaterial color={accentColor} roughness={0.6} />
      </mesh>
      <mesh position={[0.12, 0.38, 0]} castShadow>
        <cylinderGeometry args={[0.06, 0.07, 0.76, 8]} />
        <meshStandardMaterial color={accentColor} roughness={0.6} />
      </mesh>

      {/* Torso */}
      <mesh position={[0, 1.0, 0]} castShadow>
        <cylinderGeometry args={[0.18, 0.22, 0.6, 12]} />
        <meshStandardMaterial color={color} roughness={0.4} metalness={0.1} />
      </mesh>

      {/* Shoulders */}
      <mesh position={[0, 1.28, 0]} castShadow>
        <cylinderGeometry args={[0.26, 0.18, 0.1, 12]} />
        <meshStandardMaterial color={color} roughness={0.4} metalness={0.1} />
      </mesh>

      {/* Arms */}
      <mesh position={[-0.32, 0.95, 0]} rotation={[0, 0, 0.15]} castShadow>
        <cylinderGeometry args={[0.045, 0.05, 0.55, 8]} />
        <meshStandardMaterial color={color} roughness={0.5} />
      </mesh>
      <mesh position={[0.32, 0.95, 0]} rotation={[0, 0, -0.15]} castShadow>
        <cylinderGeometry args={[0.045, 0.05, 0.55, 8]} />
        <meshStandardMaterial color={color} roughness={0.5} />
      </mesh>

      {/* Neck */}
      <mesh position={[0, 1.38, 0]}>
        <cylinderGeometry args={[0.06, 0.06, 0.1, 8]} />
        <meshStandardMaterial color="#e8c4a0" roughness={0.7} />
      </mesh>

      {/* Head */}
      <mesh position={[0, 1.52, 0]} castShadow>
        <sphereGeometry args={[0.12, 16, 16]} />
        <meshStandardMaterial color="#f0d0b0" roughness={0.6} />
      </mesh>

      {/* Name indicator — flat ring around feet */}
      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, 0.02, 0]}>
        <ringGeometry args={[0.35, 0.42, 32]} />
        <meshBasicMaterial color={color} transparent opacity={0.6} />
      </mesh>
    </group>
  );
};
