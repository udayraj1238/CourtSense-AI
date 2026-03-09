import React from 'react';
import { Plane, Box } from '@react-three/drei';

export const Court: React.FC = () => {
  const courtWidth = 10.97;
  const courtLength = 23.77;
  const singlesWidth = 8.23;
  const serviceLineDistance = 6.4;

  const LINE_H = 0.015;
  const LINE_W = 0.06;

  return (
    <group>
      {/* Outer surround — dark green */}
      <Plane
        args={[courtWidth + 12, courtLength + 14]}
        rotation={[-Math.PI / 2, 0, 0]}
        position={[0, -0.03, 0]}
        receiveShadow
      >
        <meshStandardMaterial color="#1a3d24" roughness={0.95} />
      </Plane>

      {/* Court surface — hard court blue-green */}
      <Plane
        args={[courtWidth, courtLength]}
        rotation={[-Math.PI / 2, 0, 0]}
        position={[0, -0.01, 0]}
        receiveShadow
      >
        <meshStandardMaterial color="#2d7a50" roughness={0.75} />
      </Plane>

      {/* --- Court Lines --- */}
      {/* Doubles sidelines */}
      <Box args={[LINE_W, LINE_H, courtLength]} position={[courtWidth / 2, 0, 0]}>
        <meshStandardMaterial color="white" emissive="white" emissiveIntensity={0.15} />
      </Box>
      <Box args={[LINE_W, LINE_H, courtLength]} position={[-courtWidth / 2, 0, 0]}>
        <meshStandardMaterial color="white" emissive="white" emissiveIntensity={0.15} />
      </Box>

      {/* Singles sidelines */}
      <Box args={[LINE_W, LINE_H, courtLength]} position={[singlesWidth / 2, 0, 0]}>
        <meshStandardMaterial color="white" emissive="white" emissiveIntensity={0.15} />
      </Box>
      <Box args={[LINE_W, LINE_H, courtLength]} position={[-singlesWidth / 2, 0, 0]}>
        <meshStandardMaterial color="white" emissive="white" emissiveIntensity={0.15} />
      </Box>

      {/* Baselines */}
      <Box args={[courtWidth, LINE_H, LINE_W]} position={[0, 0, courtLength / 2]}>
        <meshStandardMaterial color="white" emissive="white" emissiveIntensity={0.15} />
      </Box>
      <Box args={[courtWidth, LINE_H, LINE_W]} position={[0, 0, -courtLength / 2]}>
        <meshStandardMaterial color="white" emissive="white" emissiveIntensity={0.15} />
      </Box>

      {/* Service lines */}
      <Box args={[singlesWidth, LINE_H, LINE_W]} position={[0, 0, serviceLineDistance]}>
        <meshStandardMaterial color="white" emissive="white" emissiveIntensity={0.15} />
      </Box>
      <Box args={[singlesWidth, LINE_H, LINE_W]} position={[0, 0, -serviceLineDistance]}>
        <meshStandardMaterial color="white" emissive="white" emissiveIntensity={0.15} />
      </Box>

      {/* Center service line */}
      <Box args={[LINE_W, LINE_H, serviceLineDistance * 2]} position={[0, 0, 0]}>
        <meshStandardMaterial color="white" emissive="white" emissiveIntensity={0.15} />
      </Box>

      {/* Center marks */}
      <Box args={[LINE_W, LINE_H, 0.25]} position={[0, 0, courtLength / 2]}>
        <meshStandardMaterial color="white" emissive="white" emissiveIntensity={0.15} />
      </Box>
      <Box args={[LINE_W, LINE_H, 0.25]} position={[0, 0, -courtLength / 2]}>
        <meshStandardMaterial color="white" emissive="white" emissiveIntensity={0.15} />
      </Box>

      {/* --- Net --- */}
      {/* Net mesh */}
      <Box args={[courtWidth + 1, 0.914, 0.04]} position={[0, 0.914 / 2, 0]} castShadow>
        <meshStandardMaterial color="#ffffff" transparent opacity={0.35} wireframe />
      </Box>
      {/* Net cord (top) */}
      <Box args={[courtWidth + 1, 0.04, 0.04]} position={[0, 0.914, 0]}>
        <meshStandardMaterial color="#ffffff" emissive="white" emissiveIntensity={0.1} />
      </Box>
      {/* Net posts */}
      <mesh position={[(courtWidth + 1) / 2, 1.07 / 2, 0]} castShadow>
        <cylinderGeometry args={[0.04, 0.04, 1.07, 8]} />
        <meshStandardMaterial color="#222222" metalness={0.8} roughness={0.2} />
      </mesh>
      <mesh position={[-(courtWidth + 1) / 2, 1.07 / 2, 0]} castShadow>
        <cylinderGeometry args={[0.04, 0.04, 1.07, 8]} />
        <meshStandardMaterial color="#222222" metalness={0.8} roughness={0.2} />
      </mesh>
    </group>
  );
};
