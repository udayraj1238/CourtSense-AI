"""Quick integration test for the rally synthesizer."""
import json
from backend.pipeline.stages.rally_synthesizer import synthesize_rally


def test_synthesizer():
    """Test with synthetic player data that simulates a real rally."""
    fps = 30.0
    num_frames = 120  # 4 seconds
    
    # Simulate two players moving laterally during a rally
    player_states = []
    for i in range(num_frames):
        t = i / fps
        # Player 1 (bottom): oscillates laterally near baseline
        p1_x = 2.0 * (0.5 - abs((t % 2.0) / 2.0 - 0.5) * 2)  # -2 to 2
        p1_z = 10.0 + 0.5 * (0.5 - abs((t % 3.0) / 3.0 - 0.5) * 2)
        
        # Player 2 (top): oscillates with offset
        p2_x = -1.5 * (0.5 - abs(((t + 0.5) % 2.0) / 2.0 - 0.5) * 2)
        p2_z = -10.0 - 0.3 * (0.5 - abs(((t + 1.0) % 3.0) / 3.0 - 0.5) * 2)
        
        player_states.append([
            {"id": "player_bottom", "position": {"x": p1_x, "y": 0.0, "z": p1_z}},
            {"id": "player_top", "position": {"x": p2_x, "y": 0.0, "z": p2_z}},
        ])
    
    ball_states, analytics = synthesize_rally(player_states, fps)
    
    assert len(ball_states) == num_frames, f"Expected {num_frames} ball states, got {len(ball_states)}"
    assert len(analytics) == num_frames, f"Expected {num_frames} analytics, got {len(analytics)}"
    
    # Check ball positions are reasonable (within court bounds + margin)
    for i, bs in enumerate(ball_states):
        pos = bs["position"]
        assert -8 < pos["x"] < 8, f"Frame {i}: ball x={pos['x']} out of bounds"
        assert -0.1 < pos["y"] < 8.0, f"Frame {i}: ball y={pos['y']} out of bounds"
        assert -15 < pos["z"] < 15, f"Frame {i}: ball z={pos['z']} out of bounds"
    
    # Check ball actually MOVES (not stuck at one position)
    unique_x = set(round(bs["position"]["x"], 1) for bs in ball_states)
    unique_z = set(round(bs["position"]["z"], 1) for bs in ball_states)
    assert len(unique_x) > 3, f"Ball x has only {len(unique_x)} unique values — appears static"
    assert len(unique_z) > 3, f"Ball z has only {len(unique_z)} unique values — appears static"
    
    # Check analytics has some non-zero speeds
    speeds = [a["speed_kmh"] for a in analytics]
    max_speed = max(speeds)
    assert max_speed > 10, f"Max ball speed is {max_speed} km/h — seems too low"
    
    # Check some hitters are detected
    hitters = [a["hitter"] for a in analytics if a["hitter"] is not None]
    assert len(hitters) > 0, "No hitters detected"
    
    # Print sample output
    print(f"[PASS] Rally synthesizer test passed!")
    print(f"   Frames: {num_frames}")
    print(f"   Ball X range: [{min(bs['position']['x'] for bs in ball_states):.2f}, {max(bs['position']['x'] for bs in ball_states):.2f}]")
    print(f"   Ball Y range: [{min(bs['position']['y'] for bs in ball_states):.2f}, {max(bs['position']['y'] for bs in ball_states):.2f}]")
    print(f"   Ball Z range: [{min(bs['position']['z'] for bs in ball_states):.2f}, {max(bs['position']['z'] for bs in ball_states):.2f}]")
    print(f"   Max speed: {max_speed:.1f} km/h")
    print(f"   Hitter events: {len(hitters)}")
    print(f"   Unique ball X positions: {len(unique_x)}")
    print(f"   Sample frame 0: {json.dumps(ball_states[0], indent=2)}")
    print(f"   Sample frame 60: {json.dumps(ball_states[60], indent=2)}")


if __name__ == "__main__":
    test_synthesizer()
