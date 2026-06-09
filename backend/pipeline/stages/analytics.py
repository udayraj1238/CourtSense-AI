import numpy as np
from typing import List, Dict, Any, Optional

def calculate_analytics(
    ball_states: List[Dict[str, Any]], 
    player_states: List[List[Dict[str, Any]]], 
    fps: float = 30.0
) -> List[Dict[str, Any]]:
    """
    Computes ball speed, spin, and detects hitter for each frame.
    """
    num_frames = min(len(ball_states), len(player_states))
    
    analytics_data = []
    
    # Pre-calculate raw speeds and velocities
    velocities = []
    speeds_kmh = []
    
    for i in range(num_frames):
        if i == 0:
            velocities.append(np.array([0.0, 0.0, 0.0]))
            speeds_kmh.append(0.0)
        else:
            p_prev = ball_states[i-1]["position"]
            p_curr = ball_states[i]["position"]
            
            dx = p_curr["x"] - p_prev["x"]
            dy = p_curr["y"] - p_prev["y"]
            dz = p_curr["z"] - p_prev["z"]
            
            # The speed calculation should only use X and Z components.
            # Including Y (height) makes a ball rising 2.4m in one frame appear to be going 220+ km/h
            v = np.array([dx, 0.0, dz]) * fps
            velocities.append(v)
            
            speed = np.linalg.norm(v) * 3.6 # m/s to km/h
            speeds_kmh.append(speed)
            
    # Apply rolling median to speed to reduce noise
    window_size = 5
    smoothed_speeds = []
    for i in range(num_frames):
        start = max(0, i - window_size // 2)
        end = min(num_frames, i + window_size // 2 + 1)
        window = speeds_kmh[start:end]
        smoothed_speeds.append(float(np.median(window)))
        
    # Hit detection based on Z-velocity reversals
    hitters: List[Optional[str]] = [None] * num_frames
    
    for i in range(2, num_frames - 2):
        vz_prev = velocities[i-1][2]
        vz_curr = velocities[i][2]
        
        # Check for Z velocity reversal
        if vz_prev * vz_curr < 0 and abs(vz_prev - vz_curr) > 10.0:
            # Reversal detected. Who hit it?
            ball_pos = ball_states[i]["position"]
            bx, bz = ball_pos["x"], ball_pos["z"]
            
            # Check hitter based on court half
            if bz > 0:  # Ball in bottom half -> p1 (player_bottom) hit it
                hitter_id = "p1"
            else:  # Ball in top half -> p2 hit it
                hitter_id = "p2"
                
            # Verify the assigned player is actually close
            for player in player_states[i]:
                if player is not None and player.get("id"):
                    if (hitter_id == "p1" and "bottom" in player["id"]) or \
                       (hitter_id == "p2" and "top" in player["id"]):
                        px = player["position"]["x"]
                        pz = player["position"]["z"]
                        dist = np.hypot(bx - px, bz - pz)
                        if dist > 5.0:
                            hitter_id = None  # Too far — no hitter assigned
                            
            if hitter_id:
                hitters[i] = hitter_id
                
                # Expand the hit window slightly so frontend has time to trigger animation
                hitters[i-1] = hitter_id
                hitters[i+1] = hitter_id
                
    # Assemble final payload
    for i in range(num_frames):
        analytics_data.append({
            "speed_kmh": round(smoothed_speeds[i], 1),
            "spin_rpm": 0.0, # Placeholder for V5.0
            "hitter": hitters[i]
        })
        
    return analytics_data
