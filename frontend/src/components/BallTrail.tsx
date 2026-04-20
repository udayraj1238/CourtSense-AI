import React, { useMemo } from 'react';
import * as THREE from 'three';

interface BallTrailProps {
  /** Array of recent ball positions (newest last) */
  positions: [number, number, number][];
}

/**
 * Renders fading dots showing the ball's recent trajectory.
 * Creates a "comet tail" effect for visual clarity.
 */
export const BallTrail: React.FC<BallTrailProps> = React.memo(({ positions }) => {
  const dotGeometry = useMemo(() => new THREE.SphereGeometry(0.03, 8, 8), []);

  return (
    <group>
      {positions.map((pos, i) => {
        const t = i / Math.max(positions.length - 1, 1); // 0 = oldest, 1 = newest
        const opacity = t * 0.5; // fade from transparent to semi-visible
        const scale = 0.3 + t * 0.7; // grow from small to full

        return (
          <mesh
            key={i}
            position={pos}
            geometry={dotGeometry}
            scale={[scale, scale, scale]}
          >
            <meshBasicMaterial
              color="#a3e635"
              transparent
              opacity={opacity}
              depthWrite={false}
            />
          </mesh>
        );
      })}
    </group>
  );
});

BallTrail.displayName = 'BallTrail';
