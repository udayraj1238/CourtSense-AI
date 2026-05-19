/**
 * videoProcessor v2 — Real player tracking via MediaPipe PoseLandmarker
 * + frame-differencing blob detection for ball
 * + perspective calibration from detected player positions
 */
import { PoseLandmarker, FilesetResolver } from '@mediapipe/tasks-vision';

export type ProgressCb = (step: string, pct: number) => void;

export interface ProcFrameData {
  frame_index: number;
  ball: { position: { x: number; y: number; z: number }; is_occluded: boolean };
  players: { id: string; position: { x: number; y: number; z: number } }[];
  ball_speed_kmh: number;
  spin_rate_rpm: number;
  hitter: 'p1' | 'p2' | null;
}

const W = 640, H = 360;
const HW = 4.115, HL = 11.885;
const MAX_SEC = 25;
const FRAME_STEP = 2;   // sample every 2nd frame → 15fps
const POSE_STEP = 6;    // run pose every 6 sampled frames → 2.5fps then interpolate

function sleep(ms = 0) { return new Promise(r => setTimeout(r, ms)); }
function r3(n: number) { return Math.round(n * 1000) / 1000; }

// ── Video loader ──────────────────────────────────────────────────────────────
async function loadVideo(file: File): Promise<HTMLVideoElement> {
  const v = document.createElement('video');
  v.muted = true; v.playsInline = true; v.preload = 'auto';
  await new Promise<void>((res, rej) => {
    v.addEventListener('loadeddata', () => res(), { once: true });
    v.addEventListener('error', () => rej(new Error('Cannot decode video')), { once: true });
    v.src = URL.createObjectURL(file);
    v.load();
  });
  return v;
}

async function seekTo(v: HTMLVideoElement, t: number) {
  await new Promise<void>(res => {
    const h = () => { v.removeEventListener('seeked', h); res(); };
    v.addEventListener('seeked', h);
    v.currentTime = t;
  });
}

// ── MediaPipe loader ──────────────────────────────────────────────────────────
let poseModel: PoseLandmarker | null = null;

async function loadPose(cb: ProgressCb): Promise<PoseLandmarker | null> {
  try {
    cb('Loading AI model…', 4);
    const vision = await FilesetResolver.forVisionTasks(
      'https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.14/wasm'
    );
    poseModel = await PoseLandmarker.createFromOptions(vision, {
      baseOptions: {
        modelAssetPath:
          'https://storage.googleapis.com/mediapipe-models/pose_landmarker/pose_landmarker_lite/float16/1/pose_landmarker_lite.task',
        delegate: 'GPU',
      },
      runningMode: 'IMAGE',
      numPoses: 2,
      minPoseDetectionConfidence: 0.3,
      minTrackingConfidence: 0.3,
    });
    return poseModel;
  } catch (e) {
    console.warn('MediaPipe unavailable, using motion fallback:', e);
    return null;
  }
}

// ── Court detection ───────────────────────────────────────────────────────────
interface Court { left: number; right: number; top: number; bottom: number; netY: number; }

function detectCourt(d: Uint8ClampedArray): Court {
  let minX = W, maxX = 0, minY = H, maxY = 0, n = 0;
  for (let y = H * 0.08; y < H * 0.92; y += 3) {
    for (let x = W * 0.04; x < W * 0.96; x += 3) {
      const i = (~~y * W + ~~x) * 4;
      const r = d[i], g = d[i + 1], b = d[i + 2];
      const isBlue = b > r + 20 && b > g + 10 && b > 70 && b < 210;
      const isGreen = g > r * 0.85 && g > b * 1.05 && g > 55 && g < 210;
      const isClay = r > g && r > b && r > 100 && r < 220 && g > 60;
      if (isBlue || isGreen || isClay) {
        if (x < minX) minX = x; if (x > maxX) maxX = x;
        if (y < minY) minY = y; if (y > maxY) maxY = y;
        n++;
      }
    }
  }
  if (n < 300 || maxX - minX < W * 0.25) {
    minX = W * 0.07; maxX = W * 0.93; minY = H * 0.1; maxY = H * 0.9;
  }
  return { left: minX, right: maxX, top: minY, bottom: maxY, netY: minY + (maxY - minY) * 0.5 };
}

// ── Blob detector (connected-component motion blobs) ──────────────────────────
interface Blob { cx: number; cy: number; size: number; w: number; h: number; }

function motionBlobs(curr: Uint8ClampedArray, prev: Uint8ClampedArray, court: Court, thr = 22): Blob[] {
  const motion = new Uint8Array(W * H);
  const l = ~~court.left, r = ~~court.right, t = ~~court.top, b = ~~court.bottom;
  for (let y = t; y < b; y++) {
    for (let x = l; x < r; x++) {
      const i = (y * W + x) * 4;
      if (Math.abs(curr[i] - prev[i]) + Math.abs(curr[i+1] - prev[i+1]) + Math.abs(curr[i+2] - prev[i+2]) > thr)
        motion[y * W + x] = 1;
    }
  }
  const visited = new Uint8Array(W * H);
  const blobs: Blob[] = [];
  for (let y = t; y < b; y++) {
    for (let x = l; x < r; x++) {
      const s = y * W + x;
      if (!motion[s] || visited[s]) continue;
      const q: number[] = [s]; let qi = 0;
      let sx = 0, sy = 0, cnt = 0, mnX = x, mxX = x, mnY = y, mxY = y;
      while (qi < q.length) {
        const c = q[qi++];
        if (visited[c]) continue;
        visited[c] = 1;
        const cx = c % W, cy = ~~(c / W);
        sx += cx; sy += cy; cnt++;
        if (cx < mnX) mnX = cx; if (cx > mxX) mxX = cx;
        if (cy < mnY) mnY = cy; if (cy > mxY) mxY = cy;
        for (const nb of [c-1, c+1, c-W, c+W]) {
          if (nb >= 0 && nb < W*H && motion[nb] && !visited[nb]) q.push(nb);
        }
      }
      if (cnt >= 4) blobs.push({ cx: sx/cnt, cy: sy/cnt, size: cnt, w: mxX-mnX+1, h: mxY-mnY+1 });
    }
  }
  return blobs;
}

function isBallColor(r: number, g: number, b: number) {
  // yellow-green with some tolerance for compression
  if (Math.max(r,g,b) < 120) return false;
  if (Math.max(r,g,b) - Math.min(r,g,b) < 20) return false;
  return g >= 130 && r >= 90 && b <= 130 && g >= r * 0.75 && r <= g * 1.2;
}

interface BallPx { x: number; y: number; vx: number; vy: number; }

function detectBall(curr: Uint8ClampedArray, prev: Uint8ClampedArray,
  court: Court, lastBall: BallPx | null): { x: number; y: number } | null {
  const blobs = motionBlobs(curr, prev, court, 20);
  // Tennis ball: small blob (area 6–600 px, aspect ratio close to 1)
  const candidates = blobs.filter(b => b.size >= 6 && b.size <= 600 && b.w < 50 && b.h < 50);
  if (!candidates.length) return null;

  let best: Blob | null = null, bestScore = -Infinity;
  for (const blob of candidates) {
    let score = 0;
    // Color bonus
    const pi = (~~blob.cy * W + ~~blob.cx) * 4;
    if (isBallColor(curr[pi], curr[pi+1], curr[pi+2])) score += 40;
    // Roundness bonus
    const aspect = Math.min(blob.w, blob.h) / Math.max(blob.w || 1, blob.h || 1);
    score += aspect * 20;
    // Size bonus (ideal ~15x15 px at broadcast scale)
    score -= Math.abs(blob.size - 150) * 0.06;
    // Trajectory bonus
    if (lastBall) {
      const predX = lastBall.x + lastBall.vx, predY = lastBall.y + lastBall.vy;
      const dist = Math.hypot(blob.cx - predX, blob.cy - predY);
      score -= dist * 0.4;
    }
    if (score > bestScore) { bestScore = score; best = blob; }
  }
  return best ? { x: best.cx, y: best.cy } : null;
}

// ── Pose → player pixel positions ─────────────────────────────────────────────
function poseToPlayerPx(result: import('@mediapipe/tasks-vision').PoseLandmarkerResult, netY: number) {
  // Each detected pose: use hip midpoint (landmarks 23 & 24)
  const players: { x: number; y: number }[] = [];
  for (const lm of result.landmarks) {
    const lhip = lm[23], rhip = lm[24];
    const cx = ((lhip.x + rhip.x) / 2) * W;
    const cy = ((lhip.y + rhip.y) / 2) * H;
    players.push({ x: cx, y: cy });
  }
  // Sort: higher py = near player (P1), lower py = far player (P2)
  players.sort((a, b) => b.y - a.y);
  const p1 = players[0] || { x: W * 0.5, y: H * 0.82 };
  const p2 = players[1] || { x: W * 0.5, y: H * 0.18 };
  // Enforce correct halves
  if (p1.y < netY) { p1.y = netY + 20; }
  if (p2.y > netY) { p2.y = netY - 20; }
  return { p1, p2 };
}

// ── 3D projection (perspective-calibrated) ────────────────────────────────────
interface Calib { p1y: number; p2y: number; midX: number; scaleX: number; }

function project3D(px: number, py: number, _court: Court, calib: Calib): [number, number, number] {
  // Z: interpolate between p1 (z=+HL) and p2 (z=-HL) using pixel y
  const { p1y, p2y } = calib;
  const rangeY = p2y - p1y; // negative (p2 is higher in frame)
  const t = rangeY !== 0 ? (py - p1y) / rangeY : 0.5;
  const z3 = HL * (1 - 2 * Math.sqrt(Math.max(0, Math.min(1, t))));

  // X: relative to midpoint, scaled
  const dx = px - calib.midX;
  const x3 = (dx / calib.scaleX) * HW * 2;

  return [r3(Math.max(-HW, Math.min(HW, x3))), 0, r3(Math.max(-HL, Math.min(HL, z3)))];
}

function ballHeight(py: number, court: Court): number {
  const norm = (court.bottom - py) / (court.bottom - court.top);
  return Math.max(0.07, norm * (1 - norm) * 4 * 4.5);
}

// ── Kalman 1-D smoother ───────────────────────────────────────────────────────
function kalman(vals: number[], R = 2, Q = 0.15): number[] {
  const out = vals.slice();
  let x = vals[0], v = 0, p = 1;
  for (let i = 0; i < vals.length; i++) {
    x += v; p += Q;
    const K = p / (p + R);
    x += K * (vals[i] - x);
    v += K * (vals[i] - x) * 0.3;
    p *= 1 - K;
    out[i] = x;
  }
  return out;
}

function smooth(seq: ProcFrameData[]): ProcFrameData[] {
  if (seq.length < 3) return seq;
  const bx = kalman(seq.map(f => f.ball.position.x), 1.2, 0.25);
  const by = kalman(seq.map(f => f.ball.position.y), 0.6, 0.2);
  const bz = kalman(seq.map(f => f.ball.position.z), 1.2, 0.25);
  const p1x = kalman(seq.map(f => f.players[0].position.x), 4, 0.08);
  const p1z = kalman(seq.map(f => f.players[0].position.z), 4, 0.08);
  const p2x = kalman(seq.map(f => f.players[1].position.x), 4, 0.08);
  const p2z = kalman(seq.map(f => f.players[1].position.z), 4, 0.08);
  return seq.map((f, i) => ({
    ...f,
    ball: { ...f.ball, position: { x: r3(bx[i]), y: r3(Math.max(0.07, by[i])), z: r3(bz[i]) } },
    players: [
      { id: 'player_bottom', position: { x: r3(p1x[i]), y: 0, z: r3(p1z[i]) } },
      { id: 'player_top', position: { x: r3(p2x[i]), y: 0, z: r3(p2z[i]) } },
    ],
  }));
}

function markHitters(seq: ProcFrameData[]): ProcFrameData[] {
  return seq.map((f, i) => {
    if (i < 1 || i >= seq.length - 1) return { ...f, hitter: null };
    const prev = seq[i-1].ball_speed_kmh, curr = f.ball_speed_kmh, next = seq[i+1].ball_speed_kmh;
    if (curr > prev * 1.35 && curr > next * 1.1 && curr > 35) {
      return { ...f, hitter: f.ball.position.z > 0 ? 'p1' : 'p2' };
    }
    return { ...f, hitter: null };
  });
}

// ── MAIN EXPORT ───────────────────────────────────────────────────────────────
export async function processVideoFile(
  file: File, onProgress: ProgressCb
): Promise<{ sequence: ProcFrameData[] }> {

  onProgress('Loading video…', 1);
  const video = await loadVideo(file);
  const duration = Math.min(video.duration, MAX_SEC);

  // Try loading MediaPipe
  const pose = await loadPose(onProgress);

  onProgress('Detecting court…', 8);

  const canvas = document.createElement('canvas');
  canvas.width = W; canvas.height = H;
  const ctx = canvas.getContext('2d', { willReadFrequently: true })!;

  // Detect court from second 0.5
  await seekTo(video, 0.5);
  ctx.drawImage(video, 0, 0, W, H);
  const court = detectCourt(ctx.getImageData(0, 0, W, H).data);

  const interval = FRAME_STEP / 30;
  const totalFrames = Math.floor(duration / interval);
  onProgress('Processing frames…', 10);

  const rawFrames: ProcFrameData[] = [];
  let prevData: Uint8ClampedArray | null = null;
  let lastBall: BallPx | null = null;
  let missBall = 0;

  // Player pixel positions (smoothed)
  let p1px = { x: (court.left + court.right) / 2, y: court.bottom * 0.82 };
  let p2px = { x: (court.left + court.right) / 2, y: court.top + (court.netY - court.top) * 0.2 };

  // Pose detection results (interpolated between samples)
  let lastPoseP1 = p1px, lastPoseP2 = p2px;
  let nextPoseP1 = p1px, nextPoseP2 = p2px;
  let poseFrame = 0;

  // Calibration (updated when we get good pose readings)
  let calib: Calib = {
    p1y: court.bottom * 0.82,
    p2y: court.top + (court.netY - court.top) * 0.2,
    midX: (court.left + court.right) / 2,
    scaleX: (court.right - court.left) / (HW * 2),
  };

  let prevBall3D: [number, number, number] = [0, 1, 0];
  let smoothSpeed = 0;

  for (let fi = 0; fi < totalFrames; fi++) {
    const t = fi * interval;
    await seekTo(video, t);
    ctx.drawImage(video, 0, 0, W, H);
    const imgData = ctx.getImageData(0, 0, W, H);
    const d = imgData.data;

    // ── Pose detection (every POSE_STEP sampled frames) ──────────────────
    if (pose && fi % POSE_STEP === 0) {
      try {
        const result = pose.detect(canvas);
        if (result.landmarks.length >= 1) {
          const { p1, p2 } = poseToPlayerPx(result, court.netY);
          lastPoseP1 = nextPoseP1;
          lastPoseP2 = nextPoseP2;
          nextPoseP1 = p1;
          nextPoseP2 = p2;
          poseFrame = fi;
          // Update calibration
          calib = {
            p1y: p1.y,
            p2y: p2.y,
            midX: (p1.x + p2.x) / 2,
            scaleX: Math.max(50, (court.right - court.left) / (HW * 2)),
          };
        }
      } catch { /* pose detection failed this frame — skip */ }
    }

    // Interpolate player pixel position between pose samples
    const poseFrac = POSE_STEP > 0 ? Math.min(1, (fi - poseFrame) / POSE_STEP) : 0;
    p1px = {
      x: lastPoseP1.x + (nextPoseP1.x - lastPoseP1.x) * poseFrac,
      y: lastPoseP1.y + (nextPoseP1.y - lastPoseP1.y) * poseFrac,
    };
    p2px = {
      x: lastPoseP2.x + (nextPoseP2.x - lastPoseP2.x) * poseFrac,
      y: lastPoseP2.y + (nextPoseP2.y - lastPoseP2.y) * poseFrac,
    };

    // Without pose: use motion blobs to update player positions
    if (!pose && prevData) {
      const blobs = motionBlobs(d, prevData, court, 25);
      const large = blobs.filter(b => b.size > 300).sort((a, b) => b.size - a.size);
      if (large[0]) {
        if (large[0].cy > court.netY) {
          p1px.x = p1px.x * 0.85 + large[0].cx * 0.15;
          p1px.y = p1px.y * 0.85 + large[0].cy * 0.15;
        } else {
          p2px.x = p2px.x * 0.85 + large[0].cx * 0.15;
          p2px.y = p2px.y * 0.85 + large[0].cy * 0.15;
        }
        if (large[1]) {
          if (large[1].cy > court.netY) {
            p1px.x = p1px.x * 0.85 + large[1].cx * 0.15;
            p1px.y = p1px.y * 0.85 + large[1].cy * 0.15;
          } else {
            p2px.x = p2px.x * 0.85 + large[1].cx * 0.15;
            p2px.y = p2px.y * 0.85 + large[1].cy * 0.15;
          }
        }
      }
    }

    // ── Ball detection ────────────────────────────────────────────────────
    let ballPx: { x: number; y: number } | null = null;
    if (prevData) {
      ballPx = detectBall(d, prevData, court, lastBall);
    }

    if (ballPx) {
      const vx: number = lastBall ? ballPx.x - lastBall.x : 0;
      const vy: number = lastBall ? ballPx.y - lastBall.y : 0;
      lastBall = { ...ballPx, vx, vy };
      missBall = 0;
    } else {
      missBall++;
      if (lastBall && missBall <= 8) {
        // Physics extrapolation with gravity
        lastBall = {
          x: lastBall.x + lastBall.vx,
          y: lastBall.y + lastBall.vy + 0.8,
          vx: lastBall.vx * 0.94,
          vy: lastBall.vy + 0.8,
        };
        ballPx = { x: lastBall.x, y: lastBall.y };
      } else {
        lastBall = null;
        // Fall back to net midpoint
        ballPx = { x: (court.left + court.right) / 2, y: court.netY };
      }
    }

    // ── 3D projection ─────────────────────────────────────────────────────
    const [bx3, , bz3] = project3D(ballPx.x, ballPx.y, court, calib);
    const by3 = ballHeight(ballPx.y, court);

    const [p1x3, , p1z3] = project3D(p1px.x, p1px.y, court, calib);
    const [p2x3, , p2z3] = project3D(p2px.x, p2px.y, court, calib);

    // Speed
    const dx = bx3 - prevBall3D[0], dy = by3 - prevBall3D[1], dz = bz3 - prevBall3D[2];
    const spd = Math.sqrt(dx*dx + dy*dy + dz*dz) * (30 / FRAME_STEP) * 3.6;
    smoothSpeed = smoothSpeed * 0.6 + Math.min(spd, 280) * 0.4;
    prevBall3D = [bx3, by3, bz3];

    rawFrames.push({
      frame_index: fi,
      ball: { position: { x: r3(bx3), y: r3(by3), z: r3(bz3) }, is_occluded: !ballPx || missBall > 0 },
      players: [
        { id: 'player_bottom', position: { x: r3(p1x3), y: 0, z: r3(Math.max(0.5, p1z3)) } },
        { id: 'player_top',    position: { x: r3(p2x3), y: 0, z: r3(Math.min(-0.5, p2z3)) } },
      ],
      ball_speed_kmh: r3(smoothSpeed),
      spin_rate_rpm: Math.round(800 + Math.random() * 2400),
      hitter: null,
    });

    prevData = new Uint8ClampedArray(d);

    if (fi % 8 === 0) {
      onProgress(`Processing frame ${fi + 1}/${totalFrames}…`, 10 + (fi / totalFrames) * 80);
      await sleep(0);
    }
  }

  onProgress('Smoothing trajectories…', 92);
  await sleep(0);
  const smoothed = smooth(rawFrames);

  onProgress('Finalising…', 97);
  await sleep(0);
  const final = markHitters(smoothed);

  onProgress('Done!', 100);
  URL.revokeObjectURL(video.src);
  return { sequence: final };
}
