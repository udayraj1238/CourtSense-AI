import React, { useRef, useMemo } from 'react';
import { useFrame } from '@react-three/fiber';
import * as THREE from 'three';

interface BallProps {
  position: [number, number, number];
  isOccluded?: boolean;
}

export const Ball: React.FC<BallProps> = React.memo(({ position, isOccluded = false }) => {
  const ballRef = useRef<THREE.Mesh>(null);
  const glowRef = useRef<THREE.Mesh>(null);
  const lightRef = useRef<THREE.PointLight>(null);

  // Reusable vectors — never allocate inside useFrame
  const targetVec = useRef(new THREE.Vector3());
  const speedRef = useRef(0);

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

    // No allocations — reuse targetVec
    targetVec.current.set(position[0], position[1], position[2]);

    const dist = ball.position.distanceTo(targetVec.current);
    speedRef.current = speedRef.current * 0.88 + (dist / Math.max(delta, 0.001)) * 0.12;

    // Lerp toward target — fast enough to track data, smooth enough to not pop
    // Slower follow when occluded (predicted) to avoid sharp snap if backend prediction is slightly off
    const lerpFactor = Math.min(delta * (isOccluded ? 12 : 18), 1);
    ball.position.lerp(targetVec.current, lerpFactor);

    // Visual spin proportional to speed
    const spd = speedRef.current;
    ball.rotation.x += delta * clampSpin(spd * 0.3);
    ball.rotation.z += delta * clampSpin(spd * 0.15);

    const speedNorm = Math.min(spd * 0.015, 1);

    if (glowRef.current) {
      const gs = 1.4 + speedNorm * 1.6;
      glowRef.current.position.copy(ball.position);
      glowRef.current.scale.setScalar(gs);
      (glowRef.current.material as THREE.MeshBasicMaterial).opacity = 0.05 + speedNorm * 0.25;
    }

    // Emissive shifts yellow → orange at high speed
    ballMat.emissiveIntensity = 0.6 + speedNorm * 2.0;
    ballMat.emissive.setRGB(0.45 + speedNorm * 0.55, 0.60 - speedNorm * 0.45, 0.0);

    if (lightRef.current) {
      lightRef.current.position.copy(ball.position);
      lightRef.current.intensity = 0.3 + speedNorm * 1.4;
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

function clampSpin(v: number) {
  return Math.min(Math.max(v, 0), 12);
}
