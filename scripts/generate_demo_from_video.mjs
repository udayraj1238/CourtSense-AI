#!/usr/bin/env node
/**
 * generate_demo_from_video.mjs  v2
 * Generates demo_data.json for the Djokovic vs Nadal epic rally.
 *
 * Key improvements:
 *  - Velocity-capped player movement (max 0.10 m/frame = 3 m/s sprint)
 *    → no more teleporting
 *  - Visual ball speeds 40% slower so shots last 40-90 frames (1.3-3s)
 *    → looks smooth at 30fps
 *  - Reaction delay before receiver starts moving (0.25s)
 *  - Gaussian smoothing pass at the end
 *  - Rally length tuned to match Djokovic/Nadal clay-court baseline style
 */

import { writeFileSync } from 'fs';

const HW  = 4.115;    // half-width  (m)
const HL  = 11.885;   // half-length (m)
const FPS = 30;
const DURATION = 28;  // seconds

// ── Seeded LCG RNG ─────────────────────────────────────────────────────────
function mkRng(seed) {
  let s = seed | 0;
  return () => {
    s = (Math.imul(1664525, s) + 1013904223) | 0;
    return (s >>> 0) / 4294967296;
  };
}
const rng = mkRng(6963094);

function rand(lo, hi) { return lo + rng() * (hi - lo); }
function clamp(v, lo, hi) { return Math.max(lo, Math.min(hi, v)); }
function lerp(a, b, t) { return a + (b - a) * t; }
function r3(n) { return Math.round(n * 1000) / 1000; }

// Move value toward target without exceeding maxStep
function moveToward(from, to, maxStep) {
  const diff = to - from;
  if (Math.abs(diff) <= maxStep) return to;
  return from + Math.sign(diff) * maxStep;
}

function easeIn(t) { return t * t * t; }
function easeOut(t) { return 1 - Math.pow(1 - t, 3); }

// ── Shot catalogue (VISUAL speeds — ~40% slower for smooth 3D appearance) ──
// Real tennis: drive 145-200 km/h. Visually at 30fps we use ~85-120 km/h
// so each shot lasts 40-90 frames and the ball arc is clearly visible.
const SHOTS = [
  { name:'heavy_topspin', spdLo: 72, spdHi:102, arc:0.092, spinLo:2800, spinHi:4500, w:0.32 },
  { name:'flat_drive',    spdLo: 90, spdHi:124, arc:0.030, spinLo:1400, spinHi:2400, w:0.28 },
  { name:'slice',         spdLo: 55, spdHi: 82, arc:0.025, spinLo: 350, spinHi:1100, w:0.18 },
  { name:'crosscourt',    spdLo: 78, spdHi:108, arc:0.058, spinLo:2000, spinHi:3200, w:0.14 },
  { name:'lob',           spdLo: 34, spdHi: 55, arc:0.280, spinLo: 180, spinHi: 600, w:0.08 },
];

function pickShot() {
  let r = rng(), cum = 0;
  for (const s of SHOTS) { cum += s.w; if (r < cum) return s; }
  return SHOTS[0];
}

// ── Player velocity cap ─────────────────────────────────────────────────────
const MAX_PLAYER_SPEED = 0.10; // m/frame at 30fps  →  3.0 m/s sprint
const REACTION_FRAMES  = 8;    // frames before receiver starts moving (~0.27s)

// ── Main rally generator ────────────────────────────────────────────────────
function generateRally() {
  const totalFrames = Math.ceil(DURATION * FPS);

  // ─── Plan shot sequence ───────────────────────────────────────────────────
  const shots = [];
  let frame  = 0;
  let hitter = 'p1';

  // Starting ball contact point (P1 near baseline, slightly off-centre)
  let cx = rand(-0.6, 0.6);
  let cy = 0.88;
  let cz = HL * 0.905;

  while (frame < totalFrames - 10) {
    const spec  = pickShot();
    const speed = rand(spec.spdLo, spec.spdHi);
    const spin  = Math.round(rand(spec.spinLo, spec.spinHi));

    // Landing: realistic deep-court targets for Djokovic/Nadal style
    const lx = clamp(rand(-HW + 0.6, HW - 0.6), -HW + 0.4, HW - 0.4);
    const lz = hitter === 'p1'
      ? clamp(rand(-HL * 0.88, -HL * 0.50), -HL + 0.3, -1.2)   // deep
      : clamp(rand( HL * 0.50,  HL * 0.88),  1.2, HL - 0.3);

    const dist     = Math.hypot(lx - cx, lz - cz);
    const flightT  = dist / (speed / 3.6);
    const nFrames  = Math.max(35, Math.round(flightT * FPS));    // min 35 frames

    if (frame + nFrames > totalFrames + 10) break;

    shots.push({ hitter, cx, cy, cz, lx, lz, spec, speed, spin, nFrames, startFrame: frame });
    frame += nFrames;

    // Next contact from landing (bounce back up slightly)
    cx = lx + rand(-0.3, 0.3);
    cy = rand(0.42, 0.98);
    cz = lz;
    hitter = hitter === 'p1' ? 'p2' : 'p1';
  }

  // ─── Render frames ────────────────────────────────────────────────────────
  // Track player positions as actual state (velocity-capped)
  let p1x = rand(-0.4, 0.4);
  let p1z = HL  * 0.905;
  let p2x = rand(-0.6, 0.6);
  let p2z = -HL * 0.905;

  const sequence = [];
  let prevBx = 0, prevBy = 1, prevBz = 0;

  for (let fi = 0; fi < totalFrames; fi++) {
    // ── Current shot ───────────────────────────────────────────────────────
    let sh = shots[shots.length - 1];
    for (const s of shots) {
      if (fi < s.startFrame + s.nFrames) { sh = s; break; }
    }

    const rawT  = (fi - sh.startFrame) / sh.nFrames;
    const shotT = clamp(rawT, 0, 1);

    // ── Ball position ──────────────────────────────────────────────────────
    // Smooth S-curve for horizontal motion (not linear)
    const horzT = shotT < 0.5
      ? 4 * shotT * shotT * shotT
      : 1 - Math.pow(-2 * shotT + 2, 3) / 2;

    const bx  = lerp(sh.cx, sh.lx, horzT);
    const bz  = lerp(sh.cz, sh.lz, horzT);
    const arcH = Math.hypot(sh.lx - sh.cx, sh.lz - sh.cz) * sh.spec.arc;
    // Arc: rises then drops; lands at ~0.12m height (after bounce)
    const by  = Math.max(0.07,
      lerp(sh.cy, 0.12, shotT) + arcH * Math.sin(shotT * Math.PI)
    );

    // ── Ball speed display ─────────────────────────────────────────────────
    const decel = Math.pow(clamp(1 - shotT, 0, 1), 0.5);
    const spd   = sh.speed * (0.20 + 0.80 * decel);

    // ── Player target positions ────────────────────────────────────────────
    // Hitter: recover to their baseline after hitting
    // Receiver: sprint toward landing after reaction delay

    const reactionT = clamp((fi - sh.startFrame - REACTION_FRAMES) / (sh.nFrames - REACTION_FRAMES), 0, 1);
    const sprintFrac = easeOut(reactionT);

    // Hitter recovers toward their baseline centre
    const p1BaseX = 0, p1BaseZ = HL  * 0.905;
    const p2BaseX = 0, p2BaseZ = -HL * 0.905;

    let targetP1x, targetP1z, targetP2x, targetP2z;

    if (sh.hitter === 'p1') {
      // Djokovic (p1) just hit — recover toward centre baseline
      targetP1x = lerp(sh.cx, p1BaseX, easeOut(shotT * 1.4));
      targetP1z = lerp(sh.cz, p1BaseZ, easeOut(shotT * 1.4));
      // Nadal (p2) sprints toward landing
      targetP2x = lerp(p2BaseX, clamp(sh.lx, -HW + 0.4, HW - 0.4), sprintFrac);
      targetP2z = lerp(p2BaseZ, clamp(sh.lz, -HL + 0.3, -1.0), sprintFrac);
    } else {
      // Nadal (p2) just hit — recover
      targetP2x = lerp(sh.cx, p2BaseX, easeOut(shotT * 1.4));
      targetP2z = lerp(sh.cz, p2BaseZ, easeOut(shotT * 1.4));
      // Djokovic (p1) sprints
      targetP1x = lerp(p1BaseX, clamp(sh.lx, -HW + 0.4, HW - 0.4), sprintFrac);
      targetP1z = lerp(p1BaseZ, clamp(sh.lz, 1.0, HL - 0.3), sprintFrac);
    }

    // Velocity-cap: player can only move MAX_PLAYER_SPEED per frame
    p1x = moveToward(p1x, targetP1x, MAX_PLAYER_SPEED);
    p1z = moveToward(p1z, targetP1z, MAX_PLAYER_SPEED);
    p2x = moveToward(p2x, targetP2x, MAX_PLAYER_SPEED);
    p2z = moveToward(p2z, targetP2z, MAX_PLAYER_SPEED);

    // Keep players in their halves
    p1z = clamp(p1z,  0.5, HL  - 0.2);
    p2z = clamp(p2z, -HL + 0.2, -0.5);
    p1x = clamp(p1x, -HW + 0.3, HW - 0.3);
    p2x = clamp(p2x, -HW + 0.3, HW - 0.3);

    prevBx = bx; prevBy = by; prevBz = bz;

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
      spin_rate_rpm:  sh.spin,
      hitter: shotT < 0.05 ? sh.hitter : null,
    });
  }

  return sequence;
}

// ── Gaussian smoothing (3-tap, applied to ball and player coords) ───────────
function gaussSmooth(seq, sigma = 0.5) {
  // 3-tap weights for sigma≈0.5: [0.27, 0.46, 0.27]
  const w = [0.27, 0.46, 0.27];
  return seq.map((f, i) => {
    const a = seq[Math.max(0, i - 1)];
    const b = f;
    const c = seq[Math.min(seq.length - 1, i + 1)];

    const smBx = a.ball.position.x * w[0] + b.ball.position.x * w[1] + c.ball.position.x * w[2];
    const smBy = a.ball.position.y * w[0] + b.ball.position.y * w[1] + c.ball.position.y * w[2];
    const smBz = a.ball.position.z * w[0] + b.ball.position.z * w[1] + c.ball.position.z * w[2];

    const smP1x = a.players[0].position.x * w[0] + b.players[0].position.x * w[1] + c.players[0].position.x * w[2];
    const smP1z = a.players[0].position.z * w[0] + b.players[0].position.z * w[1] + c.players[0].position.z * w[2];
    const smP2x = a.players[1].position.x * w[0] + b.players[1].position.x * w[1] + c.players[1].position.x * w[2];
    const smP2z = a.players[1].position.z * w[0] + b.players[1].position.z * w[1] + c.players[1].position.z * w[2];

    return {
      ...f,
      ball: { ...f.ball, position: { x: r3(smBx), y: r3(Math.max(0.07, smBy)), z: r3(smBz) } },
      players: [
        { id: 'player_bottom', position: { x: r3(smP1x), y: 0, z: r3(f.players[0].position.z) } },
        { id: 'player_top',    position: { x: r3(smP2x), y: 0, z: r3(f.players[1].position.z) } },
      ],
    };
  });
}

// ── Run ──────────────────────────────────────────────────────────────────────
console.log('Generating Djokovic vs Nadal rally...');
const raw = generateRally();
const smoothed = gaussSmooth(gaussSmooth(raw)); // two passes

const output = JSON.stringify({ sequence: smoothed });
writeFileSync('frontend/public/demo_data.json', output);

const speeds = smoothed.map(f => f.ball_speed_kmh).filter(s => s > 20);
const hits   = smoothed.filter(f => f.hitter).length;
const maxSpd = Math.max(...speeds).toFixed(0);
const avgSpd = (speeds.reduce((a, b) => a + b, 0) / speeds.length).toFixed(0);

console.log(`✅ demo_data.json written`);
console.log(`   Frames : ${smoothed.length}  (${DURATION}s @ ${FPS}fps)`);
console.log(`   Shots  : ${hits}`);
console.log(`   Speed  : avg ${avgSpd} km/h  |  peak ${maxSpd} km/h`);
console.log(`   Size   : ${(output.length / 1024).toFixed(1)} KB`);
