"""
Generate realistic synthetic tennis rally data.
Creates a JSON file with smooth, natural player and ball movement
that looks like a real tennis singles rally.
"""
import json, math, random, os

OUTPUT_JSON = os.path.join(os.path.dirname(__file__), "..", "data", "real_match_data.json")
NUM_FRAMES = 450  # 15 seconds at 30fps
FPS = 30

# Court dimensions (meters)
COURT_HALF_W = 5.485   # Half doubles width
COURT_HALF_L = 11.885  # Half court length (baseline to net = 11.885m)
SINGLES_HALF_W = 4.115  # Half singles width

random.seed(42)

def lerp(a, b, t):
    return a + (b - a) * t

def smooth_noise(t, freq=1.0):
    """Smooth random movement using sin waves with different frequencies."""
    return (math.sin(t * freq * 2.1 + 0.7) * 0.4 +
            math.sin(t * freq * 3.7 + 2.3) * 0.25 +
            math.sin(t * freq * 1.3 + 5.1) * 0.35)

def generate_rally():
    """Generate a realistic multi-shot tennis rally."""
    sequence = []
    
    # Rally structure: a series of shots going back and forth
    # Each shot has: player movement toward the ball, hit, ball flight
    
    # Player starting positions (baseline center-ish)
    p1_x, p1_z = 0.0, -9.5    # Near player (bottom, closer to camera)
    p2_x, p2_z = 0.0, 9.5     # Far player (top)
    
    # Smooth targets that players move toward
    p1_target_x, p2_target_x = 0.0, 0.0
    
    # Ball state
    ball_x, ball_y, ball_z = 0.0, 1.0, -10.0  # Start with player 1
    ball_vx, ball_vy, ball_vz = 0.0, 0.0, 0.0
    
    # Rally timing
    shot_frame = 0         # Frame when current shot was hit
    shot_duration = 30     # Frames for ball to travel across court
    serving_player = 1     # 1 = bottom, 2 = top
    rally_shot = 0         # Which shot in the rally we're on
    ball_in_flight = False
    
    # Target positions for ball landing
    target_x = 0.0
    target_z = 0.0
    
    # Starting positions for ball arc
    start_bx, start_by, start_bz = 0.0, 1.0, -10.0
    
    # Pre-generate the rally plan (where each shot lands)
    shots = []
    for i in range(20):
        # Alternate sides, with some randomness
        side = (-1)**i * random.choice([-1, 1])
        land_x = side * random.uniform(1.0, SINGLES_HALF_W - 0.5)
        if i % 2 == 0:
            land_z = random.uniform(5.0, 9.0)    # Far court
        else:
            land_z = random.uniform(-9.0, -5.0)  # Near court
        shots.append((land_x, land_z))
    
    for frame_idx in range(NUM_FRAMES):
        t = frame_idx / FPS  # Time in seconds
        
        # --- Generate shot events ---
        frames_since_shot = frame_idx - shot_frame
        shot_progress = min(1.0, frames_since_shot / shot_duration) if ball_in_flight else 0
        
        # Start a new shot
        if not ball_in_flight or frames_since_shot >= shot_duration:
            if rally_shot < len(shots):
                shot_frame = frame_idx
                ball_in_flight = True
                
                # Where the ball currently is = where the hitting player is
                if serving_player == 1:
                    start_bx, start_by, start_bz = p1_x, 1.2, p1_z
                else:
                    start_bx, start_by, start_bz = p2_x, 1.2, p2_z
                
                target_x, target_z = shots[rally_shot]
                
                # Set shot duration based on distance (longer shots take more time)
                dist = math.sqrt((target_x - start_bx)**2 + (target_z - start_bz)**2)
                shot_duration = max(20, int(dist * 1.8))  # ~1.8 frames per meter
                
                # Player targets: the receiving player moves toward where the ball will land
                if serving_player == 1:
                    # Ball going to top court, p2 needs to move
                    p2_target_x = target_x * 0.8 + random.uniform(-0.5, 0.5)
                    # Player 1 recovers to center
                    p1_target_x = p1_x * 0.3  # Drift back toward center
                    serving_player = 2
                else:
                    # Ball going to bottom court, p1 needs to move
                    p1_target_x = target_x * 0.8 + random.uniform(-0.5, 0.5)
                    # Player 2 recovers
                    p2_target_x = p2_x * 0.3
                    serving_player = 1
                
                rally_shot += 1
                shot_progress = 0.0
        
        # --- Animate ball in flight ---
        if ball_in_flight:
            # Parabolic arc: interpolate x,z linearly, y follows a parabola
            ball_x = lerp(start_bx, target_x, shot_progress)
            ball_z = lerp(start_bz, target_z, shot_progress)
            
            # Parabolic arc height: peaks in the middle
            peak_height = 1.5 + abs(target_z - start_bz) * 0.08  # Realistic arc
            ball_y = 0.3 + peak_height * 4 * shot_progress * (1 - shot_progress)
            
            # Add slight spin wobble
            ball_y += math.sin(shot_progress * math.pi * 6) * 0.05
        
        # --- Animate players ---
        # Smooth movement toward targets using ease function
        move_speed = 0.06  # How quickly players reach their target (per frame)
        
        p1_x = lerp(p1_x, p1_target_x, move_speed)
        p2_x = lerp(p2_x, p2_target_x, move_speed)
        
        # Add subtle body sway (weight shifting)
        sway1 = smooth_noise(t, 1.8) * 0.15
        sway2 = smooth_noise(t + 10, 1.5) * 0.15
        
        # Players stay near their baselines but shift forward/back slightly  
        p1_z_base = -9.5 + smooth_noise(t, 0.5) * 0.6
        p2_z_base = 9.5 + smooth_noise(t + 5, 0.5) * 0.6
        
        # When receiving, player moves forward slightly
        if ball_in_flight:
            if serving_player == 1 and shot_progress > 0.5:
                p1_z_base += 0.5  # Move toward net to receive
            elif serving_player == 2 and shot_progress > 0.5:
                p2_z_base -= 0.5
        
        # Clamp to court
        p1_display_x = max(-SINGLES_HALF_W, min(SINGLES_HALF_W, p1_x + sway1))
        p2_display_x = max(-SINGLES_HALF_W, min(SINGLES_HALF_W, p2_x + sway2))
        
        # Compute speed/spin
        if frame_idx > 0 and ball_in_flight:
            prev = sequence[-1]
            if prev["ball"]:
                dx = ball_x - prev["ball"]["position"]["x"]
                dy = ball_y - prev["ball"]["position"]["y"]
                dz = ball_z - prev["ball"]["position"]["z"]
                speed_ms = math.sqrt(dx*dx + dy*dy + dz*dz) * FPS
                speed_kmh = min(220.0, speed_ms * 3.6)  # Cap at realistic max
            else:
                speed_kmh = 0
        else:
            speed_kmh = 0
        
        spin_rpm = 800 + abs(smooth_noise(t, 2.0)) * 2500
        
        # Build frame
        frame = {
            "frame_index": frame_idx,
            "ball": {
                "position": {
                    "x": round(ball_x, 3),
                    "y": round(max(0.07, ball_y), 3),
                    "z": round(ball_z, 3)
                },
                "is_occluded": False
            },
            "players": [
                {
                    "id": "player_bottom",
                    "position": {
                        "x": round(p1_display_x, 3),
                        "y": 0.0,
                        "z": round(p1_z_base, 3)
                    }
                },
                {
                    "id": "player_top",
                    "position": {
                        "x": round(p2_display_x, 3),
                        "y": 0.0,
                        "z": round(p2_z_base, 3)
                    }
                }
            ],
            "ball_speed_kmh": round(speed_kmh, 1),
            "spin_rate_rpm": round(spin_rpm, 0)
        }
        sequence.append(frame)
    
    return sequence

if __name__ == "__main__":
    print("Generating realistic tennis rally...")
    seq = generate_rally()
    
    with open(OUTPUT_JSON, 'w') as f:
        json.dump({"sequence": seq}, f, indent=2)
    
    # Stats
    p1_positions = [(f["players"][0]["position"]["x"], f["players"][0]["position"]["z"]) for f in seq]
    p2_positions = [(f["players"][1]["position"]["x"], f["players"][1]["position"]["z"]) for f in seq]
    
    p1_x_range = max(p[0] for p in p1_positions) - min(p[0] for p in p1_positions)
    p2_x_range = max(p[0] for p in p2_positions) - min(p[0] for p in p2_positions)
    
    speeds = [f["ball_speed_kmh"] for f in seq]
    
    print(f"Generated {len(seq)} frames ({len(seq)/FPS:.1f}s)")
    print(f"Player 1 (bottom): X range = {p1_x_range:.1f}m")
    print(f"Player 2 (top): X range = {p2_x_range:.1f}m")
    print(f"Ball speed: {min(speeds):.0f} - {max(speeds):.0f} km/h")
    print(f"Saved to {OUTPUT_JSON}")
