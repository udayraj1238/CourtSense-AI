#!/usr/bin/env bash
# Download model weights required for CourtSense AI

set -e

echo "Downloading YOLOv8n..."
curl -L -o yolov8n.pt "https://github.com/ultralytics/assets/releases/download/v0.0.0/yolov8n.pt"

echo "Downloading YOLOv8n-pose..."
curl -L -o yolov8n-pose.pt "https://github.com/ultralytics/assets/releases/download/v0.0.0/yolov8n-pose.pt"

# Note: yolov8n_tennis.pt is a custom fine-tuned model.
# If it's not hosted anywhere, you must train it locally or download from your private release.
# Example:
# curl -L -o yolov8n_tennis.pt "https://github.com/udayraj1238/CourtSense-AI/releases/download/v1.0/yolov8n_tennis.pt"

echo "Models downloaded to root directory."
