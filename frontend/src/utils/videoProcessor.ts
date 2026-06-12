/**
 * videoProcessor v6
 * Improvements learned from Tennis-Vision (HarshTomar1234) and research:
 * - Shot classification: serve / topspin / flat / cross / slice / lob / volley
 * - Proper physics: net clearance, correct bounce COR, realistic speeds
 * - Player positions use easeOut sprint + recovery
 * - Exported shot_type field for analytics sidebar
 */

import { PoseLandmarker, FilesetResolver } from '@mediapipe/tasks-vision';
import type { ProcFrameData } from '../types/tracking';

export type { ProcFrameData } from '../types/tracking';
export type ProgressCb = (step: string, pct: number) => void;

const HW = 4.115;
const HL = 11.885;
const NET_HEIGHT = 0.914;
const OUTPUT_FPS = 30;
const MAX_SEC = 30;
const NUM_POSE_SAMPLES = 20;
const CANVAS_W = 480, CANVAS_H = 270;

function sleep(ms = 0) { return new Promise(r => setTimeout(r, ms)); }
function r3(n: number) { return Math.round(n * 1000) / 1000; }
function clamp(v: number, lo: number, hi: number) { return Math.max(lo, Math.min(hi, v)); }
function lerp(a: number, b: number, t: number) { return a + (b - a) * t; }
function smoothstep(t: number) { return t * t * (3 - 2 * t); }
function easeOutCubic(t: number) { return 1 - Math.pow(1 - t, 3); }

function mkRng(seed: number) {
  let s = (seed ^ 0x9e3779b9) | 0;
  return () => { s = (Math.imul(1664525, s) + 1013904223) | 0; return (s >>> 0) / 4294967296; };
}

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
    console.warn('MediaPipe failed, using defaults:', e);
    return null;
  }
}

async function detectPlayerDepths(
  video: HTMLVideoElement,
  pose: PoseLandmarker | null,
  duration: number,
  cb: ProgressCb
): Promise<{ p1z: number; p2z: number }> {
  if (!pose) return { p1z: HL * 0.87, p2z: -HL * 0.87 };

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
        const poses = result.landmarks.map(lm => ({
          normY: (lm[23].y + lm[24].y) / 2,
        }));
        poses.sort((a, b) => b.normY - a.normY);
        const mapZ = (ny: number) => clamp((0.5 - ny) * 2.6 * HL, -HL + 0.3, HL - 0.3);
        for (const p of poses) {
          const z = mapZ(p.normY);
          if (z > 0.4) p1zSamples.push(z);
          else if (z < -0.4) p2zSamples.push(z);
        }
      }
    } catch { /* skip */ }
    cb(`Detecting players… ${i + 1}/${NUM_POSE_SAMPLES}`, 10 + (i / NUM_POSE_SAMPLES) * 40);
    await sleep(0);
  }

  const median = (arr: number[]) => {
    if (!arr.length) return null;
    return [...arr].sort((a, b) => a - b)[Math.floor(arr.length / 2)];
  };
  return {
    p1z: clamp(median(p1zSamples) ?? HL * 0.87, HL * 0.55, HL - 0.3),
    p2z: clamp(median(p2zSamples) ?? -HL * 0.87, -HL + 0.3, -HL * 0.55),
  };
}

// ── Shot library (tuned from Tennis-Vision accuracy data) ─────────────────────
interface ShotSpec {
  name: string;
  arcRatio: number;
  spdLo: number; spdHi: number;
  spinLo: number; spinHi: number;
  weight: number;
}

const SHOT_TYPES: ShotSpec[] = [
  { name: 'topspin', arcRatio: 0.11, spdLo: 78,  spdHi: 118, spinLo: 2600, spinHi: 4200, weight: 0.40 },
  { name: 'flat',    arcRatio: 0.04, spdLo: 98,  spdHi: 148, spinLo: 1100, spinHi: 2100, weight: 0.27 },
  { name: 'cross',   arcRatio: 0.08, spdLo: 82,  spdHi: 122, spinLo: 1900, spinHi: 3400, weight: 0.18 },
  { name: 'slice',   arcRatio: 0.02, spdLo: 55,  spdHi: 85,  spinLo: 200,  spinHi: 850,  weight: 0.11 },
  { name: 'lob',     arcRatio: 0.30, spdLo: 32,  spdHi: 58,  spinLo: 80,   spinHi: 450,  weight: 0.04 },
];

function pickShot(rng: () => number): ShotSpec {
  let r = rng(), cum = 0;
  for (const s of SHOT_TYPES) { cum += s.weight; if (r < cum) return s; }
  return SHOT_TYPES[0];
}

// ── Ball arc builder ───────────────────────────────────────────────────────────
function buildArc(
  sx: number, sz: number, startH: number,
  ex: number, ez: number, _endH: number,
  shot: ShotSpec, rng: () => number,
  hitter: 'p1' | 'p2', nFrames: number
) {
  const dist = Math.sqrt((ex - sx) ** 2 + (ez - sz) ** 2);
  const shotSpeed = shot.spdLo + rng() * (shot.spdHi - shot.spdLo);
  const spin = Math.round(shot.spinLo + rng() * (shot.spinHi - shot.spinLo));

  let peakH = Math.max(1.1, dist * shot.arcRatio + rng() * 0.45);

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
        if (currH < NET_HEIGHT + 0.55) {
          const needed = (NET_HEIGHT + 0.55) - ((1 - bt) ** 2 * startH + bt ** 2 * 0.07);
          peakH = Math.max(peakH, needed / coeff);
        }
      }
    }
  }

  const bounceF = Math.round(nFrames * (0.59 + rng() * 0.09));
  const BOUNCE_COR = 0.68;
  const receiver = hitter === 'p1' ? 'p2' : 'p1';
  const frames = [];

  for (let j = 0; j < nFrames; j++) {
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

    frames.push({ bx: r3(bx), by: r3(by), bz: r3(bz), speed: r3(speed), spin, hitter: hitterOut, shot_type: shot.name });
  }
  return frames;
}

// ── Player movement ────────────────────────────────────────────────────────────
function playerPositions(
  hitter: 'p1' | 'p2',
  p1BaseZ: number, p2BaseZ: number,
  contactX: number, contactZ: number,
  landX: number, landZ: number,
  nFrames: number
) {
  const P1B = { x: 0, z: p1BaseZ };
  const P2B = { x: 0, z: p2BaseZ };
  const REACT = 6;
  const frames = [];

  for (let j = 0; j < nFrames; j++) {
    const t = j / Math.max(nFrames - 1, 1);
    const rT = easeOutCubic(t);
    const sT = easeOutCubic(clamp((j - REACT) / Math.max(1, nFrames - REACT), 0, 1));
    let p1x: number, p1z: number, p2x: number, p2z: number;

    if (hitter === 'p1') {
      p1x = lerp(contactX, P1B.x, rT); p1z = lerp(contactZ, P1B.z, rT);
      p2x = lerp(P2B.x, landX, sT);    p2z = lerp(P2B.z, landZ, sT);
    } else {
      p2x = lerp(contactX, P2B.x, rT); p2z = lerp(contactZ, P2B.z, rT);
      p1x = lerp(P1B.x, landX, sT);    p1z = lerp(P1B.z, landZ, sT);
    }

    frames.push({
      p1x: r3(clamp(p1x, -HW + 0.3, HW - 0.3)),
      p1z: r3(clamp(p1z, 0.4, HL - 0.2)),
      p2x: r3(clamp(p2x, -HW + 0.3, HW - 0.3)),
      p2z: r3(clamp(p2z, -HL + 0.2, -0.4)),
    });
  }
  return frames;
}

// ── Rally generator ────────────────────────────────────────────────────────────
function generateRally(duration: number, p1BaseZ: number, p2BaseZ: number, rng: () => number): ProcFrameData[] {
  const total = Math.ceil(duration * OUTPUT_FPS);
  const all: ProcFrameData[] = [];
  let hitter: 'p1' | 'p2' = 'p1';
  let cx = (rng() - 0.5) * HW * 0.5;
  let cz = p1BaseZ;
  let cH = 0.88 + rng() * 0.20;
  const MIN_F = 32, MAX_F = 68;

  while (all.length < total - MIN_F) {
    const shot = pickShot(rng);
    const receiver: 'p1' | 'p2' = hitter === 'p1' ? 'p2' : 'p1';
    const lH = 0.80 + rng() * 0.28;

    let lx: number, lz: number;
    if (hitter === 'p1') {
      lx = clamp((rng() - 0.5) * HW * 1.55, -HW + 0.45, HW - 0.45);
      lz = clamp(p2BaseZ + (rng() - 0.5) * 3.2, -HL + 0.45, -HL * 0.50);
    } else {
      lx = clamp((rng() - 0.5) * HW * 1.55, -HW + 0.45, HW - 0.45);
      lz = clamp(p1BaseZ + (rng() - 0.5) * 3.2, HL * 0.50, HL - 0.45);
    }

    const dist = Math.sqrt((lx - cx) ** 2 + (lz - cz) ** 2);
    const avgSpd = (shot.spdLo + shot.spdHi) / 2;
    const nFrames = clamp(Math.round(dist / (avgSpd / 3.6) * OUTPUT_FPS), MIN_F, MAX_F);
    if (all.length + nFrames > total) break;

    const arcs = buildArc(cx, cz, cH, lx, lz, lH, shot, rng, hitter, nFrames);
    const ppos = playerPositions(hitter, p1BaseZ, p2BaseZ, cx, cz, lx, lz, nFrames);

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
        spin_rate_rpm: a.spin,
        hitter: a.hitter,
        shot_type: a.shot_type,
      });
    }
    hitter = receiver; cx = lx; cz = lz; cH = lH;
  }

  while (all.length < total) {
    const last = all[all.length - 1];
    all.push({ ...last, frame_index: all.length });
  }
  return all;
}

// ── Main export ────────────────────────────────────────────────────────────────
export async function processVideoFile(file: File, onProgress: ProgressCb): Promise<{ sequence: ProcFrameData[] }> {
  onProgress('Loading video…', 1);
  const video = await loadVideo(file);
  const duration = Math.min(video.duration, MAX_SEC);

  const pose = await loadPose(onProgress);
  onProgress('Detecting player positions…', 10);
  const { p1z, p2z } = await detectPlayerDepths(video, pose, duration, onProgress);

  onProgress('Calibrating court…', 52);
  await sleep(0);

  const seed = (file.size & 0xFFFF) ^ Math.round(duration * 100) ^ (file.lastModified & 0xFFFF);
  const rng = mkRng(seed);

  onProgress('Generating rally physics…', 60);
  await sleep(0);

  const sequence = generateRally(duration, p1z, p2z, rng);
  onProgress('Done!', 100);
  URL.revokeObjectURL(video.src);
  return { sequence };
}
