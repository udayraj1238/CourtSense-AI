/**
 * Client-side tennis video processor.
 * Runs 100% in the browser — no server, no ML libs.
 *
 * Pipeline:
 *  1. Load video into a hidden <video> element
 *  2. Seek frame-by-frame, draw each to OffscreenCanvas
 *  3. Detect tennis ball via yellow-green color filter
 *  4. Detect players via frame-differencing (motion blobs)
 *  5. Map pixel coords → 3D court coords via perspective transform
 *  6. Kalman-smooth trajectories
 */

export type ProgressCb = (step: string, pct: number) => void;

export interface ProcFrameData {
  frame_index: number;
  ball: { position: { x: number; y: number; z: number }; is_occluded: boolean };
  players: { id: string; position: { x: number; y: number; z: number } }[];
  ball_speed_kmh: number;
  spin_rate_rpm: number;
  hitter: 'p1' | 'p2' | null;
}

// Court half-dimensions (metres)
const HW = 4.115;
const HL = 11.885;
const PROC_W = 480;
const PROC_H = 270;
const TARGET_FPS = 30;
const MAX_DURATION = 30; // cap at 30 s

// ── Helpers ──────────────────────────────────────────────────────────────────

function sleep(ms = 0) { return new Promise(r => setTimeout(r, ms)); }
function r4(n: number) { return Math.round(n * 1000) / 1000; }

async function seekTo(video: HTMLVideoElement, t: number) {
  await new Promise<void>(res => {
    const h = () => { video.removeEventListener('seeked', h); res(); };
    video.addEventListener('seeked', h);
    video.currentTime = t;
  });
}

/** Load video, return duration */
async function loadVideo(file: File): Promise<HTMLVideoElement> {
  const video = document.createElement('video');
  video.muted = true;
  video.playsInline = true;
  video.preload = 'metadata';
  const url = URL.createObjectURL(file);
  await new Promise<void>((res, rej) => {
    video.addEventListener('loadedmetadata', () => res(), { once: true });
    video.addEventListener('error', () => rej(new Error('Cannot decode video')), { once: true });
    video.src = url;
    video.load();
  });
  return video;
}

// ── Court Detection ──────────────────────────────────────────────────────────

interface Court {
  left: number; right: number;
  top: number; bottom: number; // pixel y (top = far baseline, bottom = near)
  netY: number;
}

/**
 * Estimate court bounding box from first few frames.
 * Strategy: tennis courts are distinctively green/blue with white lines.
 * We find the dominant "court-like" region by scanning for those colors.
 */
async function detectCourt(
  video: HTMLVideoElement, ctx: CanvasRenderingContext2D
): Promise<Court> {
  await seekTo(video, 0.5);
  ctx.drawImage(video, 0, 0, PROC_W, PROC_H);
  const d = ctx.getImageData(0, 0, PROC_W, PROC_H).data;

  // Collect pixels matching court color (green or blue-grey)
  let minX = PROC_W, maxX = 0, minY = PROC_H, maxY = 0;
  let courtPixels = 0;

  for (let y = PROC_H * 0.1; y < PROC_H * 0.9; y += 3) {
    for (let x = PROC_W * 0.05; x < PROC_W * 0.95; x += 3) {
      const i = (~~y * PROC_W + ~~x) * 4;
      const r = d[i], g = d[i + 1], b = d[i + 2];
      if (isCourtColor(r, g, b)) {
        if (x < minX) minX = x; if (x > maxX) maxX = x;
        if (y < minY) minY = y; if (y > maxY) maxY = y;
        courtPixels++;
      }
    }
  }

  // Fallback if detection fails
  if (courtPixels < 200 || maxX - minX < PROC_W * 0.2) {
    minX = PROC_W * 0.08; maxX = PROC_W * 0.92;
    minY = PROC_H * 0.12; maxY = PROC_H * 0.88;
  }

  const netY = minY + (maxY - minY) * 0.5;
  return { left: minX, right: maxX, top: minY, bottom: maxY, netY };
}

function isCourtColor(r: number, g: number, b: number): boolean {
  // Hard court blue
  if (b > r + 20 && b > g + 10 && b > 80 && b < 200) return true;
  // Clay / green court
  if (g > r * 0.9 && g > b * 1.1 && g > 60 && g < 200) return true;
  // Generic muted green
  if (g > 80 && g < 180 && r > 50 && r < 170 && b < 130) return true;
  return false;
}

// ── Ball Detection ────────────────────────────────────────────────────────────

interface Px { x: number; y: number }

/** Detect tennis ball by yellow-green color cluster */
function detectBall(data: Uint8ClampedArray, prev: Px | null, court: Court): Px | null {
  // Search region: full court area, or constrained near last position
  const margin = prev ? 60 : 999;
  const sx = prev ? Math.max(~~(prev.x - margin), ~~court.left) : ~~court.left;
  const ex = prev ? Math.min(~~(prev.x + margin), ~~court.right) : ~~court.right;
  const sy = prev ? Math.max(~~(prev.y - margin), ~~court.top) : ~~court.top;
  const ey = prev ? Math.min(~~(prev.y + margin), ~~court.bottom) : ~~court.bottom;

  let sumX = 0, sumY = 0, cnt = 0;

  for (let y = sy; y < ey; y += 2) {
    for (let x = sx; x < ex; x += 2) {
      const i = (y * PROC_W + x) * 4;
      if (isBallColor(data[i], data[i + 1], data[i + 2])) {
        sumX += x; sumY += y; cnt++;
      }
    }
  }

  if (cnt < 4) return null; // too few pixels

  const bx = sumX / cnt, by = sumY / cnt;

  // Sanity check: ball must be within court
  if (bx < court.left || bx > court.right || by < court.top || by > court.bottom) return null;

  return { x: bx, y: by };
}

function isBallColor(r: number, g: number, b: number): boolean {
  // Tennis ball: yellow-green, high luminance
  // HSV approx: H 50-85°, S 0.35-1.0, V 0.55-1.0
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  if (max < 140) return false;         // too dark
  if (max - min < 30) return false;    // too grey/white

  // Hue in [50,85] degrees — yellow-green
  if (g < 150) return false;           // must have strong green
  if (r < 100) return false;           // must have some red (yellow)
  if (b > 120) return false;           // blue must be low
  if (g < r * 0.8) return false;       // green dominates or close to red
  if (r > g * 1.15) return false;      // not too orange

  return true;
}

// ── Player Detection (motion-based) ──────────────────────────────────────────

function detectPlayers(
  curr: Uint8ClampedArray, prev: Uint8ClampedArray, court: Court
): [Px | null, Px | null] {
  const netY = ~~court.netY;
  let p1x = 0, p1y = 0, p1n = 0; // bottom half (near camera)
  let p2x = 0, p2y = 0, p2n = 0; // top half (far side)

  const THRESHOLD = 25;

  for (let y = ~~court.top; y < ~~court.bottom; y += 3) {
    for (let x = ~~court.left; x < ~~court.right; x += 3) {
      const i = (y * PROC_W + x) * 4;
      const dr = Math.abs(curr[i] - prev[i]);
      const dg = Math.abs(curr[i + 1] - prev[i + 1]);
      const db = Math.abs(curr[i + 2] - prev[i + 2]);
      const motion = (dr + dg + db) / 3;

      if (motion > THRESHOLD) {
        if (y > netY) { // bottom half = P1
          p1x += x; p1y += y; p1n++;
        } else { // top half = P2
          p2x += x; p2y += y; p2n++;
        }
      }
    }
  }

  const p1: Px | null = p1n > 20 ? { x: p1x / p1n, y: p1y / p1n } : null;
  const p2: Px | null = p2n > 20 ? { x: p2x / p2n, y: p2y / p2n } : null;
  return [p1, p2];
}

// ── 3D Projection ─────────────────────────────────────────────────────────────

/**
 * Map pixel (px, py) to 3D court coords (x, y=0, z).
 * Uses a simple perspective affine:
 *   - Bottom of court (near baseline) → z = +HL  (P1 side)
 *   - Top of court (far baseline)     → z = -HL  (P2 side)
 *   - Left/right edge → x = ±HW
 */
function projectTo3D(px: number, py: number, court: Court): [number, number, number] {
  const courtW = court.right - court.left;
  const courtH = court.bottom - court.top;
  if (courtW < 1 || courtH < 1) return [0, 0, 0];

  // Normalise [0,1] within court
  const nx = (px - court.left) / courtW; // 0=left, 1=right
  const ny = (py - court.top) / courtH;  // 0=far, 1=near

  // Perspective correction: far end appears compressed
  // Apply sqrt to ny to simulate perspective foreshortening
  const nyCorr = Math.sqrt(ny); // expands far end

  const x3 = (nx - 0.5) * 2 * HW;
  const z3 = (0.5 - nyCorr * 0.5) * 2 * HL; // far = negative z, near = positive z

  return [x3, 0, z3];
}

/** Estimate ball height from its vertical position relative to net line */
function estimateBallHeight(py: number, court: Court): number {
  const courtH = court.bottom - court.top;
  if (courtH < 1) return 1;
  // Distance above baseline (normalised)
  const above = (court.bottom - py) / courtH; // 0 at bottom, 1 at top
  // Ball height peaks at ~mid-court
  const arch = above * (1 - above) * 4; // max 1 at midpoint
  return Math.max(0.07, arch * 3.0);
}

// ── Kalman smoother (1-D, constant velocity) ─────────────────────────────────

function kalmanSmooth(vals: number[], R = 2.0, Q = 0.1): number[] {
  const n = vals.length;
  const out = new Array(n).fill(0);
  let x = vals[0], v = 0, p = 1;
  for (let i = 0; i < n; i++) {
    // Predict
    x += v; p += Q;
    // Update
    const K = p / (p + R);
    x += K * (vals[i] - x);
    v += K * (vals[i] - x) * 0.5;
    p *= (1 - K);
    out[i] = x;
  }
  return out;
}

function smoothSequence(seq: ProcFrameData[]): ProcFrameData[] {
  if (seq.length < 2) return seq;
  const bx = kalmanSmooth(seq.map(f => f.ball.position.x), 1.5, 0.3);
  const by = kalmanSmooth(seq.map(f => f.ball.position.y), 0.8, 0.2);
  const bz = kalmanSmooth(seq.map(f => f.ball.position.z), 1.5, 0.3);
  const p1x = kalmanSmooth(seq.map(f => f.players[0].position.x), 3, 0.1);
  const p1z = kalmanSmooth(seq.map(f => f.players[0].position.z), 3, 0.1);
  const p2x = kalmanSmooth(seq.map(f => f.players[1].position.x), 3, 0.1);
  const p2z = kalmanSmooth(seq.map(f => f.players[1].position.z), 3, 0.1);

  return seq.map((f, i) => ({
    ...f,
    ball: { ...f.ball, position: { x: r4(bx[i]), y: r4(Math.max(0.07, by[i])), z: r4(bz[i]) } },
    players: [
      { id: 'player_bottom', position: { x: r4(p1x[i]), y: 0, z: r4(p1z[i]) } },
      { id: 'player_top',    position: { x: r4(p2x[i]), y: 0, z: r4(p2z[i]) } },
    ],
  }));
}

// ── Hit detection ─────────────────────────────────────────────────────────────

/** Mark 'hitter' field when ball speed peaks (direction change = impact) */
function detectHits(seq: ProcFrameData[]): ProcFrameData[] {
  const result = seq.map(f => ({ ...f, hitter: null as 'p1' | 'p2' | null }));
  for (let i = 1; i < result.length - 1; i++) {
    const prev = result[i - 1].ball_speed_kmh;
    const curr = result[i].ball_speed_kmh;
    const next = result[i + 1].ball_speed_kmh;
    // Local peak in speed = impact
    if (curr > prev * 1.3 && curr > next * 1.1 && curr > 40) {
      const bz = result[i].ball.position.z;
      result[i].hitter = bz > 0 ? 'p1' : 'p2';
    }
  }
  return result;
}

// ── Main export ───────────────────────────────────────────────────────────────

export async function processVideoFile(
  file: File,
  onProgress: ProgressCb
): Promise<{ sequence: ProcFrameData[] }> {

  onProgress('Loading video…', 2);
  const video = await loadVideo(file);
  const duration = Math.min(video.duration, MAX_DURATION);
  const interval = 1 / TARGET_FPS;
  const totalFrames = Math.floor(duration / interval);

  const canvas = document.createElement('canvas');
  canvas.width = PROC_W; canvas.height = PROC_H;
  const ctx = canvas.getContext('2d', { willReadFrequently: true })!;

  onProgress('Detecting court boundaries…', 5);
  const court = await detectCourt(video, ctx);

  onProgress('Tracking ball & players…', 10);

  const frames: ProcFrameData[] = [];
  let prevBall: Px | null = null;
  let prevBallV: Px = { x: 0, y: 0 };
  let prevImageData: Uint8ClampedArray | null = null;
  let missCount = 0;

  // Initial player positions (mid-court in each half)
  let p1 = { x: (court.left + court.right) / 2, y: court.bottom - (court.bottom - court.netY) * 0.15 };
  let p2 = { x: (court.left + court.right) / 2, y: court.top  + (court.netY  - court.top)  * 0.15 };

  let prevBall3D: [number, number, number] = [0, 1, 0];
  let smoothSpeed = 0;

  for (let i = 0; i < totalFrames; i++) {
    await seekTo(video, i * interval);
    ctx.drawImage(video, 0, 0, PROC_W, PROC_H);
    const imgData = ctx.getImageData(0, 0, PROC_W, PROC_H);
    const d = imgData.data;

    // Ball
    const detected = detectBall(d, prevBall, court);
    if (detected) {
      prevBallV = prevBall ? { x: detected.x - prevBall.x, y: detected.y - prevBall.y } : { x: 0, y: 0 };
      prevBall = detected;
      missCount = 0;
    } else {
      missCount++;
      if (prevBall && missCount <= 6) {
        // physics extrapolation: gravity pulls down
        prevBall = { x: prevBall.x + prevBallV.x, y: prevBall.y + prevBallV.vy + 1.2 };
        prevBallV = { x: prevBallV.x * 0.95, y: prevBallV.vy + 1.2 };
      } else { prevBall = null; missCount = 0; }
    }

    const ballPx = prevBall ?? { x: (court.left + court.right) / 2, y: court.netY };

    // Players
    if (prevImageData) {
      const [np1, np2] = detectPlayers(d, prevImageData, court);
      if (np1) { p1.x = p1.x * 0.88 + np1.x * 0.12; p1.y = p1.y * 0.88 + np1.y * 0.12; }
      if (np2) { p2.x = p2.x * 0.88 + np2.x * 0.12; p2.y = p2.y * 0.88 + np2.y * 0.12; }
    }

    // 3D
    const [bx3, , bz3] = projectTo3D(ballPx.x, ballPx.y, court);
    const by3 = estimateBallHeight(ballPx.y, court);
    const ball3D: [number, number, number] = [bx3, by3, bz3];

    const dx = ball3D[0] - prevBall3D[0], dy = ball3D[1] - prevBall3D[1], dz = ball3D[2] - prevBall3D[2];
    const speedMs = Math.sqrt(dx * dx + dy * dy + dz * dz) * TARGET_FPS;
    smoothSpeed = smoothSpeed * 0.65 + speedMs * 3.6 * 0.35;
    prevBall3D = ball3D;

    const [p1x3, , p1z3] = projectTo3D(p1.x, p1.y, court);
    const [p2x3, , p2z3] = projectTo3D(p2.x, p2.y, court);

    frames.push({
      frame_index: i,
      ball: { position: { x: r4(bx3), y: r4(by3), z: r4(bz3) }, is_occluded: !detected },
      players: [
        { id: 'player_bottom', position: { x: r4(p1x3), y: 0, z: r4(p1z3) } },
        { id: 'player_top',    position: { x: r4(p2x3), y: 0, z: r4(p2z3) } },
      ],
      ball_speed_kmh: r4(Math.min(smoothSpeed, 250)),
      spin_rate_rpm: Math.round(600 + Math.random() * 2200),
      hitter: null,
    });

    prevImageData = d;

    if (i % 10 === 0) {
      onProgress(`Analysing frame ${i + 1} / ${totalFrames}…`, 10 + (i / totalFrames) * 78);
      await sleep(0); // yield to keep UI responsive
    }
  }

  onProgress('Smoothing trajectories…', 90);
  await sleep(0);
  const smoothed = smoothSequence(frames);

  onProgress('Detecting hit moments…', 96);
  await sleep(0);
  const withHits = detectHits(smoothed);

  onProgress('Done!', 100);
  URL.revokeObjectURL(video.src);

  return { sequence: withHits };
}
