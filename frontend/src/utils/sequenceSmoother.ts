import type { ProcFrameData, Coordinate } from '../types/tracking';

/**
 * Applies smoothing and gap-filling to the raw tracking sequence from the backend.
 * 1. Fills missing ball positions (gaps <= 20 frames) using linear interpolation
 *    (in future could use cubic spline).
 * 2. Applies a simple moving average (SMA) or exponential moving average (EMA)
 *    to ball and player coordinates to reduce high-frequency jitter.
 * 3. Rejects unrealistic jumps (jitter gate).
 */
export function smoothSequence(raw: ProcFrameData[]): ProcFrameData[] {
  if (raw.length === 0) return [];

  // Deep clone to avoid mutating the original
  const seq: ProcFrameData[] = JSON.parse(JSON.stringify(raw));

  fillBallGaps(seq, 20); // Gap fill up to 20 frames
  applyEMA(seq, 0.4);    // EMA smoothing with alpha=0.4
  applyJitterGate(seq, 2.0); // Reject jumps > 2m per frame for players

  return seq;
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
        // Interpolate between gapStart - 1 and gapEnd
        const startIdx = gapStart > 0 ? gapStart - 1 : gapStart;
        const startPos = seq[startIdx].ball.position;
        const endPos = seq[gapEnd].ball.position;

        for (let j = gapStart; j < gapEnd; j++) {
          const t = (j - startIdx) / (gapEnd - startIdx);
          seq[j].ball.position = lerp3D(startPos, endPos, t);
          // Keep is_occluded = true so the frontend knows it was predicted
        }
      }
      gapStart = -1;
    }
  }

  // Handle gap at the end
  if (gapStart !== -1 && gapStart > 0) {
    const lastValidPos = seq[gapStart - 1].ball.position;
    for (let j = gapStart; j < seq.length; j++) {
      seq[j].ball.position = { ...lastValidPos }; // Just hold last position
    }
  }
}

function applyEMA(seq: ProcFrameData[], alpha: number) {
  if (seq.length < 2) return;

  let prevBall = { ...seq[0].ball.position };
  let prevP1 = { ...seq[0].players.find(p => p.id.includes('bottom'))?.position } as Coordinate;
  let prevP2 = { ...seq[0].players.find(p => p.id.includes('top'))?.position } as Coordinate;

  if (!prevP1) prevP1 = { x: 0, y: 0, z: 10 };
  if (!prevP2) prevP2 = { x: 0, y: 0, z: -10 };

  for (let i = 1; i < seq.length; i++) {
    // Ball
    const bPos = seq[i].ball.position;
    bPos.x = prevBall.x + alpha * (bPos.x - prevBall.x);
    bPos.y = prevBall.y + alpha * (bPos.y - prevBall.y);
    bPos.z = prevBall.z + alpha * (bPos.z - prevBall.z);
    prevBall = { ...bPos };

    // Players
    for (const player of seq[i].players) {
      if (player.id.includes('bottom')) {
        player.position.x = prevP1.x + alpha * (player.position.x - prevP1.x);
        player.position.z = prevP1.z + alpha * (player.position.z - prevP1.z);
        prevP1 = { ...player.position };
      } else if (player.id.includes('top')) {
        player.position.x = prevP2.x + alpha * (player.position.x - prevP2.x);
        player.position.z = prevP2.z + alpha * (player.position.z - prevP2.z);
        prevP2 = { ...player.position };
      }
    }
  }
}

function applyJitterGate(seq: ProcFrameData[], maxDeltaMeters: number) {
  if (seq.length < 2) return;

  let prevP1 = { ...seq[0].players.find(p => p.id.includes('bottom'))?.position } as Coordinate;
  let prevP2 = { ...seq[0].players.find(p => p.id.includes('top'))?.position } as Coordinate;

  for (let i = 1; i < seq.length; i++) {
    for (const player of seq[i].players) {
      if (player.id.includes('bottom') && prevP1) {
        if (Math.abs(player.position.x - prevP1.x) > maxDeltaMeters ||
            Math.abs(player.position.z - prevP1.z) > maxDeltaMeters) {
          player.position.x = prevP1.x;
          player.position.z = prevP1.z;
        } else {
          prevP1 = { ...player.position };
        }
      } else if (player.id.includes('top') && prevP2) {
        if (Math.abs(player.position.x - prevP2.x) > maxDeltaMeters ||
            Math.abs(player.position.z - prevP2.z) > maxDeltaMeters) {
          player.position.x = prevP2.x;
          player.position.z = prevP2.z;
        } else {
          prevP2 = { ...player.position };
        }
      }
    }
  }
}

function lerp3D(start: Coordinate, end: Coordinate, t: number): Coordinate {
  return {
    x: start.x + (end.x - start.x) * t,
    y: start.y + (end.y - start.y) * t,
    z: start.z + (end.z - start.z) * t,
  };
}
