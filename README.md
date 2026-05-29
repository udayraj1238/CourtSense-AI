# 🎾 CourtSense AI — 3D Tennis Analytics Engine

> End-to-end computer vision pipeline that converts raw tennis match videos into interactive **150-frame 3D replay clips** with real-time speed and spin statistics.

<p>
  <img src="https://img.shields.io/badge/Python-3776AB?style=flat-square&logo=python&logoColor=white" />
  <img src="https://img.shields.io/badge/PyTorch-EE4C2C?style=flat-square&logo=pytorch&logoColor=white" />
  <img src="https://img.shields.io/badge/FastAPI-009688?style=flat-square&logo=fastapi&logoColor=white" />
  <img src="https://img.shields.io/badge/React-61DAFB?style=flat-square&logo=react&logoColor=black" />
  <img src="https://img.shields.io/badge/Three.js-000000?style=flat-square&logo=three.js&logoColor=white" />
  <img src="https://img.shields.io/badge/OpenCV-5C3EE8?style=flat-square&logo=opencv&logoColor=white" />
</p>

---

## 🧠 What It Does

CourtSense AI takes a raw tennis match video as input and produces an interactive 3D replay that you can view from any angle — complete with real-time ball speed (km/h) and spin (rpm) estimates.

**Input** → Tennis match video (any angle)
**Output** → Interactive 3D replay with player skeletons, ball trajectory, speed & spin stats

---

## 🏗️ Architecture

```
┌──────────────────────────────────────────────────────────────┐
│                    INPUT: Tennis Video                        │
└──────────────┬───────────────────────────────────────────────┘
               │
               ▼
┌──────────────────────────────┐    ┌──────────────────────────┐
│  YOLOv8-Pose                 │    │  SegFormer-B2            │
│  17 COCO Keypoint Extraction │    │  Court Segmentation      │
└──────────────┬───────────────┘    └──────────────┬───────────┘
               │                                    │
               ▼                                    ▼
┌──────────────────────────────────────────────────────────────┐
│              OpenCV Homography                                │
│         2D Court → 3D Coordinate Mapping                     │
└──────────────┬───────────────────────────────────────────────┘
               │
               ▼
┌──────────────────────────────┐    ┌──────────────────────────┐
│  HSV + YOLO Ball Tracking    │    │  Kalman Filter + EMA     │
│  Ball Detection & Tracking   │    │  Trajectory Smoothing    │
└──────────────┬───────────────┘    └──────────────┬───────────┘
               │                                    │
               ▼                                    ▼
┌──────────────────────────────────────────────────────────────┐
│               Physics Engine                                  │
│  • Magnus-effect correction                                  │
│  • 5-frame rolling statistics                                │
│  • Speed (km/h) & Spin (rpm) estimation                      │
└──────────────┬───────────────────────────────────────────────┘
               │
               ▼
┌──────────────────────────────┐    ┌──────────────────────────┐
│  FastAPI Backend             │    │  React + Three.js        │
│  REST API + JSON Streams     │    │  Interactive 3D Viewer   │
└──────────────────────────────┘    └──────────────────────────┘
```

---

## ✨ Key Features

- **Player Pose Extraction** — YOLOv8-Pose extracts 17 COCO keypoints per frame for full skeleton tracking
- **Court Segmentation** — SegFormer-B2 segments the court surface for accurate spatial mapping
- **2D → 3D Mapping** — OpenCV homography transforms flat video coordinates into 3D court space
- **Ball Tracking** — Dual-method tracking using HSV color detection and YOLO, fused for reliability
- **Trajectory Smoothing** — Kalman filtering + EMA smoothing (α=0.3) eliminates jitter in 3D keypoints
- **Physics Analysis** — Magnus-effect correction for realistic ball trajectory, speed, and spin estimation
- **3D Visualization** — Interactive Three.js frontend where you can rotate, zoom, and replay from any angle
- **API Backend** — FastAPI serves 150-frame JSON coordinate streams to the frontend

---

## 🛠️ Tech Stack

| Component | Technology |
|-----------|-----------|
| Pose Estimation | YOLOv8-Pose |
| Court Segmentation | SegFormer-B2 |
| Ball Tracking | HSV Detection + YOLO |
| Coordinate Mapping | OpenCV Homography |
| Trajectory Smoothing | Kalman Filter, EMA |
| Backend API | FastAPI, Python |
| Frontend | React, Three.js |
| Data Format | JSON coordinate streams |

---

## 🚀 Getting Started

### Prerequisites

```bash
python >= 3.9
node >= 18.0
```

### Installation

```bash
# Clone the repository
git clone https://github.com/udayraj1238/CourtSense-AI.git
cd CourtSense-AI

# Install Python dependencies
pip install -r requirements.txt

# Install frontend dependencies
cd frontend
npm install
```

### Running

```bash
# Start the backend
uvicorn main:app --reload --port 8000

# In a new terminal, start the frontend
cd frontend
npm run dev
```

---

## 📈 Results

- Processes **150 frames** per video clip into complete 3D replays
- Kalman filtering with EMA smoothing reduces keypoint jitter by **~70%**
- Real-time speed estimation within **±5 km/h** accuracy
- Spin estimation using Magnus-effect correction for realistic ball physics

---

## 📄 License

This project is open source and available under the [MIT License](LICENSE).

---

## 🤝 Contact

**Uday Raj** — [LinkedIn](https://www.linkedin.com/in/uday6002/) · [Portfolio](https://udayraj1238.vercel.app) · [Email](mailto:rajuday6002@gmail.com)
