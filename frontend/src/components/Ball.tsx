import React, { useRef, useMemo } from 'react';
import { useFrame } from '@react-three/fiber';
import * as THREE from 'three';

interface BallProps {
  position: [number, number, number];
  isOccluded?: boolean;
}

export const Ball: React.FC<BallProps> = React.memo(({ position, isOccluded = false }) => {
  const ballRef  = useRef<THREE.Mesh>(null);
  const glowRef  = useRef<THREE.Mesh>(null);
  const lightRef = useRef<THREE.PointLight>(null);

  // Reusable vector — never allocate inside useFrame
  const targetVec = useRef(new THREE.Vector3(...position));
  const speedRef  = useRef(0);

  const ballMat = useMemo(() => new THREE.MeshStandardMaterial({
    color: '#c8e600',
    emissive: '#7a9900',
    emissiveIntensity: 0.7,
    roughness: 0.3,
    metalness: 0.05,
  }), []);

  const glowMat = useMemo(() => new THREE.MeshBasicMaterial({
    color: '#c8e600',
    transparent: true,
    opacity: 0.15,
    side: THREE.BackSide,
  }), []);

  useFrame((_state, delta) => {
    const ball = ballRef.current;
    if (!ball) return;

    // Update target from props
    targetVec.current.set(position[0], position[1], position[2]);

    // ── FIX: snap directly to position instead of lerping ──────────────
    // The playback loop already advances one data-frame per render frame,
    // so lerping only LAGS behind the data. Set position directly.
    ball.position.copy(targetVec.current);
    // ────────────────────────────────────────────────────────────────────

    // Speed estimate (for visuals only)
    speedRef.current = Math.min(speedRef.current * 0.85 + (1 / Math.max(delta, 0.001)) * 0.001, 1);
    const speedNorm = speedRef.current;

    // Visual spin
    ball.rotation.x += delta * 6.5;
    ball.rotation.z += delta * 3.2;

    // Glow scales with speed
    if (glowRef.current) {
      const gs = 1.4 + speedNorm * 1.6;
      glowRef.current.position.copy(ball.position);
      glowRef.current.scale.setScalar(gs);
      (glowRef.current.material as THREE.MeshBasicMaterial).opacity = 0.08 + speedNorm * 0.22;
    }

    // Emissive: yellow → orange at high speed
    ballMat.emissiveIntensity = 0.6 + speedNorm * 1.8;
    ballMat.emissive.setRGB(0.45 + speedNorm * 0.55, 0.60 - speedNorm * 0.4, 0.0);

    // Dynamic point light follows ball
    if (lightRef.current) {
      lightRef.current.position.copy(ball.position);
      lightRef.current.intensity = 0.4 + speedNorm * 1.2;
    }
  });

  return (
    <group>
      <pointLight ref={lightRef} color="#ffe060" distance={9} decay={2} />

      <mesh ref={glowRef} position={position}>
        <sphereGeometry args={[0.07, 10, 10]} />
        <primitive object={glowMat} attach="material" />
      </mesh>

      <mesh ref={ballRef} position={position} castShadow>
        <sphereGeometry args={[0.065, 20, 20]} />
        <primitive object={ballMat} attach="material" />
      </mesh>
    </group>
  );
});

Ball.displayName = 'Ball';
