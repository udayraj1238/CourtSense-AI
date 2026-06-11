import React, { useRef, useEffect, useMemo } from 'react';
import * as THREE from 'three';

interface BallTrailProps {
  positions: { p: [number, number, number]; occ: boolean }[];
}

const MAX_TRAIL = 16;

/**
 * High-performance ball trail using a pre-allocated BufferGeometry
 * that updates in-place every frame — no garbage, no GC pauses.
 *
 * Renders as a series of line segments with opacity fade from tail → head.
 */
export const BallTrail: React.FC<BallTrailProps> = React.memo(({ positions }) => {
  const lineRef = useRef<THREE.Line>(null);

  // Pre-allocate buffer for MAX_TRAIL points — never reallocated
  const { geometry, posAttr, colorAttr } = useMemo(() => {
    const geo = new THREE.BufferGeometry();
    const posAttr = new THREE.BufferAttribute(new Float32Array(MAX_TRAIL * 3), 3);
    const colorAttr = new THREE.BufferAttribute(new Float32Array(MAX_TRAIL * 3), 3);
    posAttr.setUsage(THREE.DynamicDrawUsage);
    colorAttr.setUsage(THREE.DynamicDrawUsage);
    geo.setAttribute('position', posAttr);
    geo.setAttribute('color', colorAttr);
    geo.setDrawRange(0, 0);
    return { geometry: geo, posAttr, colorAttr };
  }, []);

  // Update buffer contents when positions change (no geometry recreation)
  useEffect(() => {
    const pts = positions.slice(-MAX_TRAIL);
    const n = pts.length;
    for (let i = 0; i < n; i++) {
      const t = i / Math.max(n - 1, 1); // 0=tail, 1=head
      const [px, py, pz] = pts[i].p;
      posAttr.setXYZ(i, px, py, pz);
      
      if (pts[i].occ) {
        // Occluded: Dim grey/purple, indicating prediction
        colorAttr.setXYZ(i, 0.4, 0.3, 0.5);
      } else {
        // Real detection: Fade from dim green → bright white
        const r = 0.5 + t * 0.5;
        const g = 0.85 + t * 0.15;
        const b = 0.1 + t * 0.9;
        colorAttr.setXYZ(i, r, g, b);
      }
    }
    posAttr.needsUpdate = true;
    colorAttr.needsUpdate = true;
    geometry.setDrawRange(0, n);
  }, [positions, posAttr, colorAttr, geometry]);

  const material = useMemo(() => new THREE.LineBasicMaterial({
    vertexColors: true,
    transparent: true,
    opacity: 0.7,
    depthWrite: false,
    linewidth: 1, // Note: >1 only works in WebGL2 with specific extensions
  }), []);

  const lineObj = useMemo(() => new THREE.Line(geometry, material), [geometry, material]);

  if (positions.length < 2) return null;

  return <primitive object={lineObj} ref={lineRef} />;
});

BallTrail.displayName = 'BallTrail';
