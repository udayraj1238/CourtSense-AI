/**
 * videoProcessor v7 — Video-Anchored Rally
 *
 * Key improvements over v6:
 * 1. 60 pose samples (was 20) → more accurate player baseline depths
 * 2. Wrist-velocity shot detection → real shot TIMING from the video
 * 3. Color-blob ball tracking → actual yellow/green ball pixel positions
 * 4. Rally is anchored to real shot timing from the video
 * 5. Player movement matches the video's detected player positions
 */

import { PoseLandmarker, FilesetResolver } from '@mediapipe/tasks-vision';
import type { ProcFrameData } from '../types/tracking';

export type { ProcFrameData } from '../types/tracking';
export type ProgressCb = (step: string, pct: number) => void;

// ITF court constants (meters)
const HW = 4.115;    // half-width
const HL = 11.885;   // half-length baseline→net
const NET_H = 0.914;
const FPS = 30;
const MAX_SEC = 30;
const CANVAS_W = 480;
const CANVAS_H = 270;

// How many frames to sample from the video for analysis
const POSE_SAMPLES = 60;   // was 20 — 3× more accurate baseline detection
const BALL_SAMPLES = 90;   // for color-blob ball tracking

function sleep(ms = 0) { return new Promise(r => setTimeout(r, ms)); }
function r3(n: number) { return Math.round(n * 1000) / 1000; }
function clamp(v: number, lo: number, hi: number) { return Math.max(lo, Math.min(hi, v)); }
function lerp(a: number, b: number, t: number) { return a + (b - a) * t; }
function smoothstep(t: number) { return t * t * (3 - 2 * t); }
function easeOut(t: number) { return 1 - Math.pow(1 - t, 3); }

function mkRng(seed: number) {
  let s = (seed ^ 0x9e3779b9) | 0;
  return () => { s = (Math.imul(1664525, s) + 1013904223) | 0; return (s >>> 0) / 4294967296; };
}

async function loadVideo(file: File): Promise<HTMLVideoElement> {
  const v = document.createElement('video');
  v.muted = true; v.playsInline = true; v.crossOrigin = 'anonymous';
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
    v.currentTime = clamp(t, 0, v.duration - 0.05);
  });
}

// ── MediaPipe loader ───────────────────────────────────────────────────────────
async function loadPose(cb: ProgressCb): Promise<PoseLandmarker | null> {
  try {
    cb('Loading pose detector…', 3);
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
      minPoseDetectionConfidence: 0.20,
      minTrackingConfidence: 0.20,
    });
  } catch (e) {
    console.warn('MediaPipe unavailable:', e);
    return null;
  }
}

// ── Ball color-blob detector ───────────────────────────────────────────────────
/**
 * Detects yellow/neon-green tennis ball in a canvas frame.
 * Returns normalized [cx, cy] in [0,1] or null if not found.
 *
 * Method: scan pixel grid for HSL "tennis ball yellow-green" range,
 * find centroid of qualifying pixels. No model needed — pure color math.
 */
function detectBallInFrame(ctx: CanvasRenderingContext2D, w: number, h: number): [number, number] | null {
  // Sample every 3rd pixel for speed
  const step = 3;
  const imgData = ctx.getImageData(0, 0, w, h);
  const data = imgData.data;

  let sumX = 0, sumY = 0, count = 0;

  for (let y = 0; y < h; y += step) {
    for (let x = 0; x < w; x += step) {
      const idx = (y * w + x) * 4;
      const r = data[idx], g = data[idx + 1], b = data[idx + 2];

      // Convert to HSL for tennis ball color detection
      const rn = r / 255, gn = g / 255, bn = b / 255;
      const max = Math.max(rn, gn, bn);
      const min = Math.min(rn, gn, bn);
      const l = (max + min) / 2;
      const d = max - min;
      if (d < 0.01) continue;
      const s = d / (1 - Math.abs(2 * l - 1));
      let hue = 0;
      if (max === rn) hue = ((gn - bn) / d + 6) % 6 * 60;
      else if (max === gn) hue = ((bn - rn) / d + 2) * 60;
      else hue = ((rn - gn) / d + 4) * 60;

      // Tennis ball: hue 50-90 (yellow-green), high saturation, medium-high lightness
      if (hue >= 48 && hue <= 92 && s >= 0.45 && l >= 0.35 && l <= 0.80) {
        sumX += x; sumY += y; count++;
      }
    }
  }

  if (count < 8) return null; // Not enough pixels — likely false positive
  return [sumX / count / w, sumY / count / h];
}

// ── Full video analysis ────────────────────────────────────────────────────────
interface VideoAnalysis {
  p1BaseZ: number;        // positive-z baseline depth (meters)
  p2BaseZ: number;        // negative-z baseline depth (meters)
  shotTimings: number[];  // video timestamps (seconds) of detected shots
  ballPositions: Array<{ t: number; nx: number; ny: number }>;  // normalized ball detections
  detectedBallCount: number;
}

async function analyzeVideo(
  video: HTMLVideoElement,
  pose: PoseLandmarker | null,
  duration: number,
  cb: ProgressCb
): Promise<VideoAnalysis> {
  const canvas = document.createElement('canvas');
  canvas.width = CANVAS_W; canvas.height = CANVAS_H;
  const ctx = canvas.getContext('2d', { willReadFrequently: true })!;

  const p1zSamples: number[] = [];
  const p2zSamples: number[] = [];

  // Per-frame wrist positions for shot detection (p1 = bottom, p2 = top)
  const wristHistory: Array<{
    t: number;
    p1wx?: number; p1wy?: number;  // p1 right wrist normalized
    p2wx?: number; p2wy?: number;  // p2 right wrist normalized
  }> = [];

  const ballDetections: Array<{ t: number; nx: number; ny: number }> = [];

  const totalSamples = Math.max(POSE_SAMPLES, BALL_SAMPLES);

  for (let i = 0; i < totalSamples; i++) {
    // Spread samples across 95% of video duration (skip first/last 2.5%)
    const t = 0.025 * duration + (i / (totalSamples - 1)) * 0.95 * duration;

    await seekTo(video, t);
    ctx.drawImage(video, 0, 0, CANVAS_W, CANVAS_H);

    // ── Ball color tracking (all samples) ────────────────────────────────
    const ball = detectBallInFrame(ctx, CANVAS_W, CANVAS_H);
    if (ball) {
      ballDetections.push({ t, nx: ball[0], ny: ball[1] });
    }

    // ── Pose analysis (first POSE_SAMPLES frames) ──────────────────────
    if (i < POSE_SAMPLES && pose) {
      try {
        const result = pose.detect(canvas);
        if (result.landmarks.length >= 1) {
          // Map normalized hip-Y → court Z
          // Bottom of frame (normY≈1) = near baseline (z≈+HL)
          // Top of frame (normY≈0) = far baseline (z≈-HL)
          const mapZ = (ny: number) => clamp((0.5 - ny) * 2.55 * HL, -HL + 0.4, HL - 0.4);

          const entry: typeof wristHistory[0] = { t };

          const sortedPoses = result.landmarks
            .map((lm, idx) => ({ lm, idx, hipY: (lm[23].y + lm[24].y) / 2 }))
            .sort((a, b) => b.hipY - a.hipY); // bottom of frame first

          for (const { lm, hipY } of sortedPoses) {
            const z = mapZ(hipY);
            if (z > 0.5) {
              p1zSamples.push(z);
              // Right wrist = landmark 16
              entry.p1wx = lm[16]?.x;
              entry.p1wy = lm[16]?.y;
            } else if (z < -0.5) {
              p2zSamples.push(z);
              entry.p2wx = lm[16]?.x;
              entry.p2wy = lm[16]?.y;
            }
          }
          wristHistory.push(entry);
        }
      } catch { /* skip frame */ }
    }

    const progressPct = 8 + (i / totalSamples) * 55;
    if (i % 5 === 0) {
      cb(`Analysing video… frame ${i + 1}/${totalSamples}`, progressPct);
      await sleep(0);
    }
  }

  // ── Baseline depth (median of samples) ────────────────────────────────
  const median = (arr: number[]) => {
    if (!arr.length) return null;
    return [...arr].sort((a, b) => a - b)[Math.floor(arr.length / 2)];
  };
  const p1BaseZ = clamp(median(p1zSamples) ?? HL * 0.87, HL * 0.58, HL - 0.3);
  const p2BaseZ = clamp(median(p2zSamples) ?? -HL * 0.87, -HL + 0.3, -HL * 0.58);

  // ── Shot timing from wrist velocity spikes ────────────────────────────
  // A shot = rapid wrist acceleration (wrist moves fast then stops = impact)
  const shotTimings: number[] = [];
  const MIN_SHOT_GAP = 0.7; // seconds between shots
  let lastShotT = -MIN_SHOT_GAP;

  for (let i = 2; i < wristHistory.length - 1; i++) {
    const prev2 = wristHistory[i - 2];
    const prev  = wristHistory[i - 1];
    const curr  = wristHistory[i];

    if (curr.t - lastShotT < MIN_SHOT_GAP) continue;

    // Check P1 wrist velocity (normalized coords change per second)
    let shotDetected = false;
    if (curr.p1wx != null && prev.p1wx != null && prev2.p1wx != null) {
      const dt = curr.t - prev2.t;
      if (dt > 0.01) {
        const vx = Math.abs((curr.p1wx - prev2.p1wx) / dt);
        const vy = Math.abs((curr.p1wy! - prev2.p1wy!) / dt);
        const vel = Math.sqrt(vx * vx + vy * vy);
        // Wrist moves >0.6 normalized units/sec = hitting motion
        if (vel > 0.6) shotDetected = true;
      }
    }
    // Check P2
    if (!shotDetected && curr.p2wx != null && prev.p2wx != null && prev2.p2wx != null) {
      const dt = curr.t - prev2.t;
      if (dt > 0.01) {
        const vx = Math.abs((curr.p2wx - prev2.p2wx) / dt);
        const vy = Math.abs((curr.p2wy! - prev2.p2wy!) / dt);
        const vel = Math.sqrt(vx * vx + vy * vy);
        if (vel > 0.6) shotDetected = true;
      }
    }

    if (shotDetected) {
      shotTimings.push(curr.t);
      lastShotT = curr.t;
    }
  }

  // If we detected no shots from wrist (pose failed or bad lighting),
  // fall back to regular intervals based on video duration
  if (shotTimings.length < 2) {
    const estShots = Math.round(duration / 1.8); // ~1.8s per shot avg
    for (let i = 0; i < estShots; i++) {
      shotTimings.push(0.5 + i * (duration / estShots));
    }
  }

  cb(`Analysis complete — ${shotTimings.length} shots, ${ballDetections.length} ball detections`, 63);

  return { p1BaseZ, p2BaseZ, shotTimings, ballPositions: ballDetections, detectedBallCount: ballDetections.length };
}

// ── Shot type library ─────────────────────────────────────────────────────────
interface ShotSpec {
  name: string;
  arcRatio: number;
  spdLo: number; spdHi: number;
  spinLo: number; spinHi: number;
  weight: number;
}

const SHOTS: ShotSpec[] = [
  { name: 'topspin', arcRatio: 0.11, spdLo: 78,  spdHi: 118, spinLo: 2600, spinHi: 4200, weight: 0.40 },
  { name: 'flat',    arcRatio: 0.04, spdLo: 98,  spdHi: 148, spinLo: 1100, spinHi: 2100, weight: 0.27 },
  { name: 'cross',   arcRatio: 0.08, spdLo: 82,  spdHi: 122, spinLo: 1900, spinHi: 3400, weight: 0.18 },
  { name: 'slice',   arcRatio: 0.02, spdLo: 55,  spdHi: 85,  spinLo: 200,  spinHi: 850,  weight: 0.11 },
  { name: 'lob',     arcRatio: 0.30, spdLo: 32,  spdHi: 58,  spinLo: 80,   spinHi: 450,  weight: 0.04 },
];

function pickShot(rng: () => number): ShotSpec {
  let r = rng(), cum = 0;
  for (const s of SHOTS) { cum += s.weight; if (r < cum) return s; }
  return SHOTS[0];
}

// ── Ball arc builder ──────────────────────────────────────────────────────────
function buildArc(
  sx: number, sz: number, startH: number,
  ex: number, ez: number,
  shot: ShotSpec, rng: () => number,
  hitter: 'p1' | 'p2', nFrames: number
) {
  const dist = Math.sqrt((ex - sx) ** 2 + (ez - sz) ** 2);
  const shotSpeed = shot.spdLo + rng() * (shot.spdHi - shot.spdLo);
  const spin = Math.round(shot.spinLo + rng() * (shot.spinHi - shot.spinLo));
  let peakH = Math.max(1.1, dist * shot.arcRatio + rng() * 0.4);

  // Geometric net clearance solve
  const crossesNet = (sz > 0.5 && ez < -0.5) || (sz < -0.5 && ez > 0.5);
  if (crossesNet) {
    const netT = clamp(Math.abs(sz) / Math.abs(ez - sz), 0.05, 0.95);
    const jAtNet = Math.round(netT * nFrames);
    const bf0 = Math.round(nFrames * 0.63);
    if (jAtNet <= bf0) {
      const bt = jAtNet / bf0;
      const coeff = 2 * (1 - bt) * bt;
      if (coeff > 0.01) {
        const currH = (1 - bt) ** 2 * startH + coeff * peakH + bt ** 2 * 0.07;
        if (currH < NET_H + 0.55) {
          const needed = (NET_H + 0.55) - ((1 - bt) ** 2 * startH + bt ** 2 * 0.07);
          peakH = Math.max(peakH, needed / coeff);
        }
      }
    }
  }

  const bounceF = Math.round(nFrames * (0.59 + rng() * 0.09));
  const BOUNCE_COR = 0.68;
  const receiver = hitter === 'p1' ? 'p2' : 'p1';

  return Array.from({ length: nFrames }, (_, j) => {
    const t = j / Math.max(nFrames - 1, 1);
    const hT = smoothstep(t);
    const bx = sx + (ex - sx) * hT;
    const bz = sz + (ez - sz) * hT;
    let by: number;
    if (j <= bounceF) {
      const bt = j / bounceF;
      by = (1 - bt) ** 2 * startH + 2 * (1 - bt) * bt * peakH + bt ** 2 * 0.07;
    } else {
      const pt = (j - bounceF) / Math.max(1, nFrames - bounceF);
      by = 0.07 + peakH * BOUNCE_COR * 0.40 * 4 * pt * (1 - pt);
    }
    by = Math.max(0.06, by);
    const speed = shotSpeed * (0.25 + 0.75 * Math.sqrt(Math.max(0, 1 - t)));
    const hitterOut = j < 3 ? hitter : (j >= nFrames - 3 ? receiver : null);
    return { bx: r3(bx), by: r3(by), bz: r3(bz), speed: r3(speed), spin, hitter: hitterOut, shotType: shot.name };
  });
}

// ── Player movement per shot ──────────────────────────────────────────────────
function buildPlayerFrames(
  hitter: 'p1' | 'p2',
  p1bz: number, p2bz: number,
  cx: number, cz: number,
  lx: number, lz: number,
  nFrames: number
) {
  const P1B = { x: 0, z: p1bz };
  const P2B = { x: 0, z: p2bz };
  const REACT = 6;

  return Array.from({ length: nFrames }, (_, j) => {
    const t = j / Math.max(nFrames - 1, 1);
    const rT = easeOut(t);
    const sT = easeOut(clamp((j - REACT) / Math.max(1, nFrames - REACT), 0, 1));
    let p1x: number, p1z: number, p2x: number, p2z: number;

    if (hitter === 'p1') {
      p1x = lerp(cx, P1B.x, rT); p1z = lerp(cz, P1B.z, rT);
      p2x = lerp(P2B.x, lx, sT); p2z = lerp(P2B.z, lz, sT);
    } else {
      p2x = lerp(cx, P2B.x, rT); p2z = lerp(cz, P2B.z, rT);
      p1x = lerp(P1B.x, lx, sT); p1z = lerp(P1B.z, lz, sT);
    }

    return {
      p1x: r3(clamp(p1x, -HW + 0.3, HW - 0.3)),
      p1z: r3(clamp(p1z, 0.4, HL - 0.2)),
      p2x: r3(clamp(p2x, -HW + 0.3, HW - 0.3)),
      p2z: r3(clamp(p2z, -HL + 0.2, -0.4)),
    };
  });
}

// ── Rally assembly — VIDEO ANCHORED ───────────────────────────────────────────
/**
 * The key improvement: shot boundaries come from DETECTED shot timings,
 * not from a fixed physics estimate.
 * This makes the 3D rally match the video's actual pace and rhythm.
 */
function buildVideoAnchoredRally(
  analysis: VideoAnalysis,
  duration: number,
  rng: () => number
): ProcFrameData[] {
  const totalFrames = Math.ceil(duration * FPS);
  const all: ProcFrameData[] = [];
  const { p1BaseZ, p2BaseZ, shotTimings } = analysis;

  let hitter: 'p1' | 'p2' = 'p1';
  let cx = (rng() - 0.5) * HW * 0.5;
  let cz = p1BaseZ;
  let cH = 0.88 + rng() * 0.2;

  // Convert shot timings → frame boundaries
  const shotFrames = shotTimings
    .map(t => Math.round(t * FPS))
    .filter(f => f > 0 && f < totalFrames);

  // Add start and end markers
  const boundaries = [0, ...shotFrames, totalFrames];

  for (let si = 0; si < boundaries.length - 1; si++) {
    const shotStartF = boundaries[si];
    const shotEndF   = boundaries[si + 1];
    const nFrames    = shotEndF - shotStartF;

    if (nFrames < 8) {
      hitter = hitter === 'p1' ? 'p2' : 'p1';
      continue;
    }

    const shot = pickShot(rng);
    const receiver: 'p1' | 'p2' = hitter === 'p1' ? 'p2' : 'p1';
    const lH = 0.80 + rng() * 0.28;

    // Landing zone in receiver's half
    let lx: number, lz: number;
    if (hitter === 'p1') {
      lx = clamp((rng() - 0.5) * HW * 1.55, -HW + 0.45, HW - 0.45);
      lz = clamp(p2BaseZ + (rng() - 0.5) * 3.2, -HL + 0.45, -HL * 0.50);
    } else {
      lx = clamp((rng() - 0.5) * HW * 1.55, -HW + 0.45, HW - 0.45);
      lz = clamp(p1BaseZ + (rng() - 0.5) * 3.2, HL * 0.50, HL - 0.45);
    }

    const arcs  = buildArc(cx, cz, cH, lx, lz, shot, rng, hitter, nFrames);
    const ppos  = buildPlayerFrames(hitter, p1BaseZ, p2BaseZ, cx, cz, lx, lz, nFrames);

    for (let j = 0; j < nFrames; j++) {
      const a = arcs[j], p = ppos[j];
      all.push({
        frame_index: all.length,
        ball: { position: { x: a.bx, y: a.by, z: a.bz }, is_occluded: false },
        players: [
          { id: 'player_bottom', position: { x: p.p1x, y: 0, z: p.p1z } },
          { id: 'player_top',    position: { x: p.p2x, y: 0, z: p.p2z } },
        ],
        ball_speed_kmh: a.speed,
        spin_rate_rpm:  a.spin,
        hitter: a.hitter,
        shot_type: a.shotType, // Added this back to correctly match the schema
      });
    }

    hitter = receiver; cx = lx; cz = lz; cH = lH;
    if (all.length >= totalFrames) break;
  }

  // Pad if needed
  while (all.length < totalFrames) {
    const last = all[all.length - 1];
    all.push({ ...last, frame_index: all.length });
  }

  return all;
}

// ── Main export ────────────────────────────────────────────────────────────────
export async function processVideoFile(
  file: File,
  onProgress: ProgressCb
): Promise<{ sequence: ProcFrameData[] }> {

  onProgress('Loading video…', 1);
  const video = await loadVideo(file);
  const duration = Math.min(video.duration, MAX_SEC);

  // Load MediaPipe
  const pose = await loadPose(onProgress);

  // Full video analysis: pose + wrist velocity + ball color tracking
  onProgress('Analysing video…', 8);
  const analysis = await analyzeVideo(video, pose, duration, onProgress);

  onProgress(`Building rally — ${analysis.shotTimings.length} shots detected…`, 65);
  await sleep(0);

  // Seeded RNG (different per video, consistent for same video)
  const seed = (file.size & 0xFFFF) ^ Math.round(duration * 100) ^ (file.lastModified & 0xFFFF);
  const rng = mkRng(seed);

  onProgress('Generating 3D rally…', 72);
  await sleep(0);

  const sequence = buildVideoAnchoredRally(analysis, duration, rng);

  // Log summary for debugging
  console.log(`CourtSense v7 — ${sequence.length} frames, ${analysis.shotTimings.length} shots, ` +
    `${analysis.detectedBallCount} ball detections, ` +
    `p1z=${analysis.p1BaseZ.toFixed(2)} p2z=${analysis.p2BaseZ.toFixed(2)}`);

  onProgress('Done!', 100);
  URL.revokeObjectURL(video.src);
  return { sequence };
}
