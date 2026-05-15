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
  isHitting?: boolean;   // trigger arm-swing animation
}

export const Player: React.FC<PlayerProps> = React.memo(({
  position,
  color = "#3b82f6",
  accentColor = "#1e3a5f",
  side = 'bottom',
  label,
  isHitting = false,
}) => {
  const groupRef  = useRef<THREE.Group>(null);
  const torsoRef  = useRef<THREE.Group>(null);
  const rArmRef   = useRef<THREE.Group>(null);   // right arm + racquet
  const lArmRef   = useRef<THREE.Group>(null);   // left arm (counter-balance)
  const targetVec = useRef(new THREE.Vector3());

  // Swing progress: 0 = resting, 1 = full swing
  const swingT    = useRef(0);
  const isHittingRef = useRef(false);

  const shirtMat = useMemo(() => new THREE.MeshStandardMaterial({
    color, roughness: 0.35, metalness: 0.05,
  }), [color]);
  const shortsMat = useMemo(() => new THREE.MeshStandardMaterial({
    color: accentColor, roughness: 0.5,
  }), [accentColor]);
  const skinMat = useMemo(() => new THREE.MeshStandardMaterial({
    color: '#e8c4a0', roughness: 0.6,
  }), []);
  const shoeMat = useMemo(() => new THREE.MeshStandardMaterial({
    color: '#ffffff', roughness: 0.4,
  }), []);
  const racquetHandleMat = useMemo(() => new THREE.MeshStandardMaterial({
    color: '#2a2a2a', roughness: 0.3, metalness: 0.4,
  }), []);
  const racquetShaftMat = useMemo(() => new THREE.MeshStandardMaterial({
    color: '#888888', roughness: 0.2, metalness: 0.7,
  }), []);
  const racquetHeadMat = useMemo(() => new THREE.MeshStandardMaterial({
    color: '#cccccc', roughness: 0.3, metalness: 0.6,
  }), []);
  const stringsMat = useMemo(() => new THREE.MeshStandardMaterial({
    color: '#ffffff', transparent: true, opacity: 0.4, roughness: 0.2,
  }), []);

  useFrame((state, delta) => {
    // ── Position lerp (zero-alloc) ────────────────────────────────────
    if (groupRef.current) {
      targetVec.current.set(position[0], 0, position[2]);
      groupRef.current.position.lerp(targetVec.current, Math.min(delta * 10, 1));
    }

    // ── Idle breathing ────────────────────────────────────────────────
    if (torsoRef.current) {
      const t = state.clock.elapsedTime;
      torsoRef.current.position.y  = Math.sin(t * 1.4) * 0.008;
      torsoRef.current.rotation.z  = Math.sin(t * 0.9) * 0.012;
    }

    // ── Hitting swing ─────────────────────────────────────────────────
    // Trigger: latch on each new isHitting=true pulse
    if (isHitting && !isHittingRef.current) {
      swingT.current = 0;
      isHittingRef.current = true;
    }
    if (!isHitting) isHittingRef.current = false;

    if (swingT.current < 1) {
      swingT.current = Math.min(swingT.current + delta * 5.5, 1);  // ~180ms swing
    }
    const sw = swingT.current;

    // Swing curve: fast forward (0→0.35) then recover (0.35→1)
    const swingAngle = sw < 0.35
      ? (sw / 0.35) * -1.7         // backswing → contact (forward sweep)
      : -1.7 + ((sw - 0.35) / 0.65) * 1.7; // recover to rest

    if (rArmRef.current) {
      rArmRef.current.rotation.x = swingAngle;
      rArmRef.current.rotation.z = swingAngle * 0.3;
    }
    // Left arm counter-balances
    if (lArmRef.current) {
      lArmRef.current.rotation.x = -swingAngle * 0.4;
    }
  });

  const facingRotation = side === 'top' ? Math.PI : 0;

  return (
    <group ref={groupRef} position={[position[0], 0, position[2]]}>
      {/* Floating label */}
      {label && (
        <Html position={[0, 2.1, 0]} center distanceFactor={15}
          style={{ pointerEvents: 'none', userSelect: 'none' }}>
          <div style={{
            background: 'rgba(4, 8, 4, 0.75)',
            backdropFilter: 'blur(12px)',
            WebkitBackdropFilter: 'blur(12px)',
            color,
            padding: '4px 12px',
            borderRadius: '10px',
            fontSize: '10px',
            fontWeight: 800,
            fontFamily: "'Inter', sans-serif",
            letterSpacing: '0.08em',
            textTransform: 'uppercase',
            whiteSpace: 'nowrap',
            border: `1px solid ${color}44`,
            boxShadow: `0 0 12px ${color}22`,
          }}>
            {label}
          </div>
        </Html>
      )}

      {/* Breathing wrapper */}
      <group ref={torsoRef}>
        {/* Body direction */}
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
          <mesh position={[0, 1.28, 0]} castShadow>
            <cylinderGeometry args={[0.23, 0.17, 0.08, 12]} />
            <primitive object={shirtMat} attach="material" />
          </mesh>

          {/* === LEFT ARM (counter-balance, no racquet) === */}
          <group ref={lArmRef} position={[-0.27, 1.15, 0]}>
            <mesh position={[0, -0.12, 0]} rotation={[0, 0, 0.12]} castShadow>
              <capsuleGeometry args={[0.04, 0.22, 4, 8]} />
              <primitive object={shirtMat} attach="material" />
            </mesh>
            <mesh position={[0.02, -0.32, 0.02]} rotation={[0.2, 0, 0.08]}>
              <capsuleGeometry args={[0.035, 0.2, 4, 8]} />
              <primitive object={skinMat} attach="material" />
            </mesh>
          </group>

          {/* === RIGHT ARM (racquet arm — animated) === */}
          <group ref={rArmRef} position={[0.27, 1.15, 0]}>
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
          {/* Cap */}
          <mesh position={[0, 1.56, 0]}>
            <sphereGeometry args={[0.1, 12, 8, 0, Math.PI * 2, 0, Math.PI * 0.5]} />
            <primitive object={shirtMat} attach="material" />
          </mesh>

        </group>
      </group>{/* end torsoRef */}

      {/* Color ring */}
      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, 0.02, 0]}>
        <ringGeometry args={[0.35, 0.42, 32]} />
        <meshBasicMaterial color={color} transparent opacity={0.4} />
      </mesh>
    </group>
  );
});

Player.displayName = 'Player';
