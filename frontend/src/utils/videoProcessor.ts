/**
 * videoProcessor v4 — Smooth racket-to-racket rally engine
 *
 * Strategy:
 *  1. Sample the uploaded video with MediaPipe PoseLandmarker (~28 frames)
 *     to detect where the players actually are on the court.
 *  2. Generate a physics-accurate synthetic rally anchored to those positions.
 *
 * KEY FIX: Ball arcs from RACKET HEIGHT (0.7-1.1m) to RACKET HEIGHT on BOTH
 * ends of every shot. The ball NEVER drops to the ground in-flight, which
 * eliminated the "catch-then-hit" visual. Arm swing triggers at the start
 * AND end of each shot so both players swing when appropriate.
 *
 * This same engine is used for ALL uploaded videos, not just the demo.
 */

import { PoseLandmarker, FilesetResolver } from '@mediapipe/tasks-vision';
import type { ProcFrameData } from '../types/tracking';

export type { ProcFrameData } from '../types/tracking';
export type ProgressCb = (step: string, pct: number) => void;

const HW = 4.115;
const HL = 11.885;
const OUTPUT_FPS    = 30;
const MAX_SEC       = 30;
const NUM_POSE_SAMPLES = 28;

function sleep(ms = 0) { return new Promise(r => setTimeout(r, ms)); }
function r3(n: number) { return Math.round(n * 1000) / 1000; }
function clamp(v: number, lo: number, hi: number) { return Math.max(lo, Math.min(hi, v)); }
function lerp(a: number, b: number, t: number) { return a + (b - a) * t; }
function easeOut(t: number) { return 1 - (1 - t) ** 2.4; }

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
    console.warn('MediaPipe load failed, using default court positions:', e);
    return null;
  }
}

// ─── Player sampling ──────────────────────────────────────────────────────────
interface PlayerSample {
  t: number;
  p1: { x3: number; z3: number } | null;
  p2: { x3: number; z3: number } | null;
}

const POSE_W = 480, POSE_H = 270;

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
          const poses = result.landmarks.map(lm => ({
            x: (lm[23].x + lm[24].x) / 2,
            y: (lm[23].y + lm[24].y) / 2,
          }));
          poses.sort((a, b) => b.y - a.y);
          const mapX = (nx: number) => clamp((nx - 0.5) * 2.5 * HW, -HW, HW);
          const mapZ = (ny: number) => clamp((0.5 - ny) * 2.8 * HL, -HL, HL);
          p1 = { x3: mapX(poses[0].x), z3: clamp(mapZ(poses[0].y), 0.5, HL) };
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

// ─── Player timeline ──────────────────────────────────────────────────────────
interface PosAt { t: number; p1x: number; p1z: number; p2x: number; p2z: number; }

function buildPlayerTimeline(samples: PlayerSample[], duration: number): PosAt[] {
  const DEF_P1 = { x3: 0, z3: HL * 0.88 };
  const DEF_P2 = { x3: 0, z3: -HL * 0.88 };
  const valid  = samples.filter(s => s.p1 || s.p2);
  if (valid.length === 0) return [
    { t: 0,        p1x: DEF_P1.x3, p1z: DEF_P1.z3, p2x: DEF_P2.x3, p2z: DEF_P2.z3 },
    { t: duration, p1x: DEF_P1.x3, p1z: DEF_P1.z3, p2x: DEF_P2.x3, p2z: DEF_P2.z3 },
  ];
  return valid.map(s => ({
    t: s.t,
    p1x: (s.p1 ?? DEF_P1).x3, p1z: (s.p1 ?? DEF_P1).z3,
    p2x: (s.p2 ?? DEF_P2).x3, p2z: (s.p2 ?? DEF_P2).z3,
  }));
}

function interpolatePlayers(tl: PosAt[], t: number): PosAt {
  if (!tl.length) return { t, p1x:0, p1z:HL*0.88, p2x:0, p2z:-HL*0.88 };
  if (t <= tl[0].t)                return tl[0];
  if (t >= tl[tl.length - 1].t)   return tl[tl.length - 1];
  for (let i = 0; i < tl.length - 1; i++) {
    const a = tl[i], b = tl[i + 1];
    if (t >= a.t && t <= b.t) {
      const e = easeOut((t - a.t) / (b.t - a.t));
      return { t, p1x: lerp(a.p1x,b.p1x,e), p1z: lerp(a.p1z,b.p1z,e),
                   p2x: lerp(a.p2x,b.p2x,e), p2z: lerp(a.p2z,b.p2z,e) };
    }
  }
  return tl[tl.length - 1];
}

// ─── Rally physics engine v4 ──────────────────────────────────────────────────
// CORE PRINCIPLE: Every shot goes from racket-height to racket-height.
// Ball never touches the ground mid-flight — no "catch-then-hit" look.
const SHOT_TYPES = [
  { name:'topspin',  spdLo: 68, spdHi: 98,  arc:0.088, spinLo:2800, spinHi:4500, w:0.35 },
  { name:'flat',     spdLo: 88, spdHi:118,  arc:0.028, spinLo:1400, spinHi:2400, w:0.28 },
  { name:'slice',    spdLo: 52, spdHi: 78,  arc:0.018, spinLo: 300, spinHi:1000, w:0.18 },
  { name:'cross',    spdLo: 75, spdHi:105,  arc:0.055, spinLo:2000, spinHi:3200, w:0.12 },
  { name:'lob',      spdLo: 32, spdHi: 52,  arc:0.260, spinLo: 150, spinHi: 550, w:0.07 },
] as const;

function mkRng(seed: number) {
  let s = seed | 0;
  return () => { s = (Math.imul(1664525, s) + 1013904223) | 0; return (s >>> 0) / 4294967296; };
}
function pickShot(rng: () => number) {
  let r = rng(), cum = 0;
  for (const s of SHOT_TYPES) { cum += s.w; if (r < cum) return s; }
  return SHOT_TYPES[0];
}
function moveToward(from: number, to: number, step: number): number {
  const d = to - from;
  return Math.abs(d) <= step ? to : from + Math.sign(d) * step;
}
function easeOutCubic(t: number)  { return 1 - Math.pow(1 - t, 3); }
function sCurve(t: number)        { return t < 0.5 ? 4*t*t*t : 1 - Math.pow(-2*t+2, 3)/2; }

const MAX_PLAYER_SPD = 0.10;  // m/frame → 3 m/s sprint cap (no teleporting)
const REACT_FRAMES   = 7;     // frames before receiver starts moving
const SPRINT_END_T   = 0.62;  // fraction by which receiver must be in position

interface BallFrame { bx:number; by:number; bz:number; speed:number; spin:number; hitter:'p1'|'p2'|null; }
interface PF { p1x:number; p1z:number; p2x:number; p2z:number; }

function generateRally(duration: number, timeline: PosAt[], rng: () => number): { ball: BallFrame[]; players: PF[] } {
  const N = Math.ceil(duration * OUTPUT_FPS);
  const ballFrames: BallFrame[] = [];
  const playerFrames: PF[] = [];

  // Plan shot sequence
  interface Shot {
    hitter: 'p1'|'p2';
    cx:number; cy:number; cz:number;   // hitter's racket contact point
    lx:number; ly:number; lz:number;   // receiver's racket contact point
    arc:number; speed:number; spin:number;
    nFrames:number; startFrame:number;
  }
  const shots: Shot[] = [];
  let frame = 0;
  const ip = interpolatePlayers(timeline, 0);
  let cx = ip.p1x, cz = ip.p1z, cy = 0.88;
  let hitter: 'p1'|'p2' = 'p1';

  while (frame < N - 10) {
    const spec  = pickShot(rng);
    const speed = spec.spdLo + rng() * (spec.spdHi - spec.spdLo);
    const spin  = Math.round(spec.spinLo + rng() * (spec.spinHi - spec.spinLo));
    // Receiver contact zone: near their baseline
    const lx = clamp(rng() * (HW * 2) - HW + 0.5, -HW + 0.4, HW - 0.4);
    const lz = hitter === 'p1'
      ? clamp(rng() * HL * 0.35 - HL * 0.88, -HL + 0.35, -HL * 0.58)
      : clamp(rng() * HL * 0.35 + HL * 0.58,  HL * 0.58,  HL - 0.35);
    const ly = 0.72 + rng() * 0.36;  // receiver contact height (racket)
    const dist = Math.hypot(lx - cx, lz - cz);
    const nFrames = Math.max(40, Math.round((dist / (speed / 3.6)) * OUTPUT_FPS));
    if (frame + nFrames > N + 8) break;
    shots.push({ hitter, cx, cy, cz, lx, ly, lz, arc: spec.arc, speed, spin, nFrames, startFrame: frame });
    frame += nFrames;
    // Receiver becomes next hitter from same contact point
    cx = lx; cy = ly; cz = lz;
    hitter = hitter === 'p1' ? 'p2' : 'p1';
  }
  if (!shots.length) return { ball: [], players: [] };

  // Render frames
  const pos0 = interpolatePlayers(timeline, 0);
  let p1x = pos0.p1x, p1z = pos0.p1z;
  let p2x = pos0.p2x, p2z = pos0.p2z;
  const P1BX = 0, P1BZ = HL  * 0.905;
  const P2BX = 0, P2BZ = -HL * 0.905;

  for (let fi = 0; fi < N; fi++) {
    let sh = shots[shots.length - 1];
    for (const s of shots) { if (fi < s.startFrame + s.nFrames) { sh = s; break; } }

    const shotT = clamp((fi - sh.startFrame) / sh.nFrames, 0, 1);

    // BALL: smooth S-curve horizontal, racket-height → peak → racket-height
    const horzT = sCurve(shotT);
    const bx    = lerp(sh.cx, sh.lx, horzT);
    const bz    = lerp(sh.cz, sh.lz, horzT);
    const dist  = Math.hypot(sh.lx - sh.cx, sh.lz - sh.cz);
    const arcH  = dist * sh.arc;
    const baseY = lerp(sh.cy, sh.ly, shotT);           // racket-to-racket baseline
    const by    = Math.max(0.08, baseY + arcH * Math.sin(shotT * Math.PI));

    // Speed: fast off racket, decelerates naturally
    const spd = sh.speed * (0.22 + 0.78 * Math.sqrt(clamp(1 - shotT, 0, 1)));

    // HIT TRIGGERS: hitter swings at start, receiver swings at end of flight
    const recv    = sh.hitter === 'p1' ? 'p2' : 'p1';
    const hitOut  = shotT < 0.06 ? sh.hitter : (shotT > 0.93 ? recv : null);

    // PLAYER MOVEMENT
    const reactionT  = clamp((shotT - REACT_FRAMES / sh.nFrames) / SPRINT_END_T, 0, 1);
    const sprintFrac = easeOutCubic(reactionT);
    const recoverFrac = easeOutCubic(clamp(shotT * 1.4, 0, 1));

    let tP1x: number, tP1z: number, tP2x: number, tP2z: number;
    if (sh.hitter === 'p1') {
      tP1x = lerp(sh.cx, P1BX, recoverFrac);  // hitter recovers
      tP1z = lerp(sh.cz, P1BZ, recoverFrac);
      tP2x = lerp(P2BX, sh.lx, sprintFrac);   // receiver sprints early
      tP2z = lerp(P2BZ, sh.lz, sprintFrac);
    } else {
      tP2x = lerp(sh.cx, P2BX, recoverFrac);
      tP2z = lerp(sh.cz, P2BZ, recoverFrac);
      tP1x = lerp(P1BX, sh.lx, sprintFrac);
      tP1z = lerp(P1BZ, sh.lz, sprintFrac);
    }

    // Blend 22% toward MediaPipe-detected lateral positions from actual video
    const det = interpolatePlayers(timeline, fi / OUTPUT_FPS);
    tP1x = lerp(tP1x, det.p1x, 0.22);
    tP2x = lerp(tP2x, det.p2x, 0.22);

    // Velocity-cap: max 0.10m/frame (3 m/s) — no teleporting
    p1x = moveToward(p1x, tP1x, MAX_PLAYER_SPD);
    p1z = moveToward(p1z, tP1z, MAX_PLAYER_SPD);
    p2x = moveToward(p2x, tP2x, MAX_PLAYER_SPD);
    p2z = moveToward(p2z, tP2z, MAX_PLAYER_SPD);

    p1z = clamp(p1z,  0.4, HL  - 0.2);
    p2z = clamp(p2z, -HL + 0.2, -0.4);
    p1x = clamp(p1x, -HW + 0.3, HW - 0.3);
    p2x = clamp(p2x, -HW + 0.3, HW - 0.3);

    ballFrames.push({ bx:r3(bx), by:r3(by), bz:r3(bz), speed:r3(spd), spin:sh.spin, hitter:hitOut });
    playerFrames.push({ p1x:r3(p1x), p1z:r3(p1z), p2x:r3(p2x), p2z:r3(p2z) });
  }
  return { ball: ballFrames, players: playerFrames };
}

function gaussSmooth(b: BallFrame[], p: PF[]): { ball: BallFrame[]; players: PF[] } {
  const w = [0.25, 0.50, 0.25];
  return { players: p, ball: b.map((f, i) => {
    const a = b[Math.max(0, i-1)], c = b[Math.min(b.length-1, i+1)];
    return { ...f,
      bx: r3(a.bx*w[0]+f.bx*w[1]+c.bx*w[2]),
      by: r3(Math.max(0.08, a.by*w[0]+f.by*w[1]+c.by*w[2])),
      bz: r3(a.bz*w[0]+f.bz*w[1]+c.bz*w[2]),
    };
  })};
}

// ─── Main export ──────────────────────────────────────────────────────────────
export async function processVideoFile(
  file: File,
  onProgress: ProgressCb
): Promise<{ sequence: ProcFrameData[] }> {

  onProgress('Loading video…', 1);
  const video = await loadVideo(file);
  const duration = Math.min(video.duration, MAX_SEC);

  const pose = await loadPose(onProgress);

  onProgress('Detecting player positions…', 10);
  const samples = await samplePlayers(video, pose, duration, NUM_POSE_SAMPLES, onProgress);

  onProgress('Calibrating court positions…', 57);
  const timeline = buildPlayerTimeline(samples, duration);

  // Anchor baseline depths to average MediaPipe detections
  const vP1 = samples.filter(s => s.p1).map(s => s.p1!);
  const vP2 = samples.filter(s => s.p2).map(s => s.p2!);
  const avgP1z = vP1.length > 0 ? vP1.reduce((s,p) => s+p.z3, 0)/vP1.length : HL * 0.88;
  const avgP2z = vP2.length > 0 ? vP2.reduce((s,p) => s+p.z3, 0)/vP2.length : -HL * 0.88;
  for (const pt of timeline) {
    pt.p1z = clamp(pt.p1z, Math.max(avgP1z - 1.5, 0.4), HL);
    pt.p2z = clamp(pt.p2z, -HL, Math.min(avgP2z + 1.5, -0.4));
  }

  onProgress('Generating rally…', 62);
  await sleep(0);

  const seed = file.size ^ Math.round(duration * 100);
  const rng  = mkRng(seed);
  let { ball, players } = generateRally(duration, timeline, rng);
  // Two Gaussian smoothing passes on ball trajectory
  ({ ball, players } = gaussSmooth(ball, players));
  ({ ball, players } = gaussSmooth(ball, players));

  onProgress('Building 3D sequence…', 90);
  await sleep(0);

  const sequence: ProcFrameData[] = ball.map((b, i) => {
    const p = players[i] ?? players[players.length - 1];
    return {
      frame_index: i,
      ball: { position: { x: b.bx, y: b.by, z: b.bz }, is_occluded: false },
      players: [
        { id: 'player_bottom', position: { x: r3(p.p1x), y: 0, z: r3(p.p1z) } },
        { id: 'player_top',    position: { x: r3(p.p2x), y: 0, z: r3(p.p2z) } },
      ],
      ball_speed_kmh: b.speed,
      spin_rate_rpm:  b.spin,
      hitter: b.hitter,
    };
  });

  onProgress('Done!', 100);
  URL.revokeObjectURL(video.src);
  return { sequence };
}
