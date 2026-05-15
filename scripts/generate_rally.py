"""
Generate a cinematic, realistic tennis rally for the CourtSense AI demo.

Goals:
- Ball arcs look like real shots (fast, flat drives & looping topspin)
- NO "holding" frames — ball is always either in flight or just bouncing
- Players move to intercept BEFORE the ball arrives (anticipation)
- Speed peaks 120-200 km/h right after impact, drops at peak arc
- Spin varies per shot type
- 16 rally shots, ~25 seconds total
"""
import json, math, random, os

OUTPUT_JSON  = os.path.join(os.path.dirname(__file__), "..", "data", "real_match_data.json")
PUBLIC_JSON  = os.path.join(os.path.dirname(__file__), "..", "frontend", "public", "demo_data.json")
FPS = 30
SINGLES_HALF_W = 4.115
BASELINE_Z = 11.0   # half-court length
NET_Z = 0.0

random.seed(7)

def lerp(a, b, t):
    return a + (b - a) * t

def ease_out(t):
    return 1 - (1 - t) ** 3

def ease_in_out(t):
    return t * t * (3 - 2 * t)

def clamp(v, lo, hi):
    return max(lo, min(hi, v))


SHOT_TYPES = [
    {"name": "drive",   "speed": (140, 195), "spin": (1800, 2800), "peak_mult": 0.04, "frames_per_m": 1.1},
    {"name": "topspin", "speed": (110, 155), "spin": (2800, 4500), "peak_mult": 0.09, "frames_per_m": 1.4},
    {"name": "slice",   "speed": (90, 130),  "spin": (600, 1200),  "peak_mult": 0.03, "frames_per_m": 1.3},
    {"name": "lob",     "speed": (60, 90),   "spin": (400, 900),   "peak_mult": 0.20, "frames_per_m": 1.8},
]

def pick_shot():
    weights = [0.45, 0.35, 0.12, 0.08]
    r = random.random()
    cumul = 0
    for i, w in enumerate(weights):
        cumul += w
        if r < cumul:
            return SHOT_TYPES[i]
    return SHOT_TYPES[0]


def generate_rally():
    sequence = []
    frame_idx = 0

    # Player positions
    p1x, p1z =  0.0, -(BASELINE_Z - 0.5)   # bottom player (near camera)
    p2x, p2z =  0.0,  (BASELINE_Z - 0.5)   # top player

    num_shots = 18

    # Pre-plan landing spots
    shots = []
    for i in range(num_shots):
        shot_type = pick_shot()
        # Alternate who hits
        hitter = "p1" if (i % 2 == 0) else "p2"
        # Landing zone — crosscourt or down-the-line
        land_x = random.uniform(-SINGLES_HALF_W + 0.8, SINGLES_HALF_W - 0.8)
        if hitter == "p1":
            land_z = random.uniform(BASELINE_Z * 0.45, BASELINE_Z * 0.88)  # lands in far court
        else:
            land_z = random.uniform(-BASELINE_Z * 0.88, -BASELINE_Z * 0.45)  # lands in near court
        shots.append({"hitter": hitter, "land_x": land_x, "land_z": land_z, "type": shot_type})

    for shot_i, shot in enumerate(shots):
        st = shot["type"]
        hitter = shot["hitter"]
        land_x = shot["land_x"]
        land_z = shot["land_z"]

        # --- Determine hitter position (where they'll actually make contact) ---
        if hitter == "p1":
            hit_x = p1x + random.uniform(-0.6, 0.6)
            hit_z = p1z + random.uniform(-0.3, 0.3)
            hit_x = clamp(hit_x, -SINGLES_HALF_W + 0.3, SINGLES_HALF_W - 0.3)
        else:
            hit_x = p2x + random.uniform(-0.6, 0.6)
            hit_z = p2z + random.uniform(-0.3, 0.3)
            hit_x = clamp(hit_x, -SINGLES_HALF_W + 0.3, SINGLES_HALF_W - 0.3)

        # Contact height depends on shot type
        hit_y = random.uniform(0.5, 1.2)

        # --- Flight geometry ---
        dist = math.sqrt((land_x - hit_x) ** 2 + (land_z - hit_z) ** 2)
        speed_kmh = random.uniform(*st["speed"])
        # Convert speed to flight time
        speed_ms = speed_kmh / 3.6
        flight_time = dist / speed_ms  # seconds
        flight_frames = max(10, int(flight_time * FPS))

        peak_h = hit_y + dist * st["peak_mult"] + random.uniform(0.1, 0.4)

        # --- Pre-compute receiver intercept position ---
        # Receiver moves to where the ball will land
        if hitter == "p1":
            # p2 moves toward landing zone
            recv_x = clamp(land_x * 0.85, -SINGLES_HALF_W + 0.5, SINGLES_HALF_W - 0.5)
            recv_z = clamp(land_z + random.uniform(-0.4, 0.4), -BASELINE_Z + 0.3, BASELINE_Z - 0.3)
        else:
            recv_x = clamp(land_x * 0.85, -SINGLES_HALF_W + 0.5, SINGLES_HALF_W - 0.5)
            recv_z = clamp(land_z + random.uniform(-0.4, 0.4), -BASELINE_Z + 0.3, BASELINE_Z - 0.3)

        # Snapshot of where players are at shot start
        snap_p1x, snap_p1z = p1x, p1z
        snap_p2x, snap_p2z = p2x, p2z

        # --- Emit flight frames ---
        for f in range(flight_frames):
            t = f / flight_frames  # 0→1 over flight

            # Ball: smooth parabola
            bx = lerp(hit_x, land_x, t)
            bz = lerp(hit_z, land_z, t)
            # Parabola peaks at t=0.45 (slight asymmetry, ball drops faster)
            tp = (t - 0.45) / 0.55 if t > 0.45 else t / 0.45
            by = peak_h * (1 - tp * tp) + (1 - t) * hit_y * 0.3 + t * 0.08
            by = max(0.07, by)

            # Players move DURING the flight
            t_recv = ease_out(min(1.0, t * 1.4))  # receiver rushes to position
            t_hitter = ease_in_out(min(1.0, t * 0.7))  # hitter recovers toward center

            if hitter == "p1":
                # P1 (hitter) recovers toward center baseline
                p1x = lerp(snap_p1x, snap_p1x * 0.3, t_hitter)
                p1z = lerp(snap_p1z, -(BASELINE_Z - 0.5), t_hitter * 0.5)
                # P2 (receiver) sprints to intercept
                p2x = lerp(snap_p2x, recv_x, t_recv)
                p2z = lerp(snap_p2z, recv_z, t_recv)
            else:
                # P2 (hitter) recovers
                p2x = lerp(snap_p2x, snap_p2x * 0.3, t_hitter)
                p2z = lerp(snap_p2z, (BASELINE_Z - 0.5), t_hitter * 0.5)
                # P1 (receiver) sprints to intercept
                p1x = lerp(snap_p1x, recv_x, t_recv)
                p1z = lerp(snap_p1z, recv_z, t_recv)

            # Speed: peaks right after impact, drops at apex, rises again on descent
            impact_t = max(0.0, 1 - t * 3)    # high at t=0, gone by t=0.33
            descent_t = max(0.0, (t - 0.6) / 0.4)  # rises from t=0.6 to 1.0
            frame_speed = speed_kmh * (0.35 + 0.65 * max(impact_t, descent_t * 0.4))

            spin = random.uniform(*st["spin"]) * (0.8 + 0.4 * abs(math.sin(t * math.pi)))

            sequence.append(_make_frame(frame_idx, bx, by, bz, p1x, p1z, p2x, p2z, frame_speed, spin))
            frame_idx += 1

        # --- 2-frame "bounce" micro-sequence (ball at landing spot) ---
        for bf in range(2):
            bt = bf / 2
            bounce_y = 0.08 + (1 - bt) * 0.35  # brief upward kick
            p1x = lerp(p1x, recv_x if hitter == "p2" else p1x, 0.3)
            p2x = lerp(p2x, recv_x if hitter == "p1" else p2x, 0.3)
            sequence.append(_make_frame(frame_idx, land_x, bounce_y, land_z, p1x, p1z, p2x, p2z, 0, 0))
            frame_idx += 1

        # Players are now at their new positions
        if hitter == "p1":
            p2x, p2z = recv_x, recv_z
        else:
            p1x, p1z = recv_x, recv_z

    return sequence


def _make_frame(idx, bx, by, bz, p1x, p1z, p2x, p2z, speed, spin):
    return {
        "frame_index": idx,
        "ball": {
            "position": {"x": round(bx, 4), "y": round(max(0.07, by), 4), "z": round(bz, 4)},
            "is_occluded": False
        },
        "players": [
            {"id": "player_bottom", "position": {"x": round(p1x, 4), "y": 0.0, "z": round(p1z, 4)}},
            {"id": "player_top",    "position": {"x": round(p2x, 4), "y": 0.0, "z": round(p2z, 4)}}
        ],
        "ball_speed_kmh": round(speed, 1),
        "spin_rate_rpm": round(spin, 0)
    }


if __name__ == "__main__":
    print("Generating cinematic tennis rally...")
    seq = generate_rally()

    payload = json.dumps({"sequence": seq}, separators=(',', ':'))

    for out_path in [OUTPUT_JSON, PUBLIC_JSON]:
        os.makedirs(os.path.dirname(out_path), exist_ok=True)
        with open(out_path, 'w') as f:
            f.write(payload)
        print(f"  Written: {out_path}")

    speeds = [f["ball_speed_kmh"] for f in seq if f["ball_speed_kmh"] > 0]
    print(f"Generated {len(seq)} frames ({len(seq)/FPS:.1f}s)")
    print(f"Ball speed: {min(speeds):.0f} - {max(speeds):.0f} km/h  avg={sum(speeds)/len(speeds):.0f}")
