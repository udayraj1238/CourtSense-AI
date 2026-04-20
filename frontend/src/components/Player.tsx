import React, { useRef, useMemo } from 'react';
import { useFrame } from '@react-three/fiber';
import { Html } from '@react-three/drei';
import * as THREE from 'three';

interface PlayerProps {
  position: [number, number, number];
  color?: string;
  accentColor?: string;
  side?: 'top' | 'bottom';
  label?: string;
}

export const Player: React.FC<PlayerProps> = React.memo(({
  position,
  color = "#3b82f6",
  accentColor = "#1e3a5f",
  side = 'bottom',
  label,
}) => {
  const groupRef = useRef<THREE.Group>(null);

  // Create materials once
  const shirtMat = useMemo(() => new THREE.MeshStandardMaterial({
    color,
    roughness: 0.35,
    metalness: 0.05,
  }), [color]);

  const shortsMat = useMemo(() => new THREE.MeshStandardMaterial({
    color: accentColor,
    roughness: 0.5,
  }), [accentColor]);

  const skinMat = useMemo(() => new THREE.MeshStandardMaterial({
    color: '#e8c4a0',
    roughness: 0.6,
  }), []);

  const shoeMat = useMemo(() => new THREE.MeshStandardMaterial({
    color: '#ffffff',
    roughness: 0.4,
  }), []);

  const racquetHandleMat = useMemo(() => new THREE.MeshStandardMaterial({
    color: '#2a2a2a',
    roughness: 0.3,
    metalness: 0.4,
  }), []);

  const racquetShaftMat = useMemo(() => new THREE.MeshStandardMaterial({
    color: '#888888',
    roughness: 0.2,
    metalness: 0.7,
  }), []);

  const racquetHeadMat = useMemo(() => new THREE.MeshStandardMaterial({
    color: '#cccccc',
    roughness: 0.3,
    metalness: 0.6,
  }), []);

  const stringsMat = useMemo(() => new THREE.MeshStandardMaterial({
    color: '#ffffff',
    transparent: true,
    opacity: 0.4,
    roughness: 0.2,
  }), []);

  useFrame((_state, delta) => {
    if (groupRef.current) {
      const target = new THREE.Vector3(position[0], 0, position[2]);
      // Smooth, lag-free lerp
      const lerpFactor = Math.min(delta * 8, 1);
      groupRef.current.position.lerp(target, lerpFactor);
    }
  });

  // Top player faces toward -Z (toward camera), bottom player faces +Z
  const facingRotation = side === 'top' ? Math.PI : 0;

  return (
    <group ref={groupRef} position={[position[0], 0, position[2]]}>
      {/* Floating label */}
      {label && (
        <Html
          position={[0, 2.0, 0]}
          center
          distanceFactor={15}
          style={{
            pointerEvents: 'none',
            userSelect: 'none',
          }}
        >
          <div style={{
            background: 'rgba(0,0,0,0.6)',
            backdropFilter: 'blur(8px)',
            color: color,
            padding: '3px 10px',
            borderRadius: '8px',
            fontSize: '11px',
            fontWeight: 700,
            fontFamily: "'Inter', sans-serif",
            letterSpacing: '0.05em',
            whiteSpace: 'nowrap',
            border: `1px solid ${color}33`,
          }}>
            {label}
          </div>
        </Html>
      )}

      {/* Rotate entire body to face the correct direction */}
      <group rotation={[0, facingRotation, 0]}>

        {/* Shadow disc */}
        <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, 0.01, 0]}>
          <circleGeometry args={[0.45, 32]} />
          <meshBasicMaterial color="#000000" transparent opacity={0.2} />
        </mesh>

        {/* === LEGS === */}
        <mesh position={[-0.1, 0.4, 0]} castShadow>
          <capsuleGeometry args={[0.055, 0.6, 4, 8]} />
          <primitive object={shortsMat} attach="material" />
        </mesh>
        <mesh position={[0.1, 0.4, 0]} castShadow>
          <capsuleGeometry args={[0.055, 0.6, 4, 8]} />
          <primitive object={shortsMat} attach="material" />
        </mesh>

        {/* Shoes */}
        <mesh position={[-0.1, 0.06, 0.04]}>
          <boxGeometry args={[0.1, 0.06, 0.16]} />
          <primitive object={shoeMat} attach="material" />
        </mesh>
        <mesh position={[0.1, 0.06, 0.04]}>
          <boxGeometry args={[0.1, 0.06, 0.16]} />
          <primitive object={shoeMat} attach="material" />
        </mesh>

        {/* === TORSO === */}
        <mesh position={[0, 1.0, 0]} castShadow>
          <capsuleGeometry args={[0.17, 0.48, 4, 12]} />
          <primitive object={shirtMat} attach="material" />
        </mesh>

        {/* Collar / shoulder area */}
        <mesh position={[0, 1.28, 0]} castShadow>
          <cylinderGeometry args={[0.23, 0.17, 0.08, 12]} />
          <primitive object={shirtMat} attach="material" />
        </mesh>

        {/* === ARMS === */}
        {/* Left arm (non-racquet arm) */}
        <group position={[-0.27, 1.15, 0]}>
          <mesh position={[0, -0.12, 0]} rotation={[0, 0, 0.12]} castShadow>
            <capsuleGeometry args={[0.04, 0.22, 4, 8]} />
            <primitive object={shirtMat} attach="material" />
          </mesh>
          <mesh position={[0.02, -0.32, 0.02]} rotation={[0.2, 0, 0.08]}>
            <capsuleGeometry args={[0.035, 0.2, 4, 8]} />
            <primitive object={skinMat} attach="material" />
          </mesh>
        </group>

        {/* Right arm (racquet arm) */}
        <group position={[0.27, 1.15, 0]}>
          <mesh position={[0.04, -0.1, 0]} rotation={[0, 0, -0.3]} castShadow>
            <capsuleGeometry args={[0.04, 0.22, 4, 8]} />
            <primitive object={shirtMat} attach="material" />
          </mesh>
          <mesh position={[0.12, -0.28, 0.04]} rotation={[-0.3, 0, -0.5]}>
            <capsuleGeometry args={[0.035, 0.2, 4, 8]} />
            <primitive object={skinMat} attach="material" />
          </mesh>

          {/* === RACQUET === */}
          <group position={[0.22, -0.42, 0.08]} rotation={[-0.4, 0.2, -0.6]}>
            <mesh material={racquetHandleMat}>
              <cylinderGeometry args={[0.015, 0.018, 0.28, 6]} />
            </mesh>
            <mesh position={[0, 0.2, 0]} material={racquetShaftMat}>
              <cylinderGeometry args={[0.012, 0.015, 0.14, 6]} />
            </mesh>
            <mesh position={[0, 0.38, 0]} rotation={[0.1, 0, 0]} material={racquetHeadMat}>
              <cylinderGeometry args={[0.12, 0.12, 0.015, 16]} />
            </mesh>
            <mesh position={[0, 0.38, 0]} rotation={[0.1, 0, 0]} material={stringsMat}>
              <cylinderGeometry args={[0.1, 0.1, 0.008, 16]} />
            </mesh>
          </group>
        </group>

        {/* === HEAD === */}
        <mesh position={[0, 1.35, 0]}>
          <cylinderGeometry args={[0.05, 0.05, 0.08, 8]} />
          <primitive object={skinMat} attach="material" />
        </mesh>
        <mesh position={[0, 1.5, 0]} castShadow>
          <sphereGeometry args={[0.12, 16, 16]} />
          <meshStandardMaterial color="#f0d0b0" roughness={0.5} />
        </mesh>
        {/* Hair/cap */}
        <mesh position={[0, 1.56, 0]}>
          <sphereGeometry args={[0.1, 12, 8, 0, Math.PI * 2, 0, Math.PI * 0.5]} />
          <primitive object={shirtMat} attach="material" />
        </mesh>

      </group>

      {/* Color ring indicator (outside rotation group so it stays flat) */}
      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, 0.02, 0]}>
        <ringGeometry args={[0.35, 0.42, 32]} />
        <meshBasicMaterial color={color} transparent opacity={0.4} />
      </mesh>
    </group>
  );
});

Player.displayName = 'Player';
