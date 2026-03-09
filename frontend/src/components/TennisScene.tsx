import React, { Suspense } from 'react';
import { Canvas } from '@react-three/fiber';
import { OrbitControls, Sky } from '@react-three/drei';
import { Court } from './Court';
import { Ball } from './Ball';
import { Player } from './Player';

interface TennisSceneProps {
  ballPos: [number, number, number];
  player1Pos: [number, number, number];
  player2Pos: [number, number, number];
}

export const TennisScene: React.FC<TennisSceneProps> = ({ ballPos, player1Pos, player2Pos }) => {
  return (
    <Canvas
      shadows
      camera={{ position: [0, 14, 22], fov: 38 }}
      gl={{ antialias: true, alpha: false }}
    >
      <color attach="background" args={['#0a0a0a']} />
      <fog attach="fog" args={['#1a2a1a', 30, 55]} />

      <Suspense fallback={null}>
        {/* Stadium Lighting */}
        <ambientLight intensity={0.35} color="#e8e0d0" />
        <directionalLight
          position={[12, 25, 10]}
          intensity={2.0}
          castShadow
          shadow-mapSize-width={2048}
          shadow-mapSize-height={2048}
          shadow-camera-far={60}
          shadow-camera-left={-20}
          shadow-camera-right={20}
          shadow-camera-top={20}
          shadow-camera-bottom={-20}
          color="#fff8e8"
        />
        <directionalLight
          position={[-8, 15, -8]}
          intensity={0.6}
          color="#c0d0ff"
        />
        <pointLight position={[0, 12, 0]} intensity={0.4} color="#ffe8c0" distance={40} />

        {/* Stadium Sky */}
        <Sky
          sunPosition={[80, 15, 60]}
          turbidity={3}
          rayleigh={0.4}
          mieCoefficient={0.01}
          mieDirectionalG={0.8}
        />

        {/* 3D Elements */}
        <Court />

        {/* Ball */}
        <Ball position={ballPos} />

        {/* Players - blue (bottom/near) vs red (top/far) */}
        <Player position={player1Pos} color="#3b82f6" accentColor="#1e3a5f" side="bottom" />
        <Player position={player2Pos} color="#ef4444" accentColor="#7f1d1d" side="top" />

        {/* Camera Controls */}
        <OrbitControls
          enablePan={true}
          enableZoom={true}
          enableRotate={true}
          maxPolarAngle={Math.PI / 2 - 0.05}
          minDistance={8}
          maxDistance={45}
          target={[0, 0, 0]}
        />
      </Suspense>
    </Canvas>
  );
};
