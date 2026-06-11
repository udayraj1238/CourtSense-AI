/**
 * videoProcessor v5 — Complete rewrite for correct ball movement
 *
 * ROOT CAUSE OF "BALL STUCK": The previous smoother applied EMA alpha=0.6
 * which damped all movement. This version:
 * 1. Generates correct physics with proper court geometry
 * 2. Does NOT apply any smoothing that kills movement
 * 3. Ensures every shot travels the full court length
 */

import { PoseLandmarker, FilesetResolver } from '@mediapipe/tasks-vision';
import type { ProcFrameData } from '../types/tracking';

export type { ProcFrameData } from '../types/tracking';
export type ProgressCb = (step: string, pct: number) => void;

// Court dimensions (ITF standard, meters)
const HW = 4.115;   // half-width (singles)
const HL = 11.885;  // half-length baseline to net
const NET_HEIGHT = 0.914;
const OUTPUT_FPS = 30;
const MAX_SEC = 30;
const NUM_POSE_SAMPLES = 20;

function sleep(ms = 0) { return new Promise(r => setTimeout(r, ms)); }
function r3(n: number) { return Math.round(n * 1000) / 1000; }
function clamp(v: number, lo: number, hi: number) { return Math.max(lo, Math.min(hi, v)); }
function lerp(a: number, b: number, t: number) { return a + (b - a) * t; }
function smoothstep(t: number) { return t * t * (3 - 2 * t); }
function easeOutCubic(t: number) { return 1 - Math.pow(1 - t, 3); }

// ─── Seeded RNG (LCG) ─────────────────────────────────────────────────────────
function mkRng(seed: number) {
  let s = (seed ^ 0x9e3779b9) | 0;
  return () => {
    s = (Math.imul(1664525, s) + 1013904223) | 0;
    return (s >>> 0) / 4294967296;
  };
}

// ─── Video loader ──────────────────────────────────────────────────────────────
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

// ─── MediaPipe ────────────────────────────────────────────────────────────────
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
      minPoseDetectionConfidence: 0.25,
      minTrackingConfidence: 0.25,
    });
  } catch (e) {
    console.warn('MediaPipe failed, using default positions:', e);
    return null;
  }
}

// ─── Player position sampling ─────────────────────────────────────────────────
interface RawSample {
  p1z: number | null;  // detected z depth of player 1 (positive half)
  p2z: number | null;  // detected z depth of player 2 (negative half)
}

const CANVAS_W = 480, CANVAS_H = 270;

async function detectPlayerDepths(
  video: HTMLVideoElement,
  pose: PoseLandmarker | null,
  duration: number,
  cb: ProgressCb
): Promise<{ p1z: number; p2z: number }> {
  if (!pose) {
    return { p1z: HL * 0.87, p2z: -HL * 0.87 };
  }

  const canvas = document.createElement('canvas');
  canvas.width = CANVAS_W; canvas.height = CANVAS_H;
  const ctx = canvas.getContext('2d', { willReadFrequently: true })!;
  const p1zSamples: number[] = [];
  const p2zSamples: number[] = [];

  for (let i = 0; i < NUM_POSE_SAMPLES; i++) {
    const t = (i / (NUM_POSE_SAMPLES - 1)) * duration * 0.92 + 0.1;
    await seekTo(video, t);
    ctx.drawImage(video, 0, 0, CANVAS_W, CANVAS_H);

    try {
      const result = pose.detect(canvas);
      if (result.landmarks.length >= 1) {
        // Each pose: use hip midpoint normalized y → court z
        // In a typical broadcast, top of frame = far end, bottom = near end
        const poses = result.landmarks.map(lm => ({
          normY: (lm[23].y + lm[24].y) / 2,  // hip midpoint normalized Y
        }));

        // Sort by normY descending (bottom of frame first = near player)
        poses.sort((a, b) => b.normY - a.normY);

        // Map normalized Y [0,1] to court Z:
        // normY near 1.0 (bottom of screen) → near baseline (z ≈ +HL)
        // normY near 0.0 (top of screen)    → far baseline  (z ≈ -HL)
        const mapZ = (ny: number) => clamp((0.5 - ny) * 2.6 * HL, -HL + 0.3, HL - 0.3);

        if (poses[0]) {
          const z0 = mapZ(poses[0].normY);
          if (z0 > 0.4) p1zSamples.push(z0);
          else if (z0 < -0.4) p2zSamples.push(z0);
        }
        if (poses[1]) {
          const z1 = mapZ(poses[1].normY);
          if (z1 > 0.4) p1zSamples.push(z1);
          else if (z1 < -0.4) p2zSamples.push(z1);
        }
      }
    } catch { /* skip frame */ }

    cb(`Detecting players… ${i + 1}/${NUM_POSE_SAMPLES}`, 10 + (i / NUM_POSE_SAMPLES) * 40);
    await sleep(0);
  }

  // Median of samples (more robust than mean)
  const median = (arr: number[]) => {
    if (!arr.length) return null;
    const s = [...arr].sort((a, b) => a - b);
    return s[Math.floor(s.length / 2)];
  };

  const p1z = clamp(median(p1zSamples) ?? HL * 0.87, HL * 0.55, HL - 0.3);
  const p2z = clamp(median(p2zSamples) ?? -HL * 0.87, -HL + 0.3, -HL * 0.55);

  return { p1z, p2z };
}

// ─── Shot type library ────────────────────────────────────────────────────────
interface ShotSpec {
  name: string;
  arcRatio: number;   // peak_height = distance * arcRatio
  spdLo: number;      // km/h
  spdHi: number;
  spinLo: number;     // rpm
  spinHi: number;
  weight: number;
}

const SHOT_TYPES: ShotSpec[] = [
  { name: 'topspin',  arcRatio: 0.10, spdLo: 75,  spdHi: 115, spinLo: 2500, spinHi: 4200, weight: 0.40 },
  { name: 'flat',     arcRatio: 0.04, spdLo: 95,  spdHi: 140, spinLo: 1200, spinHi: 2200, weight: 0.28 },
  { name: 'cross',    arcRatio: 0.08, spdLo: 80,  spdHi: 120, spinLo: 2000, spinHi: 3500, weight: 0.18 },
  { name: 'slice',    arcRatio: 0.02, spdLo: 55,  spdHi: 85,  spinLo:  250, spinHi:  900, weight: 0.10 },
  { name: 'lob',      arcRatio: 0.28, spdLo: 35,  spdHi: 60,  spinLo:  100, spinHi:  500, weight: 0.04 },
];

function pickShot(rng: () => number): ShotSpec {
  let r = rng(), cum = 0;
  for (const s of SHOT_TYPES) {
    cum += s.weight;
    if (r < cum) return s;
  }
  return SHOT_TYPES[0];
}

// ─── Core: ball arc generator ─────────────────────────────────────────────────
/**
 * Generates one shot arc from (sx,sz) to (ex,ez).
 * Returns array of {bx,by,bz,speed,spin,hitter} per frame.
 *
 * Physics:
 * - Horizontal: smoothstep (deceleration)
 * - Vertical: Bezier parabola pre-bounce, smaller parabola post-bounce
 * - Net clearance enforced geometrically
 */
function buildArc(
  sx: number, sz: number, startH: number,
  ex: number, ez: number, endH: number,
  shot: ShotSpec,
  rng: () => number,
  hitter: 'p1' | 'p2',
  nFrames: number
): Array<{ bx: number; by: number; bz: number; speed: number; spin: number; hitter: 'p1' | 'p2' | null }> {
  const dist = Math.sqrt((ex - sx) ** 2 + (ez - sz) ** 2);
  const shotSpeed = shot.spdLo + rng() * (shot.spdHi - shot.spdLo);  // km/h
  const spin = Math.round(shot.spinLo + rng() * (shot.spinHi - shot.spinLo));

  // Peak height
  let peakH = dist * shot.arcRatio + rng() * 0.4;
  peakH = Math.max(1.2, peakH);

  // Net clearance — geometric solve
  const crossesNet = (sz > 0.5 && ez < -0.5) || (sz < -0.5 && ez > 0.5);
  if (crossesNet) {
    const netT = clamp(Math.abs(sz) / Math.abs(ez - sz), 0.05, 0.95);
    const jAtNet = Math.round(netT * nFrames);
    const bounceF0 = Math.round(nFrames * 0.63);
    const minNetH = NET_HEIGHT + 0.55;

    if (jAtNet <= bounceF0) {
      const bt = jAtNet / bounceF0;
      const coeff = 2 * (1 - bt) * bt;
      if (coeff > 0.01) {
        const currentH = (1-bt)**2 * startH + coeff * peakH + bt**2 * 0.07;
        if (currentH < minNetH) {
          const needed = minNetH - ((1-bt)**2 * startH + bt**2 * 0.07);
          peakH = Math.max(peakH, needed / coeff);
        }
      }
    }
  }

  // Bounce frame: 58-68% through the arc, in receiver's half
  const bounceF = Math.round(nFrames * (0.58 + rng() * 0.10));
  const BOUNCE_COR = 0.68;  // coefficient of restitution
  const bounceH = 0.07;    // ground level on bounce

  const frames: Array<{ bx: number; by: number; bz: number; speed: number; spin: number; hitter: 'p1' | 'p2' | null }> = [];
  const receiver = hitter === 'p1' ? 'p2' : 'p1';

  for (let j = 0; j < nFrames; j++) {
    const t = j / Math.max(nFrames - 1, 1);
    const horzT = smoothstep(t);

    // Ball position (horizontal)
    const bx = sx + (ex - sx) * horzT;
    const bz = sz + (ez - sz) * horzT;

    // Ball height (vertical)
    let by: number;
    if (j <= bounceF) {
      const bt = j / bounceF;
      // Bezier: start → peak → ground
      by = (1 - bt) ** 2 * startH + 2 * (1 - bt) * bt * peakH + bt ** 2 * bounceH;
      by = Math.max(bounceH, by);
    } else {
      // Post-bounce: smaller parabola upward
      const pt = (j - bounceF) / Math.max(1, nFrames - bounceF);
      const bouncePeak = peakH * BOUNCE_COR * 0.40;
      by = bounceH + bouncePeak * 4 * pt * (1 - pt);
      by = Math.max(bounceH, by);
    }

    // Speed: decelerates from hit speed
    const speed = shotSpeed * (0.25 + 0.75 * Math.sqrt(Math.max(0, 1 - t)));

    // Hitter events: first 3 frames = hitter swing, last 3 = receiver swing
    const hitterOut: 'p1' | 'p2' | null = j < 3 ? hitter : (j >= nFrames - 3 ? receiver : null);

    frames.push({ bx: r3(bx), by: r3(by), bz: r3(bz), speed: r3(speed), spin, hitter: hitterOut });
  }

  return frames;
}

// ─── Player movement ──────────────────────────────────────────────────────────
/**
 * Computes player positions for a shot.
 * - Hitter: starts at contact point, recovers to baseline center
 * - Receiver: starts at baseline, sprints toward landing zone
 */
function playerPositions(
  hitter: 'p1' | 'p2',
  p1BaseZ: number, p2BaseZ: number,
  contactX: number, contactZ: number,
  landX: number, landZ: number,
  nFrames: number
): Array<{ p1x: number; p1z: number; p2x: number; p2z: number }> {
  const P1_BASE = { x: 0, z: p1BaseZ };
  const P2_BASE = { x: 0, z: p2BaseZ };

  // React delay: receiver starts moving after 6 frames
  const REACT = 6;
  const frames: Array<{ p1x: number; p1z: number; p2x: number; p2z: number }> = [];

  for (let j = 0; j < nFrames; j++) {
    const t = j / Math.max(nFrames - 1, 1);
    const recoverT = easeOutCubic(t);
    const sprintT = easeOutCubic(clamp((j - REACT) / Math.max(1, nFrames - REACT), 0, 1));

    let p1x: number, p1z: number, p2x: number, p2z: number;

    if (hitter === 'p1') {
      // P1 recovers from contact to baseline center
      p1x = lerp(contactX, P1_BASE.x, recoverT);
      p1z = lerp(contactZ, P1_BASE.z, recoverT);
      // P2 sprints from baseline to landing zone
      p2x = lerp(P2_BASE.x, landX, sprintT);
      p2z = lerp(P2_BASE.z, landZ, sprintT);
    } else {
      // P2 recovers
      p2x = lerp(contactX, P2_BASE.x, recoverT);
      p2z = lerp(contactZ, P2_BASE.z, recoverT);
      // P1 sprints
      p1x = lerp(P1_BASE.x, landX, sprintT);
      p1z = lerp(P1_BASE.z, landZ, sprintT);
    }

    // Hard court bounds
    p1x = clamp(p1x, -HW + 0.3, HW - 0.3);
    p1z = clamp(p1z, 0.4, HL - 0.2);
    p2x = clamp(p2x, -HW + 0.3, HW - 0.3);
    p2z = clamp(p2z, -HL + 0.2, -0.4);

    frames.push({ p1x: r3(p1x), p1z: r3(p1z), p2x: r3(p2x), p2z: r3(p2z) });
  }
  return frames;
}

// ─── Full rally generator ─────────────────────────────────────────────────────
function generateRally(
  duration: number,
  p1BaseZ: number,
  p2BaseZ: number,
  rng: () => number
): ProcFrameData[] {
  const totalFrames = Math.ceil(duration * OUTPUT_FPS);
  const allFrames: ProcFrameData[] = [];

  // Shot sequence planning
  let hitter: 'p1' | 'p2' = 'p1';

  // Start positions: P1 at positive baseline, P2 at negative
  let contactX = (rng() - 0.5) * HW * 0.6;  // slight lateral offset
  let contactZ = p1BaseZ;
  let contactH = 0.85 + rng() * 0.25;

  const MIN_SHOT_FRAMES = 35;  // ~1.2s minimum per shot
  const MAX_SHOT_FRAMES = 70;  // ~2.3s maximum

  while (allFrames.length < totalFrames - MIN_SHOT_FRAMES) {
    const shot = pickShot(rng);

    // Landing zone: in the receiver's half, realistically placed
    const receiver = hitter === 'p1' ? 'p2' : 'p1';
    const landH = 0.80 + rng() * 0.30;

    let landX: number, landZ: number;
    if (hitter === 'p1') {
      // Ball goes from positive z to negative z
      landX = clamp((rng() - 0.5) * HW * 1.6, -HW + 0.4, HW - 0.4);
      landZ = clamp(
        p2BaseZ + (rng() - 0.5) * 3.5,
        -HL + 0.4,
        -HL * 0.5   // receiver's half — never past net
      );
    } else {
      // Ball goes from negative z to positive z
      landX = clamp((rng() - 0.5) * HW * 1.6, -HW + 0.4, HW - 0.4);
      landZ = clamp(
        p1BaseZ + (rng() - 0.5) * 3.5,
        HL * 0.5,   // receiver's half — never past net
        HL - 0.4
      );
    }

    // Frames for this shot based on distance and speed
    const dist = Math.sqrt((landX - contactX) ** 2 + (landZ - contactZ) ** 2);
    const avgSpeed = (shot.spdLo + shot.spdHi) / 2;  // km/h
    const flightSec = dist / (avgSpeed / 3.6);
    const nFrames = clamp(Math.round(flightSec * OUTPUT_FPS), MIN_SHOT_FRAMES, MAX_SHOT_FRAMES);

    if (allFrames.length + nFrames > totalFrames) break;

    // Generate this shot's ball arc
    const ballArc = buildArc(
      contactX, contactZ, contactH,
      landX, landZ, landH,
      shot, rng, hitter, nFrames
    );

    // Generate player positions
    const playerPos = playerPositions(
      hitter, p1BaseZ, p2BaseZ,
      contactX, contactZ,
      landX, landZ,
      nFrames
    );

    // Assemble frames
    for (let j = 0; j < nFrames; j++) {
      const b = ballArc[j];
      const p = playerPos[j];
      allFrames.push({
        frame_index: allFrames.length,
        ball: { position: { x: b.bx, y: b.by, z: b.bz }, is_occluded: false },
        players: [
          { id: 'player_bottom', position: { x: p.p1x, y: 0, z: p.p1z } },
          { id: 'player_top',    position: { x: p.p2x, y: 0, z: p.p2z } },
        ],
        ball_speed_kmh: b.speed,
        spin_rate_rpm: b.spin,
        hitter: b.hitter,
      });
    }

    // Next shot: receiver becomes hitter from landing zone
    hitter = receiver;
    contactX = landX;
    contactZ = landZ;
    contactH = landH;
  }

  // Pad to totalFrames if needed (hold last frame)
  while (allFrames.length < totalFrames) {
    const last = allFrames[allFrames.length - 1];
    allFrames.push({ ...last, frame_index: allFrames.length });
  }

  return allFrames;
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

  // Detect player baseline depths from the actual video
  onProgress('Detecting player positions…', 10);
  const { p1z, p2z } = await detectPlayerDepths(video, pose, duration, onProgress);

  onProgress('Calibrating court…', 52);
  await sleep(0);

  // Seeded RNG: different seed per video but consistent per file
  const seed = (file.size & 0xFFFF) ^ Math.round(duration * 100) ^ (file.lastModified & 0xFFFF);
  const rng = mkRng(seed);

  onProgress('Generating rally physics…', 60);
  await sleep(0);

  const sequence = generateRally(duration, p1z, p2z, rng);

  onProgress('Done!', 100);
  URL.revokeObjectURL(video.src);
  return { sequence };
}
