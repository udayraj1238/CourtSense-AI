import React, { useRef, useEffect, useCallback } from 'react';

interface HeatmapOverlayProps {
  /** Ball positions accumulated so far: [x, z] in court space */
  positions: [number, number][];
  /** Whether to show the overlay */
  visible: boolean;
  /** Court bounds in world units */
  courtWidth?: number;   // half-width, e.g. 5.485
  courtLength?: number;  // half-length, e.g. 11.885
}

const COURT_HALF_W = 5.485;
const COURT_HALF_L = 11.885;

/**
 * Renders a 2D heatmap of ball positions as a canvas overlay.
 * Positions are mapped from 3D world space → 2D canvas space.
 */
export const HeatmapOverlay: React.FC<HeatmapOverlayProps> = React.memo(({
  positions,
  visible,
  courtWidth = COURT_HALF_W,
  courtLength = COURT_HALF_L,
}) => {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  const draw = useCallback(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const W = canvas.width;
    const H = canvas.height;

    ctx.clearRect(0, 0, W, H);

    if (positions.length === 0) return;

    // Draw court outline
    ctx.strokeStyle = 'rgba(163, 230, 53, 0.3)';
    ctx.lineWidth = 1;
    ctx.strokeRect(4, 4, W - 8, H - 8);

    // Draw net line
    ctx.strokeStyle = 'rgba(255,255,255,0.2)';
    ctx.setLineDash([4, 4]);
    ctx.beginPath();
    ctx.moveTo(4, H / 2);
    ctx.lineTo(W - 4, H / 2);
    ctx.stroke();
    ctx.setLineDash([]);

    // Draw heatmap blobs
    positions.forEach(([wx, wz]) => {
      // Map world coords to canvas coords
      const cx = ((wx + courtWidth) / (courtWidth * 2)) * (W - 8) + 4;
      const cy = ((wz + courtLength) / (courtLength * 2)) * (H - 8) + 4;

      const r = Math.max(W, H) * 0.06;
      const grad = ctx.createRadialGradient(cx, cy, 0, cx, cy, r);
      grad.addColorStop(0, 'rgba(163, 230, 53, 0.18)');
      grad.addColorStop(0.5, 'rgba(34, 211, 238, 0.08)');
      grad.addColorStop(1, 'rgba(163, 230, 53, 0)');

      ctx.fillStyle = grad;
      ctx.beginPath();
      ctx.arc(cx, cy, r, 0, Math.PI * 2);
      ctx.fill();
    });

    // Draw individual position dots (most recent ones)
    const recent = positions.slice(-30);
    recent.forEach(([wx, wz], i) => {
      const t = i / Math.max(recent.length - 1, 1);
      const cx = ((wx + courtWidth) / (courtWidth * 2)) * (W - 8) + 4;
      const cy = ((wz + courtLength) / (courtLength * 2)) * (H - 8) + 4;
      ctx.fillStyle = `rgba(163, 230, 53, ${t * 0.7})`;
      ctx.beginPath();
      ctx.arc(cx, cy, 2.5, 0, Math.PI * 2);
      ctx.fill();
    });
  }, [positions, courtWidth, courtLength]);

  useEffect(() => {
    draw();
  }, [draw]);

  if (!visible) return null;

  return (
    <div style={{
      position: 'absolute',
      bottom: '140px',
      left: '50%',
      transform: 'translateX(-50%)',
      zIndex: 20,
      animation: 'slide-in-right 0.4s var(--ease-out-expo) forwards',
    }}>
      <div style={{
        background: 'rgba(7, 12, 8, 0.85)',
        backdropFilter: 'blur(20px)',
        WebkitBackdropFilter: 'blur(20px)',
        border: '1px solid rgba(163, 230, 53, 0.2)',
        borderRadius: '16px',
        padding: '12px',
        display: 'flex',
        flexDirection: 'column',
        gap: '8px',
      }}>
        <div style={{
          fontSize: '9px',
          fontWeight: 700,
          letterSpacing: '0.15em',
          textTransform: 'uppercase',
          color: 'var(--text-muted)',
          fontFamily: 'var(--font-sans)',
          textAlign: 'center',
        }}>
          Ball Heatmap
        </div>
        <canvas
          ref={canvasRef}
          width={140}
          height={220}
          style={{
            display: 'block',
            borderRadius: '8px',
          }}
        />
        <div style={{
          fontSize: '9px',
          color: 'var(--text-muted)',
          textAlign: 'center',
          fontFamily: 'var(--font-mono)',
        }}>
          {positions.length} pts
        </div>
      </div>
    </div>
  );
});

HeatmapOverlay.displayName = 'HeatmapOverlay';
