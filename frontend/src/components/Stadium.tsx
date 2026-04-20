import React, { useMemo } from 'react';
import * as THREE from 'three';

/**
 * Stadium environment: grandstands and ambient structures surrounding the court
 * for visual depth and realism.
 */
export const Stadium: React.FC = React.memo(() => {
  const standMat = useMemo(() => new THREE.MeshStandardMaterial({
    color: '#1a2620',
    roughness: 0.9,
    metalness: 0.05,
  }), []);

  const standTopMat = useMemo(() => new THREE.MeshStandardMaterial({
    color: '#0f1a14',
    roughness: 0.95,
  }), []);

  // Light tower material
  const towerMat = useMemo(() => new THREE.MeshStandardMaterial({
    color: '#222222',
    metalness: 0.8,
    roughness: 0.2,
  }), []);

  const lightMat = useMemo(() => new THREE.MeshStandardMaterial({
    color: '#fffde0',
    emissive: '#fffde0',
    emissiveIntensity: 2,
  }), []);

  const courtWidth = 10.97;
  const courtLength = 23.77;

  return (
    <group>
      {/* --- Grandstands (stepped rows behind perimeter boards) --- */}
      
      {/* Back stand (far side) */}
      <mesh position={[0, 2, -(courtLength / 2 + 13)]} castShadow receiveShadow>
        <boxGeometry args={[courtWidth + 20, 5, 6]} />
        <primitive object={standMat} attach="material" />
      </mesh>
      <mesh position={[0, 5, -(courtLength / 2 + 14)]} castShadow receiveShadow>
        <boxGeometry args={[courtWidth + 18, 4, 4]} />
        <primitive object={standTopMat} attach="material" />
      </mesh>

      {/* Back stand (near side) */}
      <mesh position={[0, 2, (courtLength / 2 + 13)]} castShadow receiveShadow>
        <boxGeometry args={[courtWidth + 20, 5, 6]} />
        <primitive object={standMat} attach="material" />
      </mesh>
      <mesh position={[0, 5, (courtLength / 2 + 14)]} castShadow receiveShadow>
        <boxGeometry args={[courtWidth + 18, 4, 4]} />
        <primitive object={standTopMat} attach="material" />
      </mesh>

      {/* Side stand (left) */}
      <mesh position={[-(courtWidth / 2 + 12), 1.5, 0]} castShadow receiveShadow>
        <boxGeometry args={[5, 4, courtLength + 12]} />
        <primitive object={standMat} attach="material" />
      </mesh>

      {/* Side stand (right) */}
      <mesh position={[(courtWidth / 2 + 12), 1.5, 0]} castShadow receiveShadow>
        <boxGeometry args={[5, 4, courtLength + 12]} />
        <primitive object={standMat} attach="material" />
      </mesh>

      {/* --- Stadium Light Towers (4 corners) --- */}
      {[
        [courtWidth / 2 + 10, courtLength / 2 + 10],
        [-(courtWidth / 2 + 10), courtLength / 2 + 10],
        [courtWidth / 2 + 10, -(courtLength / 2 + 10)],
        [-(courtWidth / 2 + 10), -(courtLength / 2 + 10)],
      ].map(([x, z], i) => (
        <group key={i} position={[x, 0, z]}>
          {/* Tower pole */}
          <mesh position={[0, 10, 0]} material={towerMat}>
            <cylinderGeometry args={[0.15, 0.2, 20, 8]} />
          </mesh>
          {/* Light fixture */}
          <mesh position={[0, 20.5, 0]} material={lightMat}>
            <boxGeometry args={[1.2, 0.3, 0.6]} />
          </mesh>
          {/* Spot light from tower */}
          <pointLight
            position={[0, 20, 0]}
            intensity={0.3}
            color="#ffe8c0"
            distance={50}
            decay={2}
          />
        </group>
      ))}
    </group>
  );
});

Stadium.displayName = 'Stadium';
