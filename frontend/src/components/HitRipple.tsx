import React, { useRef, useState, useEffect } from 'react';
import { useFrame } from '@react-three/fiber';
import * as THREE from 'three';

interface HitRippleProps {
  isHitting: boolean;
  position: [number, number, number];
  color?: string;
}

export const HitRipple: React.FC<HitRippleProps> = React.memo(({ isHitting, position, color = '#ffeb3b' }) => {
  const [activeRipples, setActiveRipples] = useState<{ id: number, pos: [number, number, number], time: number }[]>([]);
  const rippleIdRef = useRef(0);
  const wasHittingRef = useRef(false);

  useEffect(() => {
    if (isHitting && !wasHittingRef.current) {
      // Trigger new ripple at ground level, under the ball position
      setActiveRipples(prev => [
        ...prev,
        { id: rippleIdRef.current++, pos: [position[0], 0.02, position[2]], time: 0 }
      ]);
    }
    wasHittingRef.current = isHitting;
  }, [isHitting, position]);

  useFrame((_, delta) => {
    setActiveRipples(prev => {
      let changed = false;
      const next = prev.map(r => {
        if (r.time < 1.0) changed = true;
        return { ...r, time: r.time + delta * 1.8 }; // ~550ms duration
      }).filter(r => r.time < 1.0);
      
      return changed || next.length !== prev.length ? next : prev;
    });
  });

  return (
    <group>
      {activeRipples.map(r => {
        const scale = 0.1 + r.time * 2.2; // expand radius
        const opacity = Math.max(0, 1.0 - Math.pow(r.time, 1.5)); // smooth fade
        
        return (
          <mesh key={r.id} position={r.pos} rotation={[-Math.PI / 2, 0, 0]} scale={scale}>
            <ringGeometry args={[0.85, 1.0, 32]} />
            <meshBasicMaterial color={color} transparent opacity={opacity * 0.8} side={THREE.DoubleSide} />
          </mesh>
        );
      })}
    </group>
  );
});

HitRipple.displayName = 'HitRipple';
