import React from 'react';

interface RadarMinimapProps {
  ballPos: [number, number, number] | null;
  p1Pos: [number, number, number] | null;
  p2Pos: [number, number, number] | null;
}

export const RadarMinimap: React.FC<RadarMinimapProps> = React.memo(({ ballPos, p1Pos, p2Pos }) => {
  // ITF standard dimensions (meters)
  const HW = 5.485;  // half-width (doubles)
  const HL = 11.885; // half-length
  const SHW = 4.115; // half-width (singles)
  
  // Padding for the minimap view
  const PAD = 2;
  const viewBoxW = (HW + PAD) * 2;
  const viewBoxH = (HL + PAD) * 2;
  
  // Transform 3D coordinates (x, z) to 2D SVG coordinates
  // 3D X maps to SVG X. 3D Z maps to SVG Y.
  // Origin (0,0) in 3D is center of court.
  // SVG top-left is (0,0), so center is (viewBoxW/2, viewBoxH/2)
  const cx = viewBoxW / 2;
  const cy = viewBoxH / 2;

  const getSvgPos = (x: number, z: number) => {
    return {
      x: cx + x,
      // Invert Z if needed, but in our 3D scene, +Z is usually towards the camera (P1)
      y: cy + z
    };
  };

  return (
    <div style={{
      position: 'absolute',
      left: '16px',
      bottom: '80px',
      width: '120px',
      height: '220px',
      background: 'rgba(0, 0, 0, 0.4)',
      backdropFilter: 'blur(8px)',
      WebkitBackdropFilter: 'blur(8px)',
      border: '1px solid rgba(255, 255, 255, 0.1)',
      borderRadius: '12px',
      zIndex: 20,
      padding: '10px',
      boxShadow: '0 8px 32px rgba(0, 0, 0, 0.3)',
      animation: 'slide-in-left 0.5s var(--ease-out-expo) 0.3s forwards',
    }}>
      <svg width="100%" height="100%" viewBox={`0 0 ${viewBoxW} ${viewBoxH}`} style={{ overflow: 'visible' }}>
        {/* Court Outline (Doubles) */}
        <rect 
          x={cx - HW} y={cy - HL} 
          width={HW * 2} height={HL * 2} 
          fill="rgba(255, 255, 255, 0.05)" 
          stroke="rgba(255, 255, 255, 0.4)" 
          strokeWidth="0.3" 
        />
        
        {/* Singles Lines */}
        <line x1={cx - SHW} y1={cy - HL} x2={cx - SHW} y2={cy + HL} stroke="rgba(255, 255, 255, 0.3)" strokeWidth="0.3" />
        <line x1={cx + SHW} y1={cy - HL} x2={cx + SHW} y2={cy + HL} stroke="rgba(255, 255, 255, 0.3)" strokeWidth="0.3" />
        
        {/* Net */}
        <line x1={cx - HW - 0.5} y1={cy} x2={cx + HW + 0.5} y2={cy} stroke="rgba(255, 255, 255, 0.8)" strokeWidth="0.5" strokeDasharray="0.5,0.5" />
        
        {/* Service Lines (6.4m from net) */}
        <line x1={cx - SHW} y1={cy - 6.4} x2={cx + SHW} y2={cy - 6.4} stroke="rgba(255, 255, 255, 0.3)" strokeWidth="0.3" />
        <line x1={cx - SHW} y1={cy + 6.4} x2={cx + SHW} y2={cy + 6.4} stroke="rgba(255, 255, 255, 0.3)" strokeWidth="0.3" />
        
        {/* Center Service Line */}
        <line x1={cx} y1={cy - 6.4} x2={cx} y2={cy + 6.4} stroke="rgba(255, 255, 255, 0.3)" strokeWidth="0.3" />
        
        {/* Center Mark */}
        <line x1={cx} y1={cy - HL} x2={cx} y2={cy - HL + 0.5} stroke="rgba(255, 255, 255, 0.4)" strokeWidth="0.3" />
        <line x1={cx} y1={cy + HL} x2={cx} y2={cy + HL - 0.5} stroke="rgba(255, 255, 255, 0.4)" strokeWidth="0.3" />

        {/* Player 1 (Bottom) */}
        {p1Pos && (
          <circle 
            cx={getSvgPos(p1Pos[0], p1Pos[2]).x} 
            cy={getSvgPos(p1Pos[0], p1Pos[2]).y} 
            r="1" 
            fill="var(--accent)" 
            filter="drop-shadow(0px 0px 2px var(--accent-glow))"
          />
        )}

        {/* Player 2 (Top) */}
        {p2Pos && (
          <circle 
            cx={getSvgPos(p2Pos[0], p2Pos[2]).x} 
            cy={getSvgPos(p2Pos[0], p2Pos[2]).y} 
            r="1" 
            fill="var(--cyan)" 
            filter="drop-shadow(0px 0px 2px var(--cyan-glow))"
          />
        )}

        {/* Ball */}
        {ballPos && (
          <circle 
            cx={getSvgPos(ballPos[0], ballPos[2]).x} 
            cy={getSvgPos(ballPos[0], ballPos[2]).y} 
            r={0.4 + (ballPos[1] * 0.3)} // scale slightly by height
            fill="#fff" 
            filter="drop-shadow(0px 0px 2px #fff)"
          />
        )}
      </svg>
      <div style={{ position: 'absolute', top: 6, left: 10, fontSize: '8px', color: 'rgba(255,255,255,0.5)', fontWeight: 'bold', letterSpacing: '1px' }}>RADAR</div>
    </div>
  );
});

RadarMinimap.displayName = 'RadarMinimap';
