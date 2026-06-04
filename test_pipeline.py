import asyncio
from backend.pipeline.stages.player_tracking import process_player_tracking
from backend.pipeline.stages.ball_tracking import process_ball_tracking
from backend.pipeline.stages.analytics import calculate_analytics
from backend.cv.homography import CourtProjector
import numpy as np
import cv2

async def run():
    # Make a dummy video
    fourcc = cv2.VideoWriter_fourcc(*'mp4v')
    out = cv2.VideoWriter('dummy.mp4', fourcc, 30.0, (640, 360))
    for _ in range(60):
        out.write(np.zeros((360, 640, 3), dtype=np.uint8))
    out.release()
    
    projector = CourtProjector.from_corners(np.array([[0,0], [640,0], [640,360], [0,360]], dtype=np.float32))
    
    try:
        print("Running player tracking...")
        p_states = process_player_tracking('dummy.mp4', projector, 30.0, None)
        print("Running ball tracking...")
        b_states = process_ball_tracking('dummy.mp4', projector, 30.0, None)
        print("Running analytics...")
        analytics = calculate_analytics(b_states, p_states, 30.0)
        print("Success! Player states:", len(p_states), "Ball states:", len(b_states))
    except Exception as e:
        import traceback
        traceback.print_exc()

if __name__ == "__main__":
    asyncio.run(run())
