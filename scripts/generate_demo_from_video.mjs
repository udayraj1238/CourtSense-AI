#!/usr/bin/env node
/**
 * generate_demo_from_video.mjs  v3
 *
 * KEY FIX: Ball arcs from RACKET HEIGHT → RACKET HEIGHT (both ends ~0.75-1.1m).
 * Old code dropped ball to ground (0.12m) at landing = looked like catching.
 * Now: ball goes directly racket-to-racket like a real broadcast rally.
 *
 * Also:
 *  - Arm swing triggers at BOTH ends of each shot (hitter + receiver)
 *  - Receiver in position BEFORE ball arrives (not still running at impact)
 *  - Velocity-capped player movement (0.10 m/frame max)
 *  - S-curve horizontal motion
 *  - Gaussian smoothing
 */

import { writeFileSync } from 'fs';

const HW  = 4.115;
const HL  = 11.885;
const FPS = 30;
const DURATION = 28;

// ── Seeded LCG RNG ──────────────────────────────────────────────────────────
function mkRng(seed) {
  let s = seed | 0;
  return () => { s = (Math.imul(1664525, s) + 1013904223) | 0; return (s >>> 0) / 4294967296; };
}
const rng = mkRng(6963094);

function rn(lo, hi)    { return lo + rng() * (hi - lo); }
function clamp(v, lo, hi) { return Math.max(lo, Math.min(hi, v)); }
function lerp(a, b, t) { return a + (b - a) * t; }
function r3(n)         { return Math.round(n * 1000) / 1000; }
function moveToward(from, to, step) {
  const d = to - from;
  return Math.abs(d) <= step ? to : from + Math.sign(d) * step;
}
function easeOut(t)  { return 1 - Math.pow(1 - t, 3); }
function sCurve(t)   { return t < 0.5 ? 4*t*t*t : 1 - Math.pow(-2*t+2, 3)/2; }

// ── Shot types ───────────────────────────────────────────────────────────────
// Arc factor: fraction of court distance that becomes peak height
// E.g. arc=0.08, dist=20m → peak = 1.6m above baseline
const SHOTS = [
  { name:'topspin',  spdLo:68,  spdHi:98,  arc:0.088, spinLo:2800, spinHi:4500, w:0.35 },
  { name:'flat',     spdLo:88,  spdHi:118, arc:0.028, spinLo:1400, spinHi:2400, w:0.28 },
  { name:'slice',    spdLo:52,  spdHi:78,  arc:0.018, spinLo: 300, spinHi:1000, w:0.18 },
  { name:'cross',    spdLo:75,  spdHi:105, arc:0.055, spinLo:2000, spinHi:3200, w:0.12 },
  { name:'lob',      spdLo:32,  spdHi:52,  arc:0.260, spinLo: 150, spinHi: 550, w:0.07 },
];
function pickShot() {
  let r = rng(), cum = 0;
  for (const s of SHOTS) { cum += s.w; if (r < cum) return s; }
  return SHOTS[0];
}

// ── Rally planner ────────────────────────────────────────────────────────────
const MAX_SPD   = 0.10;  // m/frame player velocity cap
const REACT_F   = 7;     // frames reaction delay before receiver moves
const SPRINT_T  = 0.62;  // fraction of shot duration to get in position

function generateRally() {
  const N = Math.ceil(DURATION * FPS);

  // ── Plan shots ──────────────────────────────────────────────────────────
  const shots = [];
  let frame  = 0;
  let hitter = 'p1';

  // Starting contact: P1 near baseline
  let cx = rn(-0.5, 0.5);
  let cz = HL * 0.90;
  let cy = rn(0.78, 1.05);  // racket contact height

  while (frame < N - 10) {
    const spec = pickShot();
    const speed = rn(spec.spdLo, spec.spdHi);
    const spin  = Math.round(rn(spec.spinLo, spec.spinHi));

    // Receiver's contact point (where they'll hit it back)
    // X: cross-court or down-the-line with realistic distribution
    const lx = clamp(rn(-HW + 0.7, HW - 0.7), -HW + 0.4, HW - 0.4);
    // Z: near the receiver's baseline (groundstroke zone)
    const lz = hitter === 'p1'
      ? clamp(rn(-HL * 0.88, -HL * 0.65), -HL + 0.35, -HL * 0.55)
      : clamp(rn( HL * 0.65,  HL * 0.88),  HL * 0.55,  HL - 0.35);
    // Contact height at receiver's end
    const ly = rn(0.72, 1.08);

    const dist    = Math.hypot(lx - cx, lz - cz);
    const nFrames = Math.max(40, Math.round((dist / (speed / 3.6)) * FPS));
    if (frame + nFrames > N + 8) break;

    shots.push({ hitter, cx, cy, cz, lx, ly, lz, spec, speed, spin, nFrames, startFrame: frame });
    frame += nFrames;

    // Next shot: receiver becomes hitter at the same contact point
    cx = lx; cy = ly; cz = lz;
    hitter = hitter === 'p1' ? 'p2' : 'p1';
  }
  if (!shots.length) return [];

  // ── Render frames ────────────────────────────────────────────────────────
  let p1x = 0,  p1z = HL  * 0.905;
  let p2x = 0,  p2z = -HL * 0.905;

  const sequence = [];

  for (let fi = 0; fi < N; fi++) {
    // Current shot
    let sh = shots[shots.length - 1];
    for (const s of shots) { if (fi < s.startFrame + s.nFrames) { sh = s; break; } }

    const shotT = clamp((fi - sh.startFrame) / sh.nFrames, 0, 1);

    // ── Ball: racket-height → arc → racket-height ────────────────────────
    // NEVER drops to ground — goes from cy to ly with parabolic arc
    const horzT = sCurve(shotT);
    const bx    = lerp(sh.cx, sh.lx, horzT);
    const bz    = lerp(sh.cz, sh.lz, horzT);
    const dist  = Math.hypot(sh.lx - sh.cx, sh.lz - sh.cz);
    const arcH  = dist * sh.spec.arc;
    const baseY = lerp(sh.cy, sh.ly, shotT);        // interpolate contact heights
    const by    = Math.max(0.08, baseY + arcH * Math.sin(shotT * Math.PI));

    // ── Speed profile: fast off racket, decelerates ──────────────────────
    const spd = sh.speed * (0.22 + 0.78 * Math.sqrt(clamp(1 - shotT, 0, 1)));

    // ── Hitter trigger: START and END of each shot ───────────────────────
    // This gives both players a swing animation
    const receiver = sh.hitter === 'p1' ? 'p2' : 'p1';
    const hitterTrig  = shotT < 0.06 ? sh.hitter : null;
    const receiverTrig = shotT > 0.93 ? receiver : null;
    const hitterOut = hitterTrig ?? receiverTrig;

    // ── Player targets ───────────────────────────────────────────────────
    // Hitter: starts at contact point, recovers to centre baseline
    // Receiver: sprints to contact point, arrives early (before ball lands)
    const recoverFrac = easeOut(clamp(shotT * 1.5, 0, 1));

    // Reaction + sprint: receiver starts moving after REACT_F frames
    // and should be in position by SPRINT_T fraction of shot duration
    const reactionT  = clamp((shotT - REACT_F/sh.nFrames) / SPRINT_T, 0, 1);
    const sprintFrac = easeOut(reactionT);

    const P1_BASE_X = 0, P1_BASE_Z = HL  * 0.905;
    const P2_BASE_X = 0, P2_BASE_Z = -HL * 0.905;

    let tP1x, tP1z, tP2x, tP2z;
    if (sh.hitter === 'p1') {
      // P1 recovers to baseline after hitting
      tP1x = lerp(sh.cx, P1_BASE_X, recoverFrac);
      tP1z = lerp(sh.cz, P1_BASE_Z, recoverFrac);
      // P2 sprints to contact position early
      tP2x = lerp(P2_BASE_X, sh.lx, sprintFrac);
      tP2z = lerp(P2_BASE_Z, sh.lz, sprintFrac);
    } else {
      // P2 recovers
      tP2x = lerp(sh.cx, P2_BASE_X, recoverFrac);
      tP2z = lerp(sh.cz, P2_BASE_Z, recoverFrac);
      // P1 sprints
      tP1x = lerp(P1_BASE_X, sh.lx, sprintFrac);
      tP1z = lerp(P1_BASE_Z, sh.lz, sprintFrac);
    }

    // Velocity-cap: no teleporting
    p1x = moveToward(p1x, tP1x, MAX_SPD);
    p1z = moveToward(p1z, tP1z, MAX_SPD);
    p2x = moveToward(p2x, tP2x, MAX_SPD);
    p2z = moveToward(p2z, tP2z, MAX_SPD);

    // Keep players in their court halves
    p1z = clamp(p1z,  0.4, HL  - 0.2);
    p2z = clamp(p2z, -HL + 0.2, -0.4);
    p1x = clamp(p1x, -HW + 0.3, HW - 0.3);
    p2x = clamp(p2x, -HW + 0.3, HW - 0.3);

    sequence.push({
      frame_index: fi,
      ball: { position: { x: r3(bx), y: r3(by), z: r3(bz) }, is_occluded: false },
      players: [
        { id: 'player_bottom', position: { x: r3(p1x), y: 0, z: r3(p1z) } },
        { id: 'player_top',    position: { x: r3(p2x), y: 0, z: r3(p2z) } },
      ],
      ball_speed_kmh: r3(spd),
      spin_rate_rpm:  sh.spin,
      hitter: hitterOut,
    });
  }

  return sequence;
}

// ── Gaussian smoothing (ball coords only — players already smooth) ───────────
function smooth(seq) {
  const w = [0.25, 0.50, 0.25];
  return seq.map((f, i) => {
    const a = seq[Math.max(0, i-1)], b = f, c = seq[Math.min(seq.length-1, i+1)];
    return { ...f, ball: { ...f.ball, position: {
      x: r3(a.ball.position.x*w[0] + b.ball.position.x*w[1] + c.ball.position.x*w[2]),
      y: r3(Math.max(0.08, a.ball.position.y*w[0] + b.ball.position.y*w[1] + c.ball.position.y*w[2])),
      z: r3(a.ball.position.z*w[0] + b.ball.position.z*w[1] + c.ball.position.z*w[2]),
    }}};
  });
}

// ── Run ──────────────────────────────────────────────────────────────────────
console.log('Generating Djokovic vs Nadal rally (v3 — racket-to-racket arcs)...');
const raw      = generateRally();
const smoothed = smooth(smooth(raw));

writeFileSync('frontend/public/demo_data.json', JSON.stringify({ sequence: smoothed }));

const speeds = smoothed.map(f => f.ball_speed_kmh).filter(s => s > 15);
const hits   = smoothed.filter(f => f.hitter).length;
console.log(`✅ demo_data.json written`);
console.log(`   Frames: ${smoothed.length}  (${DURATION}s @ ${FPS}fps)`);
console.log(`   Shots (hit events): ${hits}`);
console.log(`   Speed: avg ${(speeds.reduce((a,b)=>a+b,0)/speeds.length).toFixed(0)} km/h | peak ${Math.max(...speeds).toFixed(0)} km/h`);
console.log(`   Size: ${(JSON.stringify({sequence:smoothed}).length/1024).toFixed(1)} KB`);
