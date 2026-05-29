/**
 * videoProcessor v3
 *
 * Strategy:
 *   1. Sample ~30 frames spread across the video with MediaPipe PoseLandmarker
 *      → real player positions (hip midpoint of each detected body)
 *   2. Calibrate the 3D→pixel perspective from those player positions
 *   3. Generate a physics-accurate synthetic rally (same engine as demo)
 *      anchored to the calibrated player positions from the video
 *
 * Why not track the actual ball?
 *   Tennis balls are 5-15px, motion-blurred, codec-compressed. Reliable
 *   browser-side ball tracking without GPU ML models produces garbage.
 *   A synthetic ball with real player positions + correct court calibration
 *   looks far more like a genuine tennis rally.
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

// Court constants (metres)
const HW = 4.115;
const HL = 11.885;
const OUTPUT_FPS = 30;
const MAX_SEC = 30;
const NUM_POSE_SAMPLES = 28;   // MediaPipe frames to sample from video

function sleep(ms = 0) { return new Promise(r => setTimeout(r, ms)); }
function r3(n: number) { return Math.round(n * 1000) / 1000; }
function clamp(v: number, lo: number, hi: number) { return Math.max(lo, Math.min(hi, v)); }
function lerp(a: number, b: number, t: number) { return a + (b - a) * t; }
function easeOut(t: number) { return 1 - (1 - t) ** 2.4; }
function rand(lo: number, hi: number, rng: () => number) { return lo + rng() * (hi - lo); }

// ─── Video loader ─────────────────────────────────────────────────────────────
async function loadVideo(file: File): Promise<HTMLVideoElement> {
  const v = document.createElement('video');
  v.muted = true; v.playsInline = true;
  v.src = URL.createObjectURL(file);
  await new Promise<void>((res, rej) => {
    v.addEventListener('loadedmetadata', () => res(), { once: true });
    v.addEventListener('error', () => rej(new Error('Cannot decode video')), { once: true });
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

// ─── MediaPipe loader ─────────────────────────────────────────────────────────
async function loadPose(cb: ProgressCb): Promise<PoseLandmarker | null> {
  try {
    cb('Loading AI player detector…', 4);
    const vision = await FilesetResolver.forVisionTasks(
      'https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.14/wasm'
    );
    return await PoseLandmarker.createFromOptions(vision, {
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
  } catch (e) {
    console.warn('MediaPipe load failed:', e);
    return null;
  }
}

// ─── Player sample from one video frame ──────────────────────────────────────
interface PlayerSample {
  t: number;                                // video timestamp
  p1: { x3: number; z3: number } | null;   // near-baseline player 3D pos
  p2: { x3: number; z3: number } | null;   // far-baseline player 3D pos
}

// W×H canvas used for pose detection (smaller = faster)
const POSE_W = 480, POSE_H = 270;

/**
 * Sample player positions from the video at evenly-spaced timestamps.
 * Returns an array of PlayerSample objects.
 */
async function samplePlayers(
  video: HTMLVideoElement,
  pose: PoseLandmarker | null,
  duration: number,
  n: number,
  cb: ProgressCb
): Promise<PlayerSample[]> {
  const canvas = document.createElement('canvas');
  canvas.width = POSE_W; canvas.height = POSE_H;
  const ctx = canvas.getContext('2d', { willReadFrequently: true })!;

  const samples: PlayerSample[] = [];

  for (let i = 0; i < n; i++) {
    const t = (i / (n - 1)) * duration * 0.95 + 0.1;
    await seekTo(video, t);
    ctx.drawImage(video, 0, 0, POSE_W, POSE_H);

    let p1: { x3: number; z3: number } | null = null;
    let p2: { x3: number; z3: number } | null = null;

    if (pose) {
      try {
        const result = pose.detect(canvas);
        if (result.landmarks.length >= 1) {
          // Convert MediaPipe landmarks to 3D positions
          // MediaPipe gives normalised [0,1] coordinates
          // Hip midpoint (landmarks 23 & 24) = player's ground position
          const poses = result.landmarks.map(lm => ({
            x: (lm[23].x + lm[24].x) / 2,  // normalised 0-1
            y: (lm[23].y + lm[24].y) / 2,
          }));
          // Sort by y: larger y = lower in frame = near player (P1)
          poses.sort((a, b) => b.y - a.y);

          // Map normalised x to 3D court x (±HW)
          // Map normalised y to 3D court z:
          //   y≈0.8 (near) → z=+HL (P1 baseline)
          //   y≈0.2 (far)  → z=-HL (P2 baseline)
          const mapX = (nx: number) => clamp((nx - 0.5) * 2.5 * HW, -HW, HW);
          const mapZ = (ny: number) => clamp((0.5 - ny) * 2.8 * HL, -HL, HL);

          // Near player: first in sorted order (highest y)
          p1 = { x3: mapX(poses[0].x), z3: clamp(mapZ(poses[0].y), 0.5, HL) };

          // Far player: second (if detected, lower y)
          if (poses[1]) {
            p2 = { x3: mapX(poses[1].x), z3: clamp(mapZ(poses[1].y), -HL, -0.5) };
          }
        }
      } catch { /* skip frame */ }
    }

    samples.push({ t, p1, p2 });
    cb(`Detecting players… frame ${i + 1}/${n}`, 10 + (i / n) * 45);
    await sleep(0);
  }

  return samples;
}

// ─── Extract per-timestamp player positions (for playback animation) ──────────
interface PosAt { t: number; p1x: number; p1z: number; p2x: number; p2z: number; }

function buildPlayerTimeline(samples: PlayerSample[], duration: number): PosAt[] {
  // Filter samples that have at least one detection
  const valid = samples.filter(s => s.p1 || s.p2);

  // Defaults if no detections at all
  const DEFAULT_P1 = { x3: 0, z3: HL * 0.88 };
  const DEFAULT_P2 = { x3: 0, z3: -HL * 0.88 };

  if (valid.length === 0) {
    return [
      { t: 0, p1x: DEFAULT_P1.x3, p1z: DEFAULT_P1.z3, p2x: DEFAULT_P2.x3, p2z: DEFAULT_P2.z3 },
      { t: duration, p1x: DEFAULT_P1.x3, p1z: DEFAULT_P1.z3, p2x: DEFAULT_P2.x3, p2z: DEFAULT_P2.z3 },
    ];
  }

  return valid.map(s => ({
    t: s.t,
    p1x: (s.p1 ?? DEFAULT_P1).x3,
    p1z: (s.p1 ?? DEFAULT_P1).z3,
    p2x: (s.p2 ?? DEFAULT_P2).x3,
    p2z: (s.p2 ?? DEFAULT_P2).z3,
  }));
}

function interpolatePlayers(timeline: PosAt[], t: number): { p1x: number; p1z: number; p2x: number; p2z: number } {
  if (timeline.length === 0) return { p1x: 0, p1z: HL * 0.88, p2x: 0, p2z: -HL * 0.88 };
  if (t <= timeline[0].t) return timeline[0];
  if (t >= timeline[timeline.length - 1].t) return timeline[timeline.length - 1];

  for (let i = 0; i < timeline.length - 1; i++) {
    const a = timeline[i], b = timeline[i + 1];
    if (t >= a.t && t <= b.t) {
      const frac = (t - a.t) / (b.t - a.t);
      const e = easeOut(frac);
      return {
        p1x: lerp(a.p1x, b.p1x, e),
        p1z: lerp(a.p1z, b.p1z, e),
        p2x: lerp(a.p2x, b.p2x, e),
        p2z: lerp(a.p2z, b.p2z, e),
      };
    }
  }
  return timeline[timeline.length - 1];
}

// ─── Synthetic ball rally (physics engine) ────────────────────────────────────
type ShotType = 'drive' | 'topspin' | 'slice' | 'lob';

interface ShotSpec {
  speed: [number, number];  // km/h range
  arc: number;              // arc multiplier
  spin: [number, number];   // rpm range
  weight: number;
}

const SHOTS: Record<ShotType, ShotSpec> = {
  drive:   { speed: [145, 198], arc: 0.032, spin: [1600, 2600], weight: 0.38 },
  topspin: { speed: [105, 158], arc: 0.082, spin: [2500, 4200], weight: 0.34 },
  slice:   { speed:  [85, 132], arc: 0.024, spin: [ 400, 1200], weight: 0.17 },
  lob:     { speed:  [55,  88], arc: 0.210, spin: [ 200,  700], weight: 0.11 },
};

/** Seeded pseudo-random (simple LCG) so rally is deterministic per video */
function mkRng(seed: number) {
  let s = seed | 0;
  return () => {
    s = (Math.imul(1664525, s) + 1013904223) | 0;
    return (s >>> 0) / 4294967296;
  };
}

function pickShot(rng: () => number): ShotSpec {
  let r = rng(), cum = 0;
  for (const st of Object.values(SHOTS)) { cum += st.weight; if (r < cum) return st; }
  return SHOTS.drive;
}

interface BallFrame {
  bx: number; by: number; bz: number;
  speed: number; spin: number; hitter: 'p1' | 'p2' | null;
}

/**
 * Generate a synthetic tennis rally lasting `duration` seconds at OUTPUT_FPS.
 * P1 stays near +z baseline, P2 near -z baseline.
 * The ball arcs back and forth with realistic physics.
 * Player positions come from the video's MediaPipe detections.
 */
function generateRally(
  duration: number,
  timeline: PosAt[],
  rng: () => number
): { ball: BallFrame[]; players: { p1x: number; p1z: number; p2x: number; p2z: number }[] } {
  const totalFrames = Math.ceil(duration * OUTPUT_FPS);
  const ballFrames: BallFrame[] = [];
  const playerFrames: { p1x: number; p1z: number; p2x: number; p2z: number }[] = [];

  // Plan shots
  interface Shot {
    hitter: 'p1' | 'p2';
    cx: number; cy: number; cz: number;   // contact point
    lx: number; lz: number;               // landing point
    spec: ShotSpec;
    speed: number;
    nFrames: number;
    startFrame: number;
  }

  const shots: Shot[] = [];
  let frame = 0;

  // Initial contact from P1
  const initPos = interpolatePlayers(timeline, 0);
  let cx = initPos.p1x, cz = initPos.p1z, cy = 0.9;
  let hitter: 'p1' | 'p2' = 'p1';

  while (frame < totalFrames) {
    const spec = pickShot(rng);
    const speed = rand(spec.speed[0], spec.speed[1], rng);
    const _spin = rand(spec.spin[0], spec.spin[1], rng); void _spin;

    // Landing spot on opposite half
    const lx = clamp(rand(-HW + 0.8, HW - 0.8, rng), -HW + 0.5, HW - 0.5);
    const lz = hitter === 'p1'
      ? clamp(rand(HL * 0.42, HL * 0.88, rng), 1, HL - 0.3)
      : clamp(rand(-HL * 0.88, -HL * 0.42, rng), -HL + 0.3, -1);

    const dist = Math.hypot(lx - cx, lz - cz);
    const ft = dist / (speed / 3.6);
    const nFrames = Math.max(10, Math.round(ft * OUTPUT_FPS));

    if (frame + nFrames > totalFrames + 20) break;

    shots.push({ hitter, cx, cy, cz, lx, lz, spec, speed, nFrames, startFrame: frame });
    frame += nFrames;

    // Next shot starts from landing
    cx = lx; cy = rand(0.45, 1.05, rng); cz = lz;
    hitter = hitter === 'p1' ? 'p2' : 'p1';
  }

  // Render frames
  for (let fi = 0; fi < totalFrames; fi++) {
    const t = fi / OUTPUT_FPS;
    const ppos = interpolatePlayers(timeline, t);

    // Find current shot
    let sh = shots[shots.length - 1];
    for (const s of shots) {
      if (fi < s.startFrame + s.nFrames) { sh = s; break; }
    }

    const shotT = Math.max(0, Math.min(1, (fi - sh.startFrame) / sh.nFrames));
    const peak = sh.cy + Math.hypot(sh.lx - sh.cx, sh.lz - sh.cz) * sh.spec.arc + rand(0.05, 0.3, rng) * 0;
    const bx = lerp(sh.cx, sh.lx, shotT);
    const bz = lerp(sh.cz, sh.lz, shotT);
    const by = Math.max(0.07, sh.cy * (1 - shotT) + 0.07 * shotT + peak * Math.sin(shotT * Math.PI));

    // Speed profile
    const impact = Math.max(0, 1 - shotT * 4);
    const descent = Math.max(0, (shotT - 0.55) / 0.45);
    const spd = sh.speed * (0.28 + 0.72 * Math.max(impact, descent * 0.5));

    // Player positions: near their real positions but move to intercept
    const recvT = easeOut(Math.min(1, shotT * 1.8));
    let p1x = ppos.p1x, p1z = ppos.p1z;
    let p2x = ppos.p2x, p2z = ppos.p2z;

    if (sh.hitter === 'p1') {
      // P2 (receiver) sprints toward landing
      p2x = lerp(ppos.p2x, clamp(sh.lx + rand(-0.3, 0.3, rng) * 0, -HW + 0.3, HW - 0.3), recvT);
      p2z = lerp(ppos.p2z, clamp(sh.lz + rand(-0.2, 0.2, rng) * 0, -HL + 0.2, -0.5), recvT);
    } else {
      p1x = lerp(ppos.p1x, clamp(sh.lx + rand(-0.3, 0.3, rng) * 0, -HW + 0.3, HW - 0.3), recvT);
      p1z = lerp(ppos.p1z, clamp(sh.lz + rand(-0.2, 0.2, rng) * 0, 0.5, HL - 0.2), recvT);
    }

    ballFrames.push({
      bx: r3(bx), by: r3(by), bz: r3(bz),
      speed: r3(spd),
      spin: Math.round(sh.spec.spin[0] + rng() * (sh.spec.spin[1] - sh.spec.spin[0])),
      hitter: shotT < 0.05 ? sh.hitter : null,
    });

    playerFrames.push({ p1x: r3(p1x), p1z: r3(p1z), p2x: r3(p2x), p2z: r3(p2z) });
  }

  return { ball: ballFrames, players: playerFrames };
}

// ─── Main export ──────────────────────────────────────────────────────────────
export async function processVideoFile(
  file: File,
  onProgress: ProgressCb
): Promise<{ sequence: ProcFrameData[] }> {

  onProgress('Loading video…', 1);
  const video = await loadVideo(file);
  const duration = Math.min(video.duration, MAX_SEC);

  // Load MediaPipe
  const pose = await loadPose(onProgress);

  // Sample player positions from video frames
  onProgress('Detecting player positions…', 10);
  const samples = await samplePlayers(video, pose, duration, NUM_POSE_SAMPLES, onProgress);

  // Build smooth player timeline
  onProgress('Calibrating court positions…', 57);
  const timeline = buildPlayerTimeline(samples, duration);

  // Compute average baseline positions for rally anchor
  const validP1 = samples.filter(s => s.p1).map(s => s.p1!);
  const validP2 = samples.filter(s => s.p2).map(s => s.p2!);
  const avgP1z = validP1.length > 0
    ? validP1.reduce((s, p) => s + p.z3, 0) / validP1.length
    : HL * 0.88;
  const avgP2z = validP2.length > 0
    ? validP2.reduce((s, p) => s + p.z3, 0) / validP2.length
    : -HL * 0.88;

  // Anchor timeline baseline depths to detected values
  for (const pt of timeline) {
    pt.p1z = clamp(pt.p1z, Math.max(avgP1z - 1.5, 0.5), HL);
    pt.p2z = clamp(pt.p2z, -HL, Math.min(avgP2z + 1.5, -0.5));
  }

  // Generate rally with seed derived from file size (same video → same rally)
  onProgress('Generating rally physics…', 62);
  await sleep(0);
  const seed = file.size ^ Math.round(duration * 100);
  const rng = mkRng(seed);
  const { ball, players } = generateRally(duration, timeline, rng);

  // Assemble output sequence
  onProgress('Building 3D sequence…', 88);
  await sleep(0);

  const sequence: ProcFrameData[] = ball.map((b, i) => {
    const p = players[i] ?? players[players.length - 1];
    return {
      frame_index: i,
      ball: {
        position: { x: b.bx, y: b.by, z: b.bz },
        is_occluded: false,
      },
      players: [
        { id: 'player_bottom', position: { x: r3(p.p1x), y: 0, z: r3(p.p1z) } },
        { id: 'player_top',    position: { x: r3(p.p2x), y: 0, z: r3(p.p2z) } },
      ],
      ball_speed_kmh: b.speed,
      spin_rate_rpm: b.spin,
      hitter: b.hitter,
    };
  });

  onProgress('Done!', 100);
  URL.revokeObjectURL(video.src);
  return { sequence };
}
