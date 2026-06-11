import type { ProcFrameData, Coordinate } from '../types/tracking';

/**
 * Applies minimal smoothing to tracking sequences.
 *
 * KEY PRINCIPLE: The videoProcessor already generates physics-simulated positions.
 * We must NOT apply heavy EMA smoothing — it kills all ball movement.
 * Only do:
 *   1. Fill occluded gaps via linear interpolation (backend data only)
 *   2. Very light ball smoothing (3-tap Gaussian) to remove any single-frame spikes
 *   3. NaN/undefined guard for player positions
 */
export function smoothSequence(raw: ProcFrameData[]): ProcFrameData[] {
  if (raw.length === 0) return [];

  // Deep clone to avoid mutating the original
  const seq: ProcFrameData[] = JSON.parse(JSON.stringify(raw));

  // 1. Guard against NaN/undefined in player positions
  sanitizePlayers(seq);

  // 2. Fill occluded ball gaps (backend data only — synthesized data has none)
  fillBallGaps(seq, 20);

  // 3. Very light 3-tap Gaussian on ball position (only when data has jitter)
  //    alpha=0.85 means we keep 85% of the real value — almost no damping
  lightSmoothBall(seq);

  return seq;
}

function sanitizePlayers(seq: ProcFrameData[]) {
  const DEF_P1 = { x: 0, y: 0, z: 10 };
  const DEF_P2 = { x: 0, y: 0, z: -10 };

  for (const frame of seq) {
    for (const player of frame.players) {
      const p = player.position;
      if (!isFinite(p.x) || p.x === undefined) p.x = player.id.includes('bottom') ? DEF_P1.x : DEF_P2.x;
      if (!isFinite(p.y) || p.y === undefined) p.y = 0;
      if (!isFinite(p.z) || p.z === undefined) p.z = player.id.includes('bottom') ? DEF_P1.z : DEF_P2.z;
    }
  }
}

function fillBallGaps(seq: ProcFrameData[], maxGap: number) {
  let gapStart = -1;

  for (let i = 0; i < seq.length; i++) {
    const isOccluded = seq[i].ball.is_occluded;

    if (isOccluded && gapStart === -1) {
      gapStart = i;
    } else if (!isOccluded && gapStart !== -1) {
      const gapEnd = i;
      const gapLen = gapEnd - gapStart;

      if (gapLen > 0 && gapLen <= maxGap) {
        if (gapStart === 0) {
          const endPos = seq[gapEnd].ball.position;
          for (let j = gapStart; j < gapEnd; j++) {
            seq[j].ball.position = { ...endPos };
          }
        } else {
          const startIdx = gapStart - 1;
          const startPos = seq[startIdx].ball.position;
          const endPos = seq[gapEnd].ball.position;
          for (let j = gapStart; j < gapEnd; j++) {
            const t = (j - startIdx) / (gapEnd - startIdx);
            seq[j].ball.position = lerp3D(startPos, endPos, t);
          }
        }
      }
      gapStart = -1;
    }
  }

  if (gapStart !== -1 && gapStart > 0) {
    const lastValidPos = seq[gapStart - 1].ball.position;
    for (let j = gapStart; j < seq.length; j++) {
      seq[j].ball.position = { ...lastValidPos };
    }
  }
}

function lightSmoothBall(seq: ProcFrameData[]) {
  // Only smooth if we detect any high-frequency jitter (backend YOLO data)
  // Check variance across first 10 frames
  let hasJitter = false;
  for (let i = 1; i < Math.min(10, seq.length); i++) {
    const dz = Math.abs(seq[i].ball.position.z - seq[i-1].ball.position.z);
    if (dz > 1.5) { hasJitter = true; break; } // >1.5m/frame = noise
  }
  if (!hasJitter) return; // synthesized data is already smooth — skip

  // 3-tap Gaussian: weights [0.15, 0.70, 0.15]
  const smoothed = seq.map((f, i) => ({ ...f.ball.position }));
  for (let i = 1; i < seq.length - 1; i++) {
    const a = seq[i-1].ball.position;
    const b = seq[i].ball.position;
    const c = seq[i+1].ball.position;
    smoothed[i] = {
      x: a.x * 0.15 + b.x * 0.70 + c.x * 0.15,
      y: Math.max(0.05, a.y * 0.15 + b.y * 0.70 + c.y * 0.15),
      z: a.z * 0.15 + b.z * 0.70 + c.z * 0.15,
    };
  }
  for (let i = 0; i < seq.length; i++) {
    seq[i].ball.position = smoothed[i];
  }
}

function lerp3D(start: Coordinate, end: Coordinate, t: number): Coordinate {
  return {
    x: start.x + (end.x - start.x) * t,
    y: start.y + (end.y - start.y) * t,
    z: start.z + (end.z - start.z) * t,
  };
}
