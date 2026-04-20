import React, { useMemo } from 'react';
import { Plane, Box } from '@react-three/drei';
import * as THREE from 'three';

export const Court: React.FC = React.memo(() => {
  const courtWidth = 10.97;
  const courtLength = 23.77;
  const singlesWidth = 8.23;
  const serviceLineDistance = 6.4;

  const LINE_H = 0.018;
  const LINE_W = 0.065;

  // Reuse materials via useMemo
  const lineMat = useMemo(() => new THREE.MeshStandardMaterial({
    color: '#ffffff',
    emissive: '#ffffff',
    emissiveIntensity: 0.25,
    roughness: 0.4,
  }), []);

  const courtSurfaceMat = useMemo(() => new THREE.MeshStandardMaterial({
    color: '#1a6b3c',
    roughness: 0.7,
    metalness: 0.0,
  }), []);

  const surroundMat = useMemo(() => new THREE.MeshStandardMaterial({
    color: '#143322',
    roughness: 0.9,
  }), []);

  const netMeshMat = useMemo(() => new THREE.MeshStandardMaterial({
    color: '#ffffff',
    transparent: true,
    opacity: 0.3,
    wireframe: true,
    side: THREE.DoubleSide,
  }), []);

  const netCordMat = useMemo(() => new THREE.MeshStandardMaterial({
    color: '#ffffff',
    emissive: '#ffffff',
    emissiveIntensity: 0.15,
  }), []);

  const postMat = useMemo(() => new THREE.MeshStandardMaterial({
    color: '#1a1a1a',
    metalness: 0.9,
    roughness: 0.15,
  }), []);

  // Perimeter run-off area (darker)
  const runoffMat = useMemo(() => new THREE.MeshStandardMaterial({
    color: '#0f2818',
    roughness: 0.95,
  }), []);

  return (
    <group>
      {/* Ground plane — very large dark floor for environment */}
      <Plane
        args={[200, 200]}
        rotation={[-Math.PI / 2, 0, 0]}
        position={[0, -0.06, 0]}
        receiveShadow
      >
        <meshStandardMaterial color="#080e08" roughness={1} />
      </Plane>

      {/* Outer surround — dark green */}
      <Plane
        args={[courtWidth + 16, courtLength + 18]}
        rotation={[-Math.PI / 2, 0, 0]}
        position={[0, -0.04, 0]}
        receiveShadow
        material={surroundMat}
      />

      {/* Run-off area */}
      <Plane
        args={[courtWidth + 8, courtLength + 10]}
        rotation={[-Math.PI / 2, 0, 0]}
        position={[0, -0.03, 0]}
        receiveShadow
        material={runoffMat}
      />

      {/* Court surface */}
      <Plane
        args={[courtWidth, courtLength]}
        rotation={[-Math.PI / 2, 0, 0]}
        position={[0, -0.01, 0]}
        receiveShadow
        material={courtSurfaceMat}
      />

      {/* --- Court Lines --- */}
      {/* Doubles sidelines */}
      <Box args={[LINE_W, LINE_H, courtLength]} position={[courtWidth / 2, 0, 0]} material={lineMat} />
      <Box args={[LINE_W, LINE_H, courtLength]} position={[-courtWidth / 2, 0, 0]} material={lineMat} />

      {/* Singles sidelines */}
      <Box args={[LINE_W, LINE_H, courtLength]} position={[singlesWidth / 2, 0, 0]} material={lineMat} />
      <Box args={[LINE_W, LINE_H, courtLength]} position={[-singlesWidth / 2, 0, 0]} material={lineMat} />

      {/* Baselines */}
      <Box args={[courtWidth, LINE_H, LINE_W]} position={[0, 0, courtLength / 2]} material={lineMat} />
      <Box args={[courtWidth, LINE_H, LINE_W]} position={[0, 0, -courtLength / 2]} material={lineMat} />

      {/* Service lines */}
      <Box args={[singlesWidth, LINE_H, LINE_W]} position={[0, 0, serviceLineDistance]} material={lineMat} />
      <Box args={[singlesWidth, LINE_H, LINE_W]} position={[0, 0, -serviceLineDistance]} material={lineMat} />

      {/* Center service line */}
      <Box args={[LINE_W, LINE_H, serviceLineDistance * 2]} position={[0, 0, 0]} material={lineMat} />

      {/* Center marks */}
      <Box args={[LINE_W, LINE_H, 0.3]} position={[0, 0, courtLength / 2]} material={lineMat} />
      <Box args={[LINE_W, LINE_H, 0.3]} position={[0, 0, -courtLength / 2]} material={lineMat} />

      {/* --- Net --- */}
      {/* Net mesh */}
      <Box args={[courtWidth + 1, 0.914, 0.04]} position={[0, 0.914 / 2, 0]} castShadow material={netMeshMat} />
      {/* Net cord (top) */}
      <Box args={[courtWidth + 1, 0.05, 0.05]} position={[0, 0.914, 0]} material={netCordMat} />

      {/* Net posts */}
      <mesh position={[(courtWidth + 1) / 2, 1.07 / 2, 0]} castShadow>
        <cylinderGeometry args={[0.045, 0.045, 1.07, 12]} />
        <primitive object={postMat} attach="material" />
      </mesh>
      <mesh position={[-(courtWidth + 1) / 2, 1.07 / 2, 0]} castShadow>
        <cylinderGeometry args={[0.045, 0.045, 1.07, 12]} />
        <primitive object={postMat} attach="material" />
      </mesh>

      {/* --- Perimeter Fence / Boards --- */}
      {/* Back boards (behind each baseline) */}
      <Box args={[courtWidth + 16, 2.5, 0.15]} position={[0, 1.25, -(courtLength / 2 + 9)]} castShadow>
        <meshStandardMaterial color="#0d1f12" roughness={0.8} metalness={0.1} />
      </Box>
      <Box args={[courtWidth + 16, 2.5, 0.15]} position={[0, 1.25, (courtLength / 2 + 9)]} castShadow>
        <meshStandardMaterial color="#0d1f12" roughness={0.8} metalness={0.1} />
      </Box>
      {/* Side boards */}
      <Box args={[0.15, 2.5, courtLength + 18]} position={[(courtWidth / 2 + 8), 1.25, 0]} castShadow>
        <meshStandardMaterial color="#0d1f12" roughness={0.8} metalness={0.1} />
      </Box>
      <Box args={[0.15, 2.5, courtLength + 18]} position={[-(courtWidth / 2 + 8), 1.25, 0]} castShadow>
        <meshStandardMaterial color="#0d1f12" roughness={0.8} metalness={0.1} />
      </Box>
    </group>
  );
});

Court.displayName = 'Court';
