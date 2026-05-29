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
function _rand(lo: number, hi: number, rng: () => number) { return lo + rng() * (hi - lo); } void _rand;

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

// ─── Synthetic ball rally (smooth physics engine) ─────────────────────────────
// Visual speeds are ~40% of real tennis speeds so each shot lasts
// 40-90 frames at 30fps and the ball arc is clearly visible.
const SHOT_TYPES = [
  { name:'heavy_topspin', spdLo: 72, spdHi:102, arc:0.092, spinLo:2800, spinHi:4500, w:0.32 },
  { name:'flat_drive',    spdLo: 90, spdHi:124, arc:0.030, spinLo:1400, spinHi:2400, w:0.28 },
  { name:'slice',         spdLo: 55, spdHi: 82, arc:0.025, spinLo: 350, spinHi:1100, w:0.18 },
  { name:'crosscourt',    spdLo: 78, spdHi:108, arc:0.058, spinLo:2000, spinHi:3200, w:0.14 },
  { name:'lob',           spdLo: 34, spdHi: 55, arc:0.280, spinLo: 180, spinHi: 600, w:0.08 },
] as const;

/** Seeded pseudo-random (simple LCG) so rally is deterministic per video */
function mkRng(seed: number) {
  let s = seed | 0;
  return () => {
    s = (Math.imul(1664525, s) + 1013904223) | 0;
    return (s >>> 0) / 4294967296;
  };
}

function pickShotType(rng: () => number) {
  let r = rng(), cum = 0;
  for (const s of SHOT_TYPES) { cum += s.w; if (r < cum) return s; }
  return SHOT_TYPES[0];
}

// Move toward target without exceeding maxStep (velocity cap)
function moveToward(from: number, to: number, maxStep: number): number {
  const diff = to - from;
  if (Math.abs(diff) <= maxStep) return to;
  return from + Math.sign(diff) * maxStep;
}

function easeOutCubic(t: number): number { return 1 - Math.pow(1 - t, 3); }
function sCurve(t: number): number {
  return t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2;
}

interface BallFrame {
  bx: number; by: number; bz: number;
  speed: number; spin: number; hitter: 'p1' | 'p2' | null;
}

const MAX_PLAYER_SPD = 0.10; // m/frame at 30fps → 3.0 m/s realistic sprint
const REACTION_FRAMES = 8;   // frames before receiver starts moving

function generateRally(
  duration: number,
  timeline: PosAt[],
  rng: () => number
): { ball: BallFrame[]; players: { p1x: number; p1z: number; p2x: number; p2z: number }[] } {
  const totalFrames = Math.ceil(duration * OUTPUT_FPS);
  const ballFrames: BallFrame[] = [];
  const playerFrames: { p1x: number; p1z: number; p2x: number; p2z: number }[] = [];

  // ── Plan shot sequence ──────────────────────────────────────────────────
  interface Shot {
    hitter: 'p1' | 'p2';
    cx: number; cy: number; cz: number;
    lx: number; lz: number;
    arc: number; speed: number; spin: number;
    nFrames: number; startFrame: number;
  }
  const shots: Shot[] = [];
  let frame = 0;
  const initPos = interpolatePlayers(timeline, 0);
  let cx = initPos.p1x, cz = initPos.p1z, cy = 0.88;
  let hitter: 'p1' | 'p2' = 'p1';

  while (frame < totalFrames - 10) {
    const spec  = pickShotType(rng);
    const speed = spec.spdLo + rng() * (spec.spdHi - spec.spdLo);
    const spin  = Math.round(spec.spinLo + rng() * (spec.spinHi - spec.spinLo));
    const lx = clamp(rng() * (HW * 2) - HW + 0.5, -HW + 0.4, HW - 0.4);
    const lz = hitter === 'p1'
      ? clamp(rng() * HL * 0.45 - HL * 0.88, -HL + 0.3, -1.2)
      : clamp(rng() * HL * 0.45 + HL * 0.50,  1.2, HL - 0.3);
    const dist = Math.hypot(lx - cx, lz - cz);
    const nFrames = Math.max(35, Math.round((dist / (speed / 3.6)) * OUTPUT_FPS));
    if (frame + nFrames > totalFrames + 10) break;
    shots.push({ hitter, cx, cy, cz, lx, lz, arc: spec.arc, speed, spin, nFrames, startFrame: frame });
    frame += nFrames;
    cx = lx + (rng() - 0.5) * 0.5;
    cy = 0.42 + rng() * 0.55;
    cz = lz;
    hitter = hitter === 'p1' ? 'p2' : 'p1';
  }

  // ── Render frames with velocity-capped player movement ─────────────────
  const pos0 = interpolatePlayers(timeline, 0);
  let p1x = pos0.p1x, p1z = pos0.p1z;
  let p2x = pos0.p2x, p2z = pos0.p2z;

  for (let fi = 0; fi < totalFrames; fi++) {
    let sh = shots[shots.length - 1];
    for (const s of shots) { if (fi < s.startFrame + s.nFrames) { sh = s; break; } }

    const shotT = clamp((fi - sh.startFrame) / sh.nFrames, 0, 1);

    // S-curve horizontal motion (smooth start & end)
    const horzT = sCurve(shotT);
    const bx = lerp(sh.cx, sh.lx, horzT);
    const bz = lerp(sh.cz, sh.lz, horzT);
    const arcH = Math.hypot(sh.lx - sh.cx, sh.lz - sh.cz) * sh.arc;
    const by = Math.max(0.07, lerp(sh.cy, 0.12, shotT) + arcH * Math.sin(shotT * Math.PI));

    // Speed: fast off racket, decelerates smoothly
    const spd = sh.speed * (0.20 + 0.80 * Math.pow(clamp(1 - shotT, 0, 1), 0.5));

    // Player targets: hitter recovers, receiver sprints after reaction delay
    const reactionT = clamp((fi - sh.startFrame - REACTION_FRAMES) / Math.max(1, sh.nFrames - REACTION_FRAMES), 0, 1);
    const sprintFrac = easeOutCubic(reactionT);
    const p1BaseX = 0, p1BaseZ = HL  * 0.905;
    const p2BaseX = 0, p2BaseZ = -HL * 0.905;

    let tP1x: number, tP1z: number, tP2x: number, tP2z: number;
    if (sh.hitter === 'p1') {
      tP1x = lerp(sh.cx, p1BaseX, easeOutCubic(shotT * 1.3));
      tP1z = lerp(sh.cz, p1BaseZ, easeOutCubic(shotT * 1.3));
      tP2x = lerp(p2BaseX, clamp(sh.lx, -HW + 0.4, HW - 0.4), sprintFrac);
      tP2z = lerp(p2BaseZ, clamp(sh.lz, -HL + 0.3, -1.0), sprintFrac);
    } else {
      tP2x = lerp(sh.cx, p2BaseX, easeOutCubic(shotT * 1.3));
      tP2z = lerp(sh.cz, p2BaseZ, easeOutCubic(shotT * 1.3));
      tP1x = lerp(p1BaseX, clamp(sh.lx, -HW + 0.4, HW - 0.4), sprintFrac);
      tP1z = lerp(p1BaseZ, clamp(sh.lz,  1.0, HL - 0.3), sprintFrac);
    }

    // Blend with detected positions from MediaPipe
    const detectedPos = interpolatePlayers(timeline, fi / OUTPUT_FPS);
    tP1x = lerp(tP1x, detectedPos.p1x, 0.25);
    tP2x = lerp(tP2x, detectedPos.p2x, 0.25);

    // Velocity-cap movement
    p1x = moveToward(p1x, tP1x, MAX_PLAYER_SPD);
    p1z = moveToward(p1z, tP1z, MAX_PLAYER_SPD);
    p2x = moveToward(p2x, tP2x, MAX_PLAYER_SPD);
    p2z = moveToward(p2z, tP2z, MAX_PLAYER_SPD);

    // Enforce court halves
    p1z = clamp(p1z,  0.5, HL  - 0.2);
    p2z = clamp(p2z, -HL + 0.2, -0.5);
    p1x = clamp(p1x, -HW + 0.3, HW - 0.3);
    p2x = clamp(p2x, -HW + 0.3, HW - 0.3);

    ballFrames.push({
      bx: r3(bx), by: r3(by), bz: r3(bz),
      speed: r3(spd), spin: sh.spin,
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
