import React, { useRef, useEffect, useMemo } from 'react';
import * as THREE from 'three';

interface BallTrailProps {
  positions: { p: [number, number, number]; occ: boolean }[];
}

const MAX_TRAIL = 20;

/**
 * Ball trail using a pre-allocated BufferGeometry updated in-place.
 * FIX: was creating `new THREE.Line(geometry, material)` on every render — 
 * now uses a stable ref with useEffect updates.
 */
export const BallTrail: React.FC<BallTrailProps> = React.memo(({ positions }) => {
  const lineRef = useRef<THREE.Line>(null);

  const { geometry, posAttr, colorAttr, material, line } = useMemo(() => {
    const geo = new THREE.BufferGeometry();
    const posAttr   = new THREE.BufferAttribute(new Float32Array(MAX_TRAIL * 3), 3);
    const colorAttr = new THREE.BufferAttribute(new Float32Array(MAX_TRAIL * 3), 3);
    posAttr.setUsage(THREE.DynamicDrawUsage);
    colorAttr.setUsage(THREE.DynamicDrawUsage);
    geo.setAttribute('position', posAttr);
    geo.setAttribute('color', colorAttr);
    geo.setDrawRange(0, 0);

    const mat = new THREE.LineBasicMaterial({
      vertexColors: true,
      transparent: true,
      opacity: 0.75,
      depthWrite: false,
    });

    // Stable Line object — never recreated
    const ln = new THREE.Line(geo, mat);
    ln.frustumCulled = false;
    return { geometry: geo, posAttr, colorAttr, material: mat, line: ln };
  }, []); // empty deps — created once only

  // Update buffer when positions prop changes
  useEffect(() => {
    const pts = positions.slice(-MAX_TRAIL);
    const n   = pts.length;

    for (let i = 0; i < n; i++) {
      const t = n <= 1 ? 1 : i / (n - 1); // 0=tail, 1=head
      const [px, py, pz] = pts[i].p;

      posAttr.setXYZ(i, px, py, pz);

      if (pts[i].occ) {
        // Occluded — dim purple
        colorAttr.setXYZ(i, 0.35 + t * 0.15, 0.25 + t * 0.1, 0.5 + t * 0.2);
      } else {
        // Real — tail is dim green, head is bright white/yellow
        colorAttr.setXYZ(
          i,
          0.4  + t * 0.6,   // R: 0.4 → 1.0
          0.75 + t * 0.25,  // G: 0.75 → 1.0
          0.05 + t * 0.7,   // B: 0.05 → 0.75
        );
      }
    }

    posAttr.needsUpdate   = true;
    colorAttr.needsUpdate = true;
    geometry.setDrawRange(0, n);
  }, [positions, posAttr, colorAttr, geometry]);

  if (positions.length < 2) return null;

  return <primitive object={line} ref={lineRef} />;
});

BallTrail.displayName = 'BallTrail';
