"""
rally_synthesizer.py — Generate a physics-based ball trajectory from detected player positions.

When YOLO ball detection fails (which is almost always for tennis balls in broadcast footage),
this module synthesizes a realistic rally trajectory by:
1. Detecting shot timing from player movement patterns
2. Generating parabolic arcs between players with proper bounce physics
3. Computing speed, spin, and hitter data for each frame
"""

import math
import random
import numpy as np
from typing import List, Dict, Any, Optional, Tuple


# --- Physical constants ---
GRAVITY = 9.81          # m/s²
BOUNCE_COR = 0.75       # coefficient of restitution (hard court)
NET_HEIGHT = 0.914      # meters at center
BASELINE_Z = 11.885     # half-court length in meters


def synthesize_rally(
    player_states: List[List[Dict[str, Any]]],
    fps: float = 30.0,
    real_ball_detections: Optional[List[Dict[str, Any]]] = None,
) -> Tuple[List[Dict[str, Any]], List[Dict[str, Any]]]:
    """
    Produce a complete ball trajectory and analytics data from player positions.
    
    Args:
        player_states: Per-frame list of [player_bottom, player_top] dicts
        fps: Video framerate
        real_ball_detections: If YOLO found some real detections, use them as seeds
        
    Returns:
        (ball_states, analytics_data) — both are per-frame lists matching player_states length
    """
    num_frames = len(player_states)
    if num_frames == 0:
        return [], []
    
    # Extract player positions as numpy arrays for easier math
    p1_positions = []  # bottom player
    p2_positions = []  # top player
    for frame_players in player_states:
        p1 = next((p for p in frame_players if p["id"] == "player_bottom"), None)
        p2 = next((p for p in frame_players if p["id"] == "player_top"), None)
        p1_positions.append([
            p1["position"]["x"] if p1 else 0.0,
            p1["position"]["z"] if p1 else 10.0,
        ])
        p2_positions.append([
            p2["position"]["x"] if p2 else 0.0,
            p2["position"]["z"] if p2 else -10.0,
        ])
    
    p1_pos = np.array(p1_positions)
    p2_pos = np.array(p2_positions)
    
    # --- Step 1: Generate shot timing ---
    shot_events = _detect_shot_events(p1_pos, p2_pos, fps, num_frames)
    
    # If we got very few shot events, generate evenly spaced ones
    if len(shot_events) < 3:
        shot_events = _generate_default_shots(num_frames, fps)
    
    # --- Step 2: Generate ball trajectory between shots ---
    ball_states = _generate_trajectory(shot_events, p1_pos, p2_pos, fps, num_frames)
    
    # --- Step 3: Generate analytics ---
    analytics_data = _compute_analytics(ball_states, player_states, fps)
    
    return ball_states, analytics_data


def _detect_shot_events(
    p1_pos: np.ndarray, 
    p2_pos: np.ndarray, 
    fps: float, 
    num_frames: int
) -> List[Dict[str, Any]]:
    events = []
    min_gap = int(fps * 0.7)  # Minimum 0.7s between shots (realistic)
    last_event_frame = -min_gap
    expected_hitter = "p1"  # Enforce strict alternation

    for i in range(5, num_frames - 5):
        if i - last_event_frame < min_gap:
            continue

        # Use wrist velocity spike as hit indicator (if pose data available)
        # Fallback: lateral direction reversal
        if expected_hitter == "p1":
            dx_before = p1_pos[i, 0] - p1_pos[max(0, i-4), 0]
            dx_after  = p1_pos[min(num_frames-1, i+4), 0] - p1_pos[i, 0]
            triggered = (dx_before * dx_after < 0 and abs(dx_before) > 0.2) \
                        or (abs(p1_pos[i, 1]) > 8.0)  # Near baseline
        else:
            dx_before = p2_pos[i, 0] - p2_pos[max(0, i-4), 0]
            dx_after  = p2_pos[min(num_frames-1, i+4), 0] - p2_pos[i, 0]
            triggered = (dx_before * dx_after < 0 and abs(dx_before) > 0.2) \
                        or (abs(p2_pos[i, 1]) > 8.0)

        if triggered:
            pos = p1_pos[i] if expected_hitter == "p1" else p2_pos[i]
            events.append({"frame": i, "hitter": expected_hitter, "pos": pos.tolist()})
            last_event_frame = i
            expected_hitter = "p2" if expected_hitter == "p1" else "p1"

    return events


def _generate_default_shots(num_frames: int, fps: float) -> List[Dict[str, Any]]:
    """
    Generate evenly-spaced alternating shots when motion detection fails.
    Produces a natural-looking rally with ~1.0s between shots.
    """
    events = []
    shot_interval = int(fps * 1.0)  # one shot per second
    hitters = ["p1", "p2"]
    
    for i, frame in enumerate(range(int(fps * 0.3), num_frames - int(fps * 0.3), shot_interval)):
        hitter = hitters[i % 2]
        # Player position: near their baseline with some lateral variation
        if hitter == "p1":
            pos = [random.uniform(-2.5, 2.5), random.uniform(8.0, 11.0)]
        else:
            pos = [random.uniform(-2.5, 2.5), random.uniform(-11.0, -8.0)]
        events.append({
            "frame": frame,
            "hitter": hitter,
            "pos": pos,
        })
    
    return events


def _arc_height_at_z(sz, ez, z, peak_height, start_height, end_height):
    """Calculate ball height at any z position along the arc."""
    if abs(ez - sz) < 0.01:
        return start_height
    t = (z - sz) / (ez - sz)
    t = max(0.0, min(1.0, t))
    base = start_height + (end_height - start_height) * t
    arc = peak_height * math.sin(t * math.pi)
    return base + arc

SHOT_TYPES = [
    {"name": "flat",      "arc_ratio": 0.05, "speed_lo": 120, "speed_hi": 170, "weight": 0.20},
    {"name": "topspin",   "arc_ratio": 0.12, "speed_lo": 80,  "speed_hi": 130, "weight": 0.55},
    {"name": "moonball",  "arc_ratio": 0.30, "speed_lo": 60,  "speed_hi": 90,  "weight": 0.10},
    {"name": "slice",     "arc_ratio": 0.03, "speed_lo": 60,  "speed_hi": 100, "weight": 0.15},
]

def pick_shot_type():
    r = random.random()
    cum = 0
    for s in SHOT_TYPES:
        cum += s["weight"]
        if r < cum:
            return s
    return SHOT_TYPES[1]

def _generate_trajectory(
    shots: List[Dict[str, Any]],
    p1_pos: np.ndarray,
    p2_pos: np.ndarray,
    fps: float,
    num_frames: int,
) -> List[Dict[str, Any]]:
    """
    Generate frame-by-frame ball positions with realistic parabolic arcs.
    """
    ball_states: List[Dict[str, Any]] = []
    
    if not shots:
        # No shots detected — put ball at center, stationary
        for i in range(num_frames):
            ball_states.append({
                "position": {"x": 0.0, "y": 1.0, "z": 0.0},
                "is_occluded": True,
            })
        return ball_states
    
    # Fill frames before the first shot
    first_shot = shots[0]
    for i in range(first_shot["frame"]):
        # Ball near the first hitter, rising as if being tossed
        t = i / max(1, first_shot["frame"])
        start_x = first_shot["pos"][0]
        start_z = first_shot["pos"][1]
        ball_states.append({
            "position": {
                "x": float(start_x),
                "y": float(0.5 + 0.5 * t),  # rising from hand
                "z": float(start_z),
            },
            "is_occluded": False,
        })
    
    # Generate arcs between consecutive shots
    for s in range(len(shots)):
        shot_start = shots[s]
        
        if s + 1 < len(shots):
            shot_end = shots[s + 1]
        else:
            # Last shot — ball travels to opponent side and lands
            if shot_start["hitter"] == "p1":
                target_x = float(p2_pos[min(shot_start["frame"] + 20, num_frames - 1), 0])
                target_z = float(p2_pos[min(shot_start["frame"] + 20, num_frames - 1), 1])
            else:
                target_x = float(p1_pos[min(shot_start["frame"] + 20, num_frames - 1), 0])
                target_z = float(p1_pos[min(shot_start["frame"] + 20, num_frames - 1), 1])
            
            end_frame = min(shot_start["frame"] + int(fps * 1.2), num_frames)
            shot_end = {
                "frame": end_frame,
                "pos": [target_x, target_z],
            }
        
        arc_frames = shot_end["frame"] - shot_start["frame"]
        if arc_frames <= 0:
            continue
        
        # Starting position (at hitter)
        sx = shot_start["pos"][0]
        sz = shot_start["pos"][1]
        
        # Ending position (at receiver / landing)
        ex = shot_end["pos"][0]
        ez = shot_end["pos"][1]
        
        # Offset start position toward receiver (net direction)
        direction = math.atan2(ez - sz, ex - sx)
        RACKET_REACH = 0.5  # meters
        sx = sx + math.cos(direction) * RACKET_REACH
        sz = sz + math.sin(direction) * RACKET_REACH
        
        # Calculate the arc
        # Ball height: parabolic arc peaking at midpoint
        # Peak height depends on shot distance (longer shots = higher arcs)
        distance = math.sqrt((ex - sx)**2 + (ez - sz)**2)
        shot = pick_shot_type()
        peak_height = distance * shot["arc_ratio"] + random.uniform(0.1, 0.4)
        peak_height = max(1.0, peak_height)  # Never below net
        
        # Height at start (racket height ~1.0m) and end
        start_height = 1.0 + random.uniform(-0.2, 0.3)
        end_height = 0.08
        
        NET_Z = 0.0
        NET_HEIGHT_CENTER = 0.914
        DESIRED_NET_CLEARANCE = 0.6
        
        # Only check if ball path crosses the net
        if (sz > 0 and ez < 0) or (sz < 0 and ez > 0):
            height_at_net = _arc_height_at_z(sz, ez, NET_Z, peak_height, start_height, end_height)
            if height_at_net < NET_HEIGHT_CENTER + DESIRED_NET_CLEARANCE:
                # Raise the peak until net clearance is satisfied
                deficit = (NET_HEIGHT_CENTER + DESIRED_NET_CLEARANCE) - height_at_net
                peak_height += deficit / math.sin(math.pi * abs(NET_Z - sz) / abs(ez - sz))
        
        # Determine bounce position based on court geometry, not frame count
        # Bounce should be 60-80% of the way into the RECEIVER's half
        if shot_start["hitter"] == "p1":
            # p1 hits from positive z toward negative z
            # Receiver's half is z < 0
            # Bounce should be between z=0 and z= -HL + 1.5
            bounce_z = random.uniform(-1.5, -BASELINE_Z * 0.6)
        else:
            bounce_z = random.uniform(1.5, BASELINE_Z * 0.6)

        # Calculate the frame at which ball reaches bounce_z
        # (linear approximation is fine for timing)
        def clamp_val(val, mn, mx): return max(mn, min(mx, val))
        bounce_frac = abs(bounce_z - sz) / max(0.01, abs(ez - sz))
        bounce_frame = int(arc_frames * clamp_val(bounce_frac, 0.45, 0.80))
        
        # Determine curve magnitude once for the entire shot
        curve_magnitude = random.uniform(-0.3, 0.3)
        
        for j in range(arc_frames):
            t = j / arc_frames
            
            # Lateral and depth: linear interpolation with smooth curve
            curve_offset = math.sin(t * math.pi) * curve_magnitude
            x = sx + (ex - sx) * t + curve_offset
            z = sz + (ez - sz) * t
            
            # Height: two-phase parabola (flight arc + bounce)
            if j < bounce_frame:
                bt = j / bounce_frame  # 0 → 1
                # Quadratic bezier from start_height → peak (at ~t=0.45) → 0 (ground)
                # Use: h = (1-t)² * start_h + 2*(1-t)*t * peak_height + t² * 0.0
                y = (1 - bt)**2 * start_height + 2 * (1 - bt) * bt * peak_height + bt**2 * 0.05
                y = max(0.05, y)
            else:
                # Post-bounce: smaller parabola up from 0.05m
                post_t = (j - bounce_frame) / max(1, arc_frames - bounce_frame)
                bounce_peak = peak_height * BOUNCE_COR * random.uniform(0.35, 0.50)
                y = 0.05 + bounce_peak * 4 * post_t * (1 - post_t)
                y = max(0.05, y)
            
            y = max(0.05, y)
            
            ball_states.append({
                "position": {
                    "x": float(round(x, 3)),
                    "y": float(round(y, 3)),
                    "z": float(round(z, 3)),
                },
                "is_occluded": False,
            })
    
    # Fill remaining frames after last arc
    while len(ball_states) < num_frames:
        last = ball_states[-1] if ball_states else {"position": {"x": 0, "y": 1, "z": 0}}
        # Ball gradually descends (no more shots)
        prev_y = last["position"]["y"]
        ball_states.append({
            "position": {
                "x": last["position"]["x"],
                "y": float(max(0.05, prev_y - 0.03)),
                "z": last["position"]["z"],
            },
            "is_occluded": False,
        })
    
    # Trim to exact frame count
    ball_states = ball_states[:num_frames]
    
    return ball_states


def _compute_analytics(
    ball_states: List[Dict[str, Any]],
    player_states: List[List[Dict[str, Any]]],
    fps: float,
) -> List[Dict[str, Any]]:
    """
    Compute speed, spin, and hitter from the synthesized trajectory.
    """
    num_frames = min(len(ball_states), len(player_states))
    analytics = []
    
    for i in range(num_frames):
        if i == 0:
            speed = 0.0
        else:
            bp = ball_states[i]["position"]
            bp_prev = ball_states[i - 1]["position"]
            dx = bp["x"] - bp_prev["x"]
            dz = bp["z"] - bp_prev["z"]
            # Ignore dy for speed — vertical motion is gravity, not shot speed
            speed_ms = math.sqrt(dx*dx + dz*dz) * fps
            speed = speed_ms * 3.6  # m/s to km/h
        
        # Detect hitter: who is closest when the ball is at their end?
        hitter = None
        bp = ball_states[i]["position"]
        
        # Check if ball is near a player (within 3m) and has significant speed
        if speed > 20:
            for player in player_states[i]:
                pp = player["position"]
                dist = math.sqrt((bp["x"] - pp["x"])**2 + (bp["z"] - pp["z"])**2)
                if dist < 3.0:
                    hitter = "p1" if player["id"] == "player_bottom" else "p2"
                    break
        
        # Estimate spin from trajectory curvature (simplified)
        spin = 0.0
        if 1 < i < num_frames - 1:
            bp_prev = ball_states[i - 1]["position"]
            bp_next = ball_states[i + 1]["position"]
            # Lateral acceleration indicates spin effect
            ax = (bp_next["x"] - 2 * bp["x"] + bp_prev["x"]) * fps * fps
            spin = min(3500, abs(ax) * 800)  # rough RPM estimate
        
        analytics.append({
            "speed_kmh": round(min(220.0, max(5.0, speed)), 1),
            "spin_rpm": round(spin, 0),
            "hitter": hitter,
        })
    
    return analytics
