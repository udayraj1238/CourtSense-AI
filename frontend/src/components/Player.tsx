import { useRef } from 'react';
import { useFrame } from '@react-three/fiber';
import * as THREE from 'three';

interface PlayerProps {
  position: [number, number, number];
  color?: string;
  accentColor?: string;
  side?: 'top' | 'bottom';
}

export const Player: React.FC<PlayerProps> = ({
  position,
  color = "#3b82f6",
  accentColor = "#1e3a5f",
  side = 'bottom',
}) => {
  const groupRef = useRef<THREE.Group>(null);

  useFrame((_state, delta) => {
    if (groupRef.current) {
      const target = new THREE.Vector3(position[0], 0, position[2]);
      groupRef.current.position.lerp(target, Math.min(delta * 6, 1));
    }
  });

  // Top player faces toward -Z (toward camera), bottom player faces +Z (toward net/far side)
  const facingRotation = side === 'top' ? Math.PI : 0;

  return (
    <group ref={groupRef} position={[position[0], 0, position[2]]}>
      {/* Rotate entire body to face the correct direction */}
      <group rotation={[0, facingRotation, 0]}>

        {/* Shadow disc */}
        <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, 0.01, 0]}>
          <circleGeometry args={[0.4, 32]} />
          <meshBasicMaterial color="#000000" transparent opacity={0.25} />
        </mesh>

        {/* === LEGS === */}
        {/* Left leg */}
        <mesh position={[-0.1, 0.38, 0]} castShadow>
          <capsuleGeometry args={[0.055, 0.55, 4, 8]} />
          <meshStandardMaterial color={accentColor} roughness={0.5} />
        </mesh>
        {/* Right leg */}
        <mesh position={[0.1, 0.38, 0]} castShadow>
          <capsuleGeometry args={[0.055, 0.55, 4, 8]} />
          <meshStandardMaterial color={accentColor} roughness={0.5} />
        </mesh>

        {/* Shoes */}
        <mesh position={[-0.1, 0.06, 0.04]}>
          <boxGeometry args={[0.1, 0.06, 0.16]} />
          <meshStandardMaterial color="#ffffff" roughness={0.4} />
        </mesh>
        <mesh position={[0.1, 0.06, 0.04]}>
          <boxGeometry args={[0.1, 0.06, 0.16]} />
          <meshStandardMaterial color="#ffffff" roughness={0.4} />
        </mesh>

        {/* === TORSO === */}
        <mesh position={[0, 0.95, 0]} castShadow>
          <capsuleGeometry args={[0.16, 0.45, 4, 12]} />
          <meshStandardMaterial color={color} roughness={0.35} metalness={0.05} />
        </mesh>

        {/* Collar / shoulder area */}
        <mesh position={[0, 1.22, 0]} castShadow>
          <cylinderGeometry args={[0.22, 0.16, 0.08, 12]} />
          <meshStandardMaterial color={color} roughness={0.35} />
        </mesh>

        {/* === ARMS === */}
        {/* Left arm (non-racquet arm) */}
        <group position={[-0.26, 1.1, 0]}>
          {/* Upper arm */}
          <mesh position={[0, -0.12, 0]} rotation={[0, 0, 0.12]} castShadow>
            <capsuleGeometry args={[0.04, 0.22, 4, 8]} />
            <meshStandardMaterial color={color} roughness={0.5} />
          </mesh>
          {/* Forearm */}
          <mesh position={[0.02, -0.32, 0.02]} rotation={[0.2, 0, 0.08]}>
            <capsuleGeometry args={[0.035, 0.2, 4, 8]} />
            <meshStandardMaterial color="#e8c4a0" roughness={0.6} />
          </mesh>
        </group>

        {/* Right arm (racquet arm) — extended to the side */}
        <group position={[0.26, 1.1, 0]}>
          {/* Upper arm */}
          <mesh position={[0.04, -0.1, 0]} rotation={[0, 0, -0.3]} castShadow>
            <capsuleGeometry args={[0.04, 0.22, 4, 8]} />
            <meshStandardMaterial color={color} roughness={0.5} />
          </mesh>
          {/* Forearm */}
          <mesh position={[0.12, -0.28, 0.04]} rotation={[-0.3, 0, -0.5]}>
            <capsuleGeometry args={[0.035, 0.2, 4, 8]} />
            <meshStandardMaterial color="#e8c4a0" roughness={0.6} />
          </mesh>

          {/* === RACQUET === */}
          <group position={[0.22, -0.42, 0.08]} rotation={[-0.4, 0.2, -0.6]}>
            {/* Handle (grip) */}
            <mesh>
              <cylinderGeometry args={[0.015, 0.018, 0.28, 6]} />
              <meshStandardMaterial color="#2a2a2a" roughness={0.3} metalness={0.4} />
            </mesh>
            {/* Shaft */}
            <mesh position={[0, 0.2, 0]}>
              <cylinderGeometry args={[0.012, 0.015, 0.14, 6]} />
              <meshStandardMaterial color="#888888" roughness={0.2} metalness={0.7} />
            </mesh>
            {/* Racquet head (flat oval) */}
            <mesh position={[0, 0.38, 0]} rotation={[0.1, 0, 0]}>
              <cylinderGeometry args={[0.12, 0.12, 0.015, 16]} />
              <meshStandardMaterial color="#cccccc" roughness={0.3} metalness={0.6} />
            </mesh>
            {/* Racquet strings (slightly smaller disc inside) */}
            <mesh position={[0, 0.38, 0]} rotation={[0.1, 0, 0]}>
              <cylinderGeometry args={[0.1, 0.1, 0.008, 16]} />
              <meshStandardMaterial
                color="#ffffff"
                transparent
                opacity={0.4}
                roughness={0.2}
              />
            </mesh>
          </group>
        </group>

        {/* === HEAD === */}
        {/* Neck */}
        <mesh position={[0, 1.3, 0]}>
          <cylinderGeometry args={[0.05, 0.05, 0.08, 8]} />
          <meshStandardMaterial color="#e8c4a0" roughness={0.6} />
        </mesh>
        {/* Head */}
        <mesh position={[0, 1.44, 0]} castShadow>
          <sphereGeometry args={[0.11, 16, 16]} />
          <meshStandardMaterial color="#f0d0b0" roughness={0.5} />
        </mesh>
        {/* Hair/cap */}
        <mesh position={[0, 1.5, 0]}>
          <sphereGeometry args={[0.1, 12, 8, 0, Math.PI * 2, 0, Math.PI * 0.5]} />
          <meshStandardMaterial color={color} roughness={0.6} />
        </mesh>

      </group>

      {/* Color ring indicator (outside rotation group so it stays flat) */}
      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, 0.02, 0]}>
        <ringGeometry args={[0.32, 0.38, 32]} />
        <meshBasicMaterial color={color} transparent opacity={0.5} />
      </mesh>
    </group>
  );
};
