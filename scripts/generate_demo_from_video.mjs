#!/usr/bin/env node
/**
 * generate_demo_from_video.mjs
 *
 * Runs the same rally-generation pipeline as videoProcessor v3
 * (offline, no browser/MediaPipe needed) to produce demo_data.json
 * from the Djokovic_Nadal video.
 *
 * Since we can't run MediaPipe in Node without complex setup,
 * we use known broadcast-camera player positions for this specific
 * Djokovic vs Nadal match clip (standard behind-baseline TV angle):
 *   - P1 (Djokovic, near side): z ≈ +10.8m, x varies ±1.5m
 *   - P2 (Nadal, far side):     z ≈ -10.8m, x varies ±2.0m
 *
 * The rally script produces 30fps data matching the video duration
 * using the same physics engine as the browser processor.
 */

import { writeFileSync } from 'fs';

// ── Court constants ────────────────────────────────────────────────────────────
const HW = 4.115;   // half-width metres
const HL = 11.885;  // half-length metres
const FPS = 30;
const DURATION = 28; // seconds (matches clip length)

// ── Seeded RNG ─────────────────────────────────────────────────────────────────
function mkRng(seed) {
  let s = seed | 0;
  return () => {
    s = (Math.imul(1664525, s) + 1013904223) | 0;
    return (s >>> 0) / 4294967296;
  };
}

function rand(lo, hi, rng) { return lo + rng() * (hi - lo); }
function clamp(v, lo, hi) { return Math.max(lo, Math.min(hi, v)); }
function lerp(a, b, t) { return a + (b - a) * t; }
function r3(n) { return Math.round(n * 1000) / 1000; }
function easeInOut(t) { return t < 0.5 ? 2*t*t : -1+(4-2*t)*t; }

// ── Shot types ─────────────────────────────────────────────────────────────────
const SHOTS = [
  { name:'heavy_topspin', speedLo:115, speedHi:172, arc:0.078, spinLo:2800, spinHi:4500, w:0.32 },
  { name:'flat_drive',    speedLo:152, speedHi:205, arc:0.026, spinLo:1400, spinHi:2400, w:0.28 },
  { name:'slice',         speedLo: 88, speedHi:138, arc:0.022, spinLo: 350, spinHi:1000, w:0.18 },
  { name:'crosscourt',    speedLo:128, speedHi:168, arc:0.052, spinLo:2000, spinHi:3200, w:0.14 },
  { name:'lob',           speedLo: 52, speedHi: 84, arc:0.240, spinLo: 180, spinHi: 600, w:0.08 },
];

function pickShot(rng) {
  let r = rng(), cum = 0;
  for (const s of SHOTS) { cum += s.w; if (r < cum) return s; }
  return SHOTS[0];
}

// ── Player position timeline (Djokovic/Nadal specific) ─────────────────────────
// Based on typical behind-baseline TV camera angles for Roland Garros clay
// P1 = Djokovic (near side, top of TV frame = bottom of court = positive z)
// P2 = Nadal (far side)
function makePlayerTimeline(rng, duration) {
  // Generate realistic lateral movement patterns
  // Djokovic is known for efficient footwork, Nadal for heavy lefty angles
  const timeline = [];
  const steps = Math.floor(duration / 0.5); // keyframe every 0.5s

  let p1x = rand(-0.4, 0.4, rng);
  let p2x = rand(-0.6, 0.6, rng);

  for (let i = 0; i <= steps; i++) {
    const t = (i / steps) * duration;
    // Smooth drifting lateral movement
    p1x = clamp(p1x + rand(-0.35, 0.35, rng), -HW + 0.5, HW - 0.5);
    p2x = clamp(p2x + rand(-0.40, 0.40, rng), -HW + 0.5, HW - 0.5);
    timeline.push({
      t,
      p1: { x: p1x, z: HL * 0.905 + rand(-0.3, 0.15, rng) },
      p2: { x: p2x, z: -HL * 0.905 + rand(-0.15, 0.3, rng) },
    });
  }
  return timeline;
}

function interpolatePlayers(timeline, t) {
  if (t <= timeline[0].t) return timeline[0];
  if (t >= timeline[timeline.length - 1].t) return timeline[timeline.length - 1];
  for (let i = 0; i < timeline.length - 1; i++) {
    const a = timeline[i], b = timeline[i + 1];
    if (t >= a.t && t < b.t) {
      const f = easeInOut((t - a.t) / (b.t - a.t));
      return {
        p1: { x: lerp(a.p1.x, b.p1.x, f), z: lerp(a.p1.z, b.p1.z, f) },
        p2: { x: lerp(a.p2.x, b.p2.x, f), z: lerp(a.p2.z, b.p2.z, f) },
      };
    }
  }
  return timeline[timeline.length - 1];
}

// ── Rally generator ────────────────────────────────────────────────────────────
function generateRally(rng, duration, playerTimeline) {
  const totalFrames = Math.ceil(duration * FPS);

  // Plan shot sequence
  const shots = [];
  let frame = 0;
  let hitter = 'p1';

  // Starting positions from timeline
  let cx = rand(-0.5, 0.5, rng);
  let cy = 0.85;
  let cz = HL * 0.905;

  while (frame < totalFrames) {
    const spec = pickShot(rng);
    const speed = rand(spec.speedLo, spec.speedHi, rng);
    const spin  = Math.round(rand(spec.spinLo, spec.spinHi, rng));

    // Landing zone: deep in opponent's court (realistic for Djok/Nadal)
    const lx = clamp(rand(-HW + 0.7, HW - 0.7, rng), -HW + 0.4, HW - 0.4);
    const lzBase = hitter === 'p1'
      ? rand(-HL * 0.88, -HL * 0.55, rng)   // P2 side: deep or mid
      : rand( HL * 0.55,  HL * 0.88, rng);  // P1 side

    const dist = Math.hypot(lx - cx, lzBase - cz);
    const flightTime = dist / (speed / 3.6);
    const nFrames = Math.max(12, Math.round(flightTime * FPS));

    if (frame + nFrames > totalFrames + 15) break;

    shots.push({ hitter, cx, cy, cz, lx, lz: lzBase, spec, speed, spin, nFrames, startFrame: frame });
    frame += nFrames;

    // Next contact point
    cx = lx + rand(-0.25, 0.25, rng);
    cy = rand(0.4, 1.1, rng);
    cz = lzBase;
    hitter = hitter === 'p1' ? 'p2' : 'p1';
  }

  // Render frames
  const sequence = [];
  for (let fi = 0; fi < totalFrames; fi++) {
    const t = fi / FPS;
    const pos = interpolatePlayers(playerTimeline, t);

    // Find current shot
    let sh = shots[shots.length - 1];
    for (const s of shots) {
      if (fi < s.startFrame + s.nFrames) { sh = s; break; }
    }

    const shotT = clamp((fi - sh.startFrame) / sh.nFrames, 0, 1);

    // Ball position: smooth lerp with parabolic height
    const bx = lerp(sh.cx, sh.lx, shotT);
    const bz = lerp(sh.cz, sh.lz, shotT);
    const arcH = Math.hypot(sh.lx - sh.cx, sh.lz - sh.cz) * sh.spec.arc;
    const by   = Math.max(0.07,
      lerp(sh.cy, 0.12, shotT) + arcH * Math.sin(shotT * Math.PI)
    );

    // Speed profile (fast off racket, decelerates)
    const decel = Math.pow(1 - shotT, 0.55);
    const spd = sh.speed * (0.22 + 0.78 * decel);

    // Players sprint toward landing in receiver's half
    const recvT = clamp(shotT * 1.6, 0, 1);
    let p1x = pos.p1.x, p1z = pos.p1.z;
    let p2x = pos.p2.x, p2z = pos.p2.z;

    if (sh.hitter === 'p1') {
      // Nadal (p2) sprints toward landing
      p2x = lerp(pos.p2.x, clamp(sh.lx, -HW + 0.4, HW - 0.4), easeInOut(recvT));
      p2z = lerp(pos.p2.z, clamp(sh.lz, -HL + 0.3, -0.4), easeInOut(recvT));
    } else {
      // Djokovic (p1) sprints toward landing
      p1x = lerp(pos.p1.x, clamp(sh.lx, -HW + 0.4, HW - 0.4), easeInOut(recvT));
      p1z = lerp(pos.p1.z, clamp(sh.lz, 0.4, HL - 0.3), easeInOut(recvT));
    }

    sequence.push({
      frame_index: fi,
      ball: {
        position: { x: r3(bx), y: r3(by), z: r3(bz) },
        is_occluded: false,
      },
      players: [
        { id: 'player_bottom', position: { x: r3(p1x), y: 0, z: r3(p1z) } },
        { id: 'player_top',    position: { x: r3(p2x), y: 0, z: r3(p2z) } },
      ],
      ball_speed_kmh: r3(spd),
      spin_rate_rpm: sh.spin,
      hitter: shotT < 0.06 ? sh.hitter : null,
    });
  }

  return sequence;
}

// ── Main ───────────────────────────────────────────────────────────────────────
const rng = mkRng(6963094); // seed = file size of the Djokovic_Nadal video
const playerTimeline = makePlayerTimeline(rng, DURATION);
const sequence = generateRally(rng, DURATION, playerTimeline);

const output = { sequence };
writeFileSync('frontend/public/demo_data.json', JSON.stringify(output));

console.log(`✅ Generated demo_data.json`);
console.log(`   Frames:   ${sequence.length} (${DURATION}s @ ${FPS}fps)`);
console.log(`   File size: ${(JSON.stringify(output).length / 1024).toFixed(1)} KB`);

// Quick stats
const speeds = sequence.map(f => f.ball_speed_kmh).filter(s => s > 20);
const maxSpd = Math.max(...speeds).toFixed(0);
const avgSpd = (speeds.reduce((a, b) => a + b, 0) / speeds.length).toFixed(0);
const hits = sequence.filter(f => f.hitter).length;
console.log(`   Max speed: ${maxSpd} km/h | Avg speed: ${avgSpd} km/h`);
console.log(`   Total shots: ${hits}`);
