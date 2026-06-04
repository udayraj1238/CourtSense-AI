import numpy as np
from scipy.interpolate import CubicSpline
from typing import List, Dict, Any

def fill_gaps_with_spline(positions: List[Dict[str, Any]], max_gap: int = 20) -> None:
    """
    Interpolates occluded ball positions using a Cubic Spline over valid (unoccluded) frames.
    Modifies 'positions' in-place.
    
    If an occluded segment is longer than `max_gap`, it remains occluded.
    """
    n = len(positions)
    if n < 2:
        return
        
    valid_indices = []
    xs = []
    ys = []
    zs = []
    
    for i, pos in enumerate(positions):
        if not pos["is_occluded"]:
            valid_indices.append(i)
            xs.append(pos["position"]["x"])
            ys.append(pos["position"]["y"])
            zs.append(pos["position"]["z"])
            
    if len(valid_indices) < 3:
        return
        
    # Fit splines
    cs_x = CubicSpline(valid_indices, xs)
    cs_y = CubicSpline(valid_indices, ys)
    cs_z = CubicSpline(valid_indices, zs)
    
    # Identify gaps and fill them
    current_gap_start = None
    
    for i in range(n):
        if positions[i]["is_occluded"]:
            if current_gap_start is None:
                current_gap_start = i
        else:
            if current_gap_start is not None:
                gap_len = i - current_gap_start
                if gap_len <= max_gap:
                    # Fill this gap
                    for j in range(current_gap_start, i):
                        positions[j]["position"]["x"] = float(cs_x(j))
                        positions[j]["position"]["y"] = float(cs_y(j))
                        positions[j]["position"]["z"] = float(cs_z(j))
                        # Note: we leave is_occluded=True so the frontend can still style it differently 
                        # as per the gap-aware BallTrail logic.
                current_gap_start = None
                
    # Handle gap at the very end
    if current_gap_start is not None:
        gap_len = n - current_gap_start
        if gap_len <= max_gap:
            for j in range(current_gap_start, n):
                positions[j]["position"]["x"] = float(cs_x(j))
                positions[j]["position"]["y"] = float(cs_y(j))
                positions[j]["position"]["z"] = float(cs_z(j))
