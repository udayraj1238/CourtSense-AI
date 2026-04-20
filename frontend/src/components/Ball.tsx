import React, { useRef, useMemo } from 'react';
import { useFrame } from '@react-three/fiber';
import * as THREE from 'three';

interface BallProps {
  position: [number, number, number];
}

export const Ball: React.FC<BallProps> = React.memo(({ position }) => {
  const ballRef = useRef<THREE.Mesh>(null);
  const glowRef = useRef<THREE.Mesh>(null);
  const prevPos = useRef(new THREE.Vector3(...position));
  const speedRef = useRef(0);

  const ballMat = useMemo(() => new THREE.MeshStandardMaterial({
    color: '#c8e600',
    emissive: '#7a9900',
    emissiveIntensity: 0.6,
    roughness: 0.35,
    metalness: 0.05,
  }), []);

  const glowMat = useMemo(() => new THREE.MeshBasicMaterial({
    color: '#c8e600',
    transparent: true,
    opacity: 0.15,
    side: THREE.BackSide,
  }), []);

  useFrame((_state, delta) => {
    if (ballRef.current) {
      const target = new THREE.Vector3(...position);
      
      // Calculate speed for glow intensity
      const dist = prevPos.current.distanceTo(target);
      speedRef.current = THREE.MathUtils.lerp(speedRef.current, dist / Math.max(delta, 0.001), 0.1);
      prevPos.current.copy(ballRef.current.position);

      // Smooth interpolation — faster lerp for responsiveness, no jitter
      const lerpFactor = Math.min(delta * 15, 1);
      ballRef.current.position.lerp(target, lerpFactor);

      // Dynamic glow based on speed
      if (glowRef.current) {
        const glowScale = 1.4 + Math.min(speedRef.current * 0.02, 1.2);
        glowRef.current.position.copy(ballRef.current.position);
        glowRef.current.scale.setScalar(glowScale);
        (glowRef.current.material as THREE.MeshBasicMaterial).opacity = 
          0.08 + Math.min(speedRef.current * 0.005, 0.25);
      }

      // Update emissive intensity based on speed
      ballMat.emissiveIntensity = 0.6 + Math.min(speedRef.current * 0.03, 1.5);
    }
  });

  return (
    <group>
      {/* Glow aura */}
      <mesh ref={glowRef} position={position}>
        <sphereGeometry args={[0.07, 16, 16]} />
        <primitive object={glowMat} attach="material" />
      </mesh>

      {/* Tennis ball */}
      <mesh ref={ballRef} position={position} castShadow>
        <sphereGeometry args={[0.07, 20, 20]} />
        <primitive object={ballMat} attach="material" />
      </mesh>

      {/* Ball shadow on ground */}
      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[position[0], 0.005, position[2]]}>
        <circleGeometry args={[0.08, 16]} />
        <meshBasicMaterial color="#000000" transparent opacity={0.2} />
      </mesh>
    </group>
  );
});

Ball.displayName = 'Ball';
