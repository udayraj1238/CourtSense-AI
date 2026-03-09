"""
Generate realistic synthetic tennis rally data.
Ball always originates FROM the hitting player and arrives AT the receiving player.
Players move to position BEFORE the ball arrives.
"""
import json, math, random, os

OUTPUT_JSON = os.path.join(os.path.dirname(__file__), "..", "data", "real_match_data.json")
FPS = 30

# Court dimensions (meters)
SINGLES_HALF_W = 4.115

random.seed(42)

def lerp(a, b, t):
    return a + (b - a) * t

def ease_in_out(t):
    """Smooth ease-in-out curve."""
    return t * t * (3 - 2 * t)

def generate_rally():
    """Generate a rally where ball perfectly syncs with player positions."""
    
    # --- Pre-plan the entire rally as a sequence of SHOTS ---
    # Each shot: hitter moves to hit position, hits ball, ball flies to receiver
    num_shots = 16
    
    # Generate hit/receive positions for each shot
    shot_plan = []
    for i in range(num_shots):
        # Where the hitter stands when hitting (slight variation around center)
        hit_x = random.uniform(-2.0, 2.0)
        
        # Where the ball will land (on the opposite side)
        # Alternate: even shots go to far court (top), odd to near court (bottom)
        if i % 2 == 0:
            land_x = random.uniform(-SINGLES_HALF_W + 0.5, SINGLES_HALF_W - 0.5)
            land_z = random.uniform(5.5, 8.5)   # Far court
        else:
            land_x = random.uniform(-SINGLES_HALF_W + 0.5, SINGLES_HALF_W - 0.5)
            land_z = random.uniform(-8.5, -5.5)  # Near court
        
        shot_plan.append({
            "hit_x": hit_x,
            "land_x": land_x,
            "land_z": land_z
        })
    
    # --- Build frame-by-frame animation ---
    sequence = []
    
    # Player positions (actual displayed positions)
    p1_x, p1_z = 0.0, -9.0   # Bottom player (near camera)
    p2_x, p2_z = 0.0, 9.0    # Top player (far side)
    
    # Ball
    ball_x, ball_y, ball_z = 0.0, 1.0, p1_z
    
    current_shot = 0
    frame_idx = 0
    
    # Phases: PREPARE (receiver moves to position) -> HIT (ball in flight)
    PREPARE_FRAMES = 20  # Frames for player to get into position
    
    while current_shot < num_shots and frame_idx < 600:
        shot = shot_plan[current_shot]
        is_p1_hitting = (current_shot % 2 == 1)  # P1 hits on odd shots (returning from far court)
        
        if current_shot == 0:
            is_p1_hitting = True  # P1 serves first
        
        # Determine hitter and receiver
        if is_p1_hitting:
            hitter_x, hitter_z = p1_x, p1_z
            receiver_target_x = shot["land_x"]
            receiver_target_z = shot["land_z"]  # Ball goes to top court
        else:
            hitter_x, hitter_z = p2_x, p2_z
            receiver_target_x = shot["land_x"]
            receiver_target_z = shot["land_z"]  # Ball goes to bottom court
        
        # --- Phase 1: PREPARE (player moves to hit position + receiver gets ready) ---
        prepare_start_p1_x, prepare_start_p1_z = p1_x, p1_z
        prepare_start_p2_x, prepare_start_p2_z = p2_x, p2_z
        
        # Hitter adjusts position slightly, receiver starts moving toward landing spot
        if is_p1_hitting:
            p1_hit_x = hitter_x + (shot["hit_x"] - hitter_x) * 0.3
            p1_hit_z = -9.0 + random.uniform(-0.3, 0.3)
            p2_recv_x = receiver_target_x
            p2_recv_z = 9.0 + random.uniform(-0.3, 0.3)
        else:
            p2_hit_x = hitter_x + (shot["hit_x"] - hitter_x) * 0.3
            p2_hit_z = 9.0 + random.uniform(-0.3, 0.3)
            p1_recv_x = receiver_target_x
            p1_recv_z = -9.0 + random.uniform(-0.3, 0.3)
        
        for f in range(PREPARE_FRAMES):
            t = ease_in_out(f / PREPARE_FRAMES)
            
            if is_p1_hitting:
                p1_x = lerp(prepare_start_p1_x, p1_hit_x, t)
                p1_z = lerp(prepare_start_p1_z, p1_hit_z, t)
                p2_x = lerp(prepare_start_p2_x, p2_recv_x, t * 0.5)  # Start moving
                p2_z = lerp(prepare_start_p2_z, p2_recv_z, t * 0.3)
            else:
                p2_x = lerp(prepare_start_p2_x, p2_hit_x, t)
                p2_z = lerp(prepare_start_p2_z, p2_hit_z, t)
                p1_x = lerp(prepare_start_p1_x, p1_recv_x, t * 0.5)
                p1_z = lerp(prepare_start_p1_z, p1_recv_z, t * 0.3)
            
            # Ball stays with hitter during prepare
            if is_p1_hitting:
                ball_x, ball_y, ball_z = p1_x, 1.0, p1_z
            else:
                ball_x, ball_y, ball_z = p2_x, 1.0, p2_z
            
            sequence.append(_make_frame(frame_idx, ball_x, ball_y, ball_z, p1_x, p1_z, p2_x, p2_z, 0, 800))
            frame_idx += 1
        
        # --- Phase 2: FLIGHT (ball travels from hitter to landing zone) ---
        # Record exact start position (= hitter's current displayed position)
        start_bx = p1_x if is_p1_hitting else p2_x
        start_bz = p1_z if is_p1_hitting else p2_z
        
        # Exact end position (where receiver will be when ball arrives)
        if is_p1_hitting:
            end_bx = p2_recv_x
            end_bz = p2_recv_z
        else:
            end_bx = p1_recv_x
            end_bz = p1_recv_z
        
        # Flight duration based on distance
        dist = math.sqrt((end_bx - start_bx)**2 + (end_bz - start_bz)**2)
        flight_frames = max(18, int(dist * 1.6))
        
        # Record positions at flight start for smooth interpolation
        flight_start_p1_x, flight_start_p1_z = p1_x, p1_z
        flight_start_p2_x, flight_start_p2_z = p2_x, p2_z
        
        for f in range(flight_frames):
            t = f / flight_frames
            t_smooth = ease_in_out(t)
            
            # Ball follows parabolic arc
            ball_x = lerp(start_bx, end_bx, t)
            ball_z = lerp(start_bz, end_bz, t)
            peak = 1.2 + dist * 0.06
            ball_y = 0.4 + peak * 4 * t * (1 - t)
            
            # Players continue moving during flight
            # Receiver must arrive at landing spot by t=1.0
            if is_p1_hitting:
                # P1 (hitter) recovers toward center
                p1_x = lerp(flight_start_p1_x, flight_start_p1_x * 0.4, t_smooth * 0.5)
                p1_z = lerp(flight_start_p1_z, -9.0, t_smooth * 0.3)
                # P2 (receiver) reaches target by end
                p2_x = lerp(flight_start_p2_x, p2_recv_x, t_smooth)
                p2_z = lerp(flight_start_p2_z, p2_recv_z, t_smooth)
            else:
                p2_x = lerp(flight_start_p2_x, flight_start_p2_x * 0.4, t_smooth * 0.5)
                p2_z = lerp(flight_start_p2_z, 9.0, t_smooth * 0.3)
                p1_x = lerp(flight_start_p1_x, p1_recv_x, t_smooth)
                p1_z = lerp(flight_start_p1_z, p1_recv_z, t_smooth)
            
            # Speed calculation
            speed_kmh = 0
            if len(sequence) > 0:
                prev = sequence[-1]["ball"]["position"]
                dx = ball_x - prev["x"]
                dy = ball_y - prev["y"]
                dz = ball_z - prev["z"]
                speed_kmh = min(220.0, math.sqrt(dx*dx + dy*dy + dz*dz) * FPS * 3.6)
            
            spin = 800 + abs(math.sin(frame_idx * 0.1)) * 2200
            
            sequence.append(_make_frame(frame_idx, ball_x, ball_y, ball_z, p1_x, p1_z, p2_x, p2_z, speed_kmh, spin))
            frame_idx += 1
        
        # Update player positions to their final spots
        if is_p1_hitting:
            p2_x, p2_z = p2_recv_x, p2_recv_z
        else:
            p1_x, p1_z = p1_recv_x, p1_recv_z
        
        current_shot += 1
    
    return sequence


def _make_frame(idx, bx, by, bz, p1x, p1z, p2x, p2z, speed, spin):
    return {
        "frame_index": idx,
        "ball": {
            "position": {"x": round(bx, 3), "y": round(max(0.07, by), 3), "z": round(bz, 3)},
            "is_occluded": False
        },
        "players": [
            {"id": "player_bottom", "position": {"x": round(p1x, 3), "y": 0.0, "z": round(p1z, 3)}},
            {"id": "player_top",    "position": {"x": round(p2x, 3), "y": 0.0, "z": round(p2z, 3)}}
        ],
        "ball_speed_kmh": round(speed, 1),
        "spin_rate_rpm": round(spin, 0)
    }


if __name__ == "__main__":
    print("Generating realistic tennis rally...")
    seq = generate_rally()
    
    with open(OUTPUT_JSON, 'w') as f:
        json.dump({"sequence": seq}, f, indent=2)
    
    print(f"Generated {len(seq)} frames ({len(seq)/FPS:.1f}s)")
    
    speeds = [f["ball_speed_kmh"] for f in seq]
    print(f"Ball speed: {min(speeds):.0f} - {max(speeds):.0f} km/h")
    print(f"Saved to {OUTPUT_JSON}")
