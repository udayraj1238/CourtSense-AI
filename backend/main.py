from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from models import SequenceResponse, FrameData, BallState, Coordinate, PlayerState
import numpy as np
import json
import os

app = FastAPI(title="CourtSense AI API")

# Configure CORS for the frontend
app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:5173", "http://localhost:3000"], # Typical Vite/CRA ports
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

@app.get("/health")
def health_check():
    return {"status": "ok", "message": "CourtSense AI Backend is running."}

@app.get("/api/v1/tracking/sequence", response_model=SequenceResponse)
def get_mock_tracking_sequence():
    """
    Returns a sequence of mocked tracking data mirroring Phase 4's 
    Kalman filter trajectory generation.
    """
    frames = []
    num_frames = 60
    
    # Parabola parameters (mirroring phase4_trajectory.py)
    x_start = -10.0 # Map onto a reasonable 3D webgl coordinate scale (-10 to 10 typical)
    x_end = 10.0
    y_ground = 0.0
    y_peak = 5.0
    
    h = (x_start + x_end) / 2
    k = y_peak
    a = (y_ground - k) / ((x_start - h)**2)
    
    xs = np.linspace(x_start, x_end, num_frames)
    
    occlusion_start = 20
    occlusion_end = 30
    
    for i, x in enumerate(xs):
        y = a * (x - h)**2 + k
        
        # Simulate tracking depth moving slightly across the court
        z = np.linspace(-5.0, 5.0, num_frames)[i] 
        
        is_occluded = occlusion_start <= i <= occlusion_end
        
        ball = BallState(
            position=Coordinate(x=float(x), y=float(y), z=float(z)),
            is_occluded=is_occluded
        )
        
        # Two mock players (Ghost Phase representations)
        player_1 = PlayerState(
            id="player_bottom",
            position=Coordinate(x=-2.0 + np.sin(i*0.1)*0.5, y=0.0, z=8.0) # Swaying at baseline
        )
        
        player_2 = PlayerState(
            id="player_top",
            position=Coordinate(x=2.0 + np.cos(i*0.1)*0.5, y=0.0, z=-8.0) # Swaying at top baseline
        )
        
        frame = FrameData(
            frame_index=i,
            ball=ball,
            players=[player_1, player_2]
        )
        frames.append(frame)
        
        
    return SequenceResponse(sequence=frames)

@app.get("/api/v1/tracking/real", response_model=SequenceResponse)
def get_real_tracking_sequence():
    """
    Returns the tracking sequence processed from the real video by process_real_video.py.
    """
    json_path = os.path.join(os.path.dirname(__file__), '..', 'data', 'real_match_data.json')
    try:
        with open(json_path, 'r') as f:
            data = json.load(f)
            return SequenceResponse(**data)
    except FileNotFoundError:
        raise HTTPException(status_code=404, detail="Real match data JSON not found. Please run the processing script first.")
    except json.JSONDecodeError:
        raise HTTPException(status_code=500, detail="Error decoding the match data JSON.")
