"""
Cinematic tennis rally generator — SEAMLESS arcs, zero pause frames.

The ball is ALWAYS in the air. When it arrives at the receiver's side,
it immediately starts the next arc (receiver hits it right there).
No 'catching' frames. No speed=0. Looks like a real broadcast rally.
"""
import json, math, random, os

OUTPUT_JSON = os.path.join(os.path.dirname(__file__), "..", "data", "real_match_data.json")
PUBLIC_JSON = os.path.join(os.path.dirname(__file__), "..", "frontend", "public", "demo_data.json")
FPS = 30
HALF_W = 4.115   # court half-width
BL = 11.0        # baseline Z distance from net

random.seed(42)

# Shot types: (speed_range_kmh, arc_height_mult, spin_range_rpm)
SHOT_TYPES = [
    # flat drive — fast, low arc
    {"speed": (145, 200), "arc": 0.035, "spin": (1600, 2600), "w": 0.40},
    # topspin — medium, looping arc
    {"speed": (105, 155), "arc": 0.080, "spin": (2600, 4200), "w": 0.35},
    # slice — moderate, skidding arc
    {"speed": (85,  130), "arc": 0.025, "spin": ( 500, 1200), "w": 0.15},
    # lob — slow, very high arc
    {"speed": (55,   90), "arc": 0.200, "spin": ( 300,  800), "w": 0.10},
]

def pick_shot():
    r, cum = random.random(), 0.0
    for s in SHOT_TYPES:
        cum += s["w"]
        if r < cum:
            return s
    return SHOT_TYPES[0]

def lerp(a, b, t): return a + (b - a) * t
def ease_out(t):   return 1 - (1 - t) ** 2.5
def clamp(v,lo,hi):return max(lo, min(hi, v))


def generate():
    frames = []
    idx = 0

    # ── Initial positions ──────────────────────────────────────────────
    p1x, p1z =  0.0, -(BL - 0.8)   # P1 = bottom (near camera)
    p2x, p2z =  0.0,  (BL - 0.8)   # P2 = top

    num_shots = 20

    # ── Pre-plan all shots ─────────────────────────────────────────────
    # Each shot: who hits, where ball lands, shot type
    plans = []
    for i in range(num_shots):
        hitter = "p1" if i % 2 == 0 else "p2"
        st = pick_shot()
        # Landing zone on the opposite half, away from centre (more realistic)
        lx = random.uniform(-HALF_W + 0.9, HALF_W - 0.9)
        if hitter == "p1":
            lz = random.uniform(BL * 0.42, BL * 0.85)   # lands in far court
        else:
            lz = random.uniform(-BL * 0.85, -BL * 0.42) # lands in near court
        plans.append({"hitter": hitter, "lx": lx, "lz": lz, "st": st})

    # ── Contact point for first shot: just in front of P1 ─────────────
    cx, cy, cz = p1x, 0.9, p1z + 0.3  # contact point (ball toss height)

    for shot_i, plan in enumerate(plans):
        hitter = plan["hitter"]
        lx, lz = plan["lx"], plan["lz"]
        st = plan["st"]

        # ── Contact height (varies by shot type) ──────────────────────
        cy = random.uniform(0.45, 1.05)

        # ── Flight parameters ─────────────────────────────────────────
        speed_kmh = random.uniform(*st["speed"])
        dist = math.hypot(lx - cx, lz - cz)
        speed_ms = speed_kmh / 3.6
        ft = dist / speed_ms                     # flight time (s)
        nf = max(8, int(ft * FPS))               # frame count

        peak = cy + dist * st["arc"] + random.uniform(0.05, 0.25)

        # ── Receiver intercept position ───────────────────────────────
        # They'll be right where the ball lands (+tiny lateral offset)
        rx = clamp(lx + random.uniform(-0.25, 0.25), -HALF_W + 0.4, HALF_W - 0.4)
        rz = clamp(lz + random.uniform(-0.2, 0.2), -BL + 0.2, BL - 0.2)

        snap_p1x, snap_p1z = p1x, p1z
        snap_p2x, snap_p2z = p2x, p2z

        # ── Emit flight frames ────────────────────────────────────────
        for f in range(nf):
            t   = f / nf                 # 0 → 1 (exclusive of 1.0 = landing)
            t_b = t                      # ball position param
            te  = ease_out(t)

            # Ball: parabolic arc (asymmetric — drops faster)
            bx = lerp(cx, lx, t_b)
            bz = lerp(cz, lz, t_b)
            # Use sin for natural arc shape
            by = cy * (1 - t_b) + 0.07 * t_b + peak * math.sin(t_b * math.pi)
            by = max(0.07, by)

            # Players move during flight
            t_recv = ease_out(min(1.0, t * 1.6))   # receiver rushes hard
            t_hit  = ease_out(min(1.0, t * 0.6))   # hitter recovers slowly

            if hitter == "p1":
                # P1 (hitter) recovers back toward centre
                p1x = lerp(snap_p1x, snap_p1x * 0.4, t_hit)
                p1z = lerp(snap_p1z, -(BL - 0.8), t_hit * 0.4)
                # P2 (receiver) sprints to intercept
                p2x = lerp(snap_p2x, rx, t_recv)
                p2z = lerp(snap_p2z, rz, t_recv)
            else:
                p2x = lerp(snap_p2x, snap_p2x * 0.4, t_hit)
                p2z = lerp(snap_p2z,  (BL - 0.8), t_hit * 0.4)
                p1x = lerp(snap_p1x, rx, t_recv)
                p1z = lerp(snap_p1z, rz, t_recv)

            # Speed: high at impact (t≈0), low at peak (t≈0.5), rising on descent
            impact  = max(0.0, 1.0 - t * 4)           # sharp peak at t=0
            descent = max(0.0, (t - 0.55) / 0.45)     # rises from t=0.55 onward
            spd = speed_kmh * (0.28 + 0.72 * max(impact, descent * 0.5))

            spin = random.uniform(*st["spin"]) * (0.7 + 0.6 * abs(math.sin(t * math.pi)))

            # is_hitting: True only on the very first frame of each shot
            is_hitting = (f == 0)

            frames.append({
                "frame_index": idx,
                "ball": {
                    "position": {"x": round(bx, 4), "y": round(by, 4), "z": round(bz, 4)},
                    "is_occluded": False
                },
                "players": [
                    {"id": "player_bottom", "position": {"x": round(p1x, 4), "y": 0.0, "z": round(p1z, 4)}},
                    {"id": "player_top",    "position": {"x": round(p2x, 4), "y": 0.0, "z": round(p2z, 4)}}
                ],
                "ball_speed_kmh": round(spd, 1),
                "spin_rate_rpm":  round(spin),
                "hitter": hitter if is_hitting else None
            })
            idx += 1

        # ── Next shot's contact point = landing spot ──────────────────
        # (receiver hits it right where it lands — NO pause frames)
        cx = lx
        cy = random.uniform(0.45, 1.05)   # contact height for next shot
        cz = lz

        # Player positions settle at end of shot
        if hitter == "p1":
            p2x, p2z = rx, rz
        else:
            p1x, p1z = rx, rz

    return frames


if __name__ == "__main__":
    print("Generating seamless tennis rally...")
    seq = generate()
    payload = json.dumps({"sequence": seq}, separators=(',', ':'))
    for path in [OUTPUT_JSON, PUBLIC_JSON]:
        os.makedirs(os.path.dirname(path), exist_ok=True)
        with open(path, 'w') as f:
            f.write(payload)
        print(f"  -> {path}")
    speeds = [f["ball_speed_kmh"] for f in seq if f["ball_speed_kmh"] > 30]
    print(f"Frames: {len(seq)} ({len(seq)/30:.1f}s) | Speed: {min(speeds):.0f}-{max(speeds):.0f} km/h avg={sum(speeds)/len(speeds):.0f}")
