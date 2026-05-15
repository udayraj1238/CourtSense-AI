import React, { Suspense, useRef, useEffect } from 'react';
import { Canvas, useThree, useFrame } from '@react-three/fiber';
import { OrbitControls, Stars, ContactShadows } from '@react-three/drei';
import { Court } from './Court';
import { Stadium } from './Stadium';
import { Ball } from './Ball';
import { BallTrail } from './BallTrail';
import { Player } from './Player';
import { Effects } from './Effects';
import * as THREE from 'three';

interface TennisSceneProps {
  ballPos: [number, number, number];
  player1Pos: [number, number, number];
  player2Pos: [number, number, number];
  ballTrail?: [number, number, number][];
  cameraPreset?: 'default' | 'overhead' | 'p1' | 'p2';
  p1Hitting?: boolean;
  p2Hitting?: boolean;
}

const CAMERA_TARGETS: Record<string, [number, number, number]> = {
  default:  [0, 14, 22],
  overhead: [0, 32, 0.1],
  p1:       [0, 5, 20],
  p2:       [0, 5, -20],
};

/** Smooth camera lerp between presets */
function CameraController({ preset }: { preset: string }) {
  const { camera } = useThree();
  const targetPos = useRef(new THREE.Vector3(...CAMERA_TARGETS[preset] ?? CAMERA_TARGETS.default));

  useEffect(() => {
    const t = CAMERA_TARGETS[preset] ?? CAMERA_TARGETS.default;
    targetPos.current.set(...t);
  }, [preset]);

  useFrame((_state, delta) => {
    camera.position.lerp(targetPos.current, Math.min(delta * 3.5, 1));
    camera.lookAt(0, 0, 0);
  });

  return null;
}

export const TennisScene: React.FC<TennisSceneProps> = React.memo(({
  ballPos,
  player1Pos,
  player2Pos,
  ballTrail = [],
  cameraPreset = 'default',
  p1Hitting = false,
  p2Hitting = false,
}) => {
  const initPos = CAMERA_TARGETS[cameraPreset] ?? CAMERA_TARGETS.default;

  return (
    <Canvas
      shadows
      camera={{ position: initPos, fov: 36 }}
      gl={{
        antialias: true,
        alpha: false,
        powerPreference: 'high-performance',
        stencil: false,
        depth: true,
      }}
      dpr={[1, 1.5]}
      performance={{ min: 0.5 }}
    >
      <color attach="background" args={['#040804']} />
      <fog attach="fog" args={['#0a1a08', 32, 68]} />

      <Suspense fallback={null}>
        {/* === Lighting Rig === */}
        <ambientLight intensity={0.28} color="#d8f0d0" />

        {/* Main key light */}
        <directionalLight
          position={[12, 30, 12]}
          intensity={2.4}
          castShadow
          shadow-mapSize-width={2048}
          shadow-mapSize-height={2048}
          shadow-camera-far={75}
          shadow-camera-left={-26}
          shadow-camera-right={26}
          shadow-camera-top={26}
          shadow-camera-bottom={-26}
          shadow-bias={-0.0003}
          color="#fff5e0"
        />

        {/* Cool fill from opposite side */}
        <directionalLight position={[-10, 20, -10]} intensity={0.55} color="#a0c4ff" />

        {/* Warm rim / back */}
        <directionalLight position={[0, 8, -22]} intensity={0.35} color="#ffc870" />

        {/* Court center warm spot */}
        <pointLight position={[0, 16, 0]} intensity={0.6} color="#ffe4b0" distance={48} decay={2} />

        {/* Stars */}
        <Stars radius={90} depth={70} count={2000} factor={3.5} saturation={0.15} fade speed={0.2} />

        {/* === 3D Elements === */}
        <Court />
        <Stadium />

        {/* Contact shadows under players */}
        <ContactShadows
          position={[0, 0.01, 0]}
          opacity={0.55}
          scale={40}
          blur={2.5}
          far={1.5}
          color="#000000"
        />

        {/* Ball Trail */}
        {ballTrail.length > 1 && <BallTrail positions={ballTrail} />}

        {/* Ball */}
        <Ball position={ballPos} />

        {/* Players */}
        <Player position={player1Pos} color="#4f9aff" accentColor="#1e3a6e" side="bottom" label="Player 1" isHitting={p1Hitting} />
        <Player position={player2Pos} color="#ff5a6e" accentColor="#7f1d2e" side="top"    label="Player 2" isHitting={p2Hitting} />

        {/* Post-processing */}
        <Effects />

        {/* Smooth camera */}
        <CameraController preset={cameraPreset} />

        {/* Orbit controls */}
        <OrbitControls
          enablePan={true}
          enableZoom={true}
          enableRotate={true}
          maxPolarAngle={Math.PI / 2 - 0.04}
          minDistance={5}
          maxDistance={55}
          target={[0, 0, 0]}
          enableDamping={true}
          dampingFactor={0.07}
          rotateSpeed={0.55}
          zoomSpeed={0.75}
        />
      </Suspense>
    </Canvas>
  );
});

TennisScene.displayName = 'TennisScene';
