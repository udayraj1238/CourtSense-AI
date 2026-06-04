import cv2
import argparse
import os
import csv

def extract_frames(video_path: str, out_dir: str, target_fps: int = 30, sample_rate: int = 1):
    """
    Extract frames from a video for training data annotation.
    """
    os.makedirs(out_dir, exist_ok=True)
    
    cap = cv2.VideoCapture(video_path)
    if not cap.isOpened():
        print(f"Error opening video: {video_path}")
        return
        
    native_fps = cap.get(cv2.CAP_PROP_FPS)
    print(f"Native FPS: {native_fps}, Target extraction FPS: {target_fps}")
    
    # Calculate skip factor if native fps is higher than target
    # For simplicity, we assume we just read sequentially if target_fps == native_fps
    # In a robust implementation, we would use FFmpeg to accurately resample.
    
    manifest_path = os.path.join(out_dir, "manifest.csv")
    frame_idx = 0
    saved_idx = 0
    
    with open(manifest_path, 'w', newline='') as csvfile:
        writer = csv.writer(csvfile)
        writer.writerow(['frame_id', 'timestamp_ms', 'source_video'])
        
        while True:
            ret, frame = cap.read()
            if not ret:
                break
                
            timestamp_ms = cap.get(cv2.CAP_PROP_POS_MSEC)
            
            if frame_idx % sample_rate == 0:
                frame_name = f"frame_{saved_idx:06d}.jpg"
                out_path = os.path.join(out_dir, frame_name)
                cv2.imwrite(out_path, frame, [cv2.IMWRITE_JPEG_QUALITY, 95])
                
                writer.writerow([frame_name, int(timestamp_ms), os.path.basename(video_path)])
                saved_idx += 1
                
            frame_idx += 1
            
    cap.release()
    print(f"Extracted {saved_idx} frames to {out_dir}")

if __name__ == "__main__":
    parser = argparse.ArgumentParser(description="Extract frames from tennis video.")
    parser.add_argument("--video", type=str, required=True, help="Path to input video")
    parser.add_argument("--out", type=str, required=True, help="Output directory")
    parser.add_argument("--fps", type=int, default=30, help="Target FPS (Not fully implemented, uses sample_rate)")
    parser.add_argument("--sample_rate", type=int, default=1, help="Save 1 out of every N frames")
    
    args = parser.parse_args()
    extract_frames(args.video, args.out, args.fps, args.sample_rate)
