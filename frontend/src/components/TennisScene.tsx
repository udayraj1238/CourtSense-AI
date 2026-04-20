import React, { Suspense, useEffect } from 'react';
import { Canvas, useThree } from '@react-three/fiber';
import { OrbitControls, Stars } from '@react-three/drei';
import { Court } from './Court';
import { Stadium } from './Stadium';
import { Ball } from './Ball';
import { BallTrail } from './BallTrail';
import { Player } from './Player';
import { Effects } from './Effects';

interface TennisSceneProps {
  ballPos: [number, number, number];
  player1Pos: [number, number, number];
  player2Pos: [number, number, number];
  ballTrail?: [number, number, number][];
  cameraPreset?: 'default' | 'overhead' | 'p1' | 'p2';
}

/** Smooth camera controller that snaps to preset positions */
function CameraController({ preset }: { preset: string }) {
  const { camera } = useThree();

  useEffect(() => {
    switch (preset) {
      case 'overhead':
        camera.position.set(0, 30, 0.1);
        break;
      case 'p1':
        camera.position.set(0, 4, 18);
        break;
      case 'p2':
        camera.position.set(0, 4, -18);
        break;
      default:
        camera.position.set(0, 14, 22);
        break;
    }
    camera.lookAt(0, 0, 0);
  }, [preset, camera]);

  return null;
}

export const TennisScene: React.FC<TennisSceneProps> = React.memo(({
  ballPos,
  player1Pos,
  player2Pos,
  ballTrail = [],
  cameraPreset = 'default',
}) => {
  // Get initial camera position based on preset
  const getCameraPos = (): [number, number, number] => {
    switch (cameraPreset) {
      case 'overhead': return [0, 30, 0.1];
      case 'p1': return [0, 4, 18];
      case 'p2': return [0, 4, -18];
      default: return [0, 14, 22];
    }
  };

  return (
    <Canvas
      shadows
      camera={{ position: getCameraPos(), fov: 38 }}
      gl={{
        antialias: true,
        alpha: false,
        powerPreference: 'high-performance',
        stencil: false,
        depth: true,
      }}
      dpr={[1, 1.5]} // Cap pixel ratio for performance
      performance={{ min: 0.5 }} // Adaptive performance
    >
      <color attach="background" args={['#060a06']} />
      <fog attach="fog" args={['#0a140a', 35, 65]} />

      <Suspense fallback={null}>
        {/* === Lighting Rig === */}
        {/* Ambient fill */}
        <ambientLight intensity={0.3} color="#e0ddd0" />
        
        {/* Main Key Light (sun/stadium primary) */}
        <directionalLight
          position={[12, 28, 10]}
          intensity={2.2}
          castShadow
          shadow-mapSize-width={2048}
          shadow-mapSize-height={2048}
          shadow-camera-far={70}
          shadow-camera-left={-25}
          shadow-camera-right={25}
          shadow-camera-top={25}
          shadow-camera-bottom={-25}
          shadow-bias={-0.0003}
          color="#fff8e0"
        />
        
        {/* Fill light (cooler, from opposite side) */}
        <directionalLight
          position={[-10, 18, -8]}
          intensity={0.5}
          color="#b0c8ff"
        />
        
        {/* Rim / back light */}
        <directionalLight
          position={[0, 10, -20]}
          intensity={0.3}
          color="#ffd0a0"
        />

        {/* Court center spot */}
        <pointLight position={[0, 15, 0]} intensity={0.5} color="#ffe8c0" distance={45} decay={2} />

        {/* Stars (night sky vibe) */}
        <Stars
          radius={80}
          depth={60}
          count={1500}
          factor={3}
          saturation={0.1}
          fade
          speed={0.3}
        />

        {/* === 3D Elements === */}
        <Court />
        <Stadium />

        {/* Ball Trail */}
        {ballTrail.length > 0 && <BallTrail positions={ballTrail} />}

        {/* Ball */}
        <Ball position={ballPos} />

        {/* Players */}
        <Player
          position={player1Pos}
          color="#3b82f6"
          accentColor="#1e3a5f"
          side="bottom"
          label="Player 1"
        />
        <Player
          position={player2Pos}
          color="#ef4444"
          accentColor="#7f1d1d"
          side="top"
          label="Player 2"
        />

        {/* Post-processing */}
        <Effects />

        {/* Camera Controller */}
        <CameraController preset={cameraPreset} />

        {/* Camera Controls */}
        <OrbitControls
          enablePan={true}
          enableZoom={true}
          enableRotate={true}
          maxPolarAngle={Math.PI / 2 - 0.05}
          minDistance={5}
          maxDistance={50}
          target={[0, 0, 0]}
          enableDamping={true}
          dampingFactor={0.08}
          rotateSpeed={0.6}
          zoomSpeed={0.8}
        />
      </Suspense>
    </Canvas>
  );
});

TennisScene.displayName = 'TennisScene';
