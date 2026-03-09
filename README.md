# CourtSense AI 🎾

A 3D Tennis Analytics Platform that uses computer vision and physics simulations to visualize tennis match data in real-time.

![CourtSense AI](https://img.shields.io/badge/CourtSense-AI-brightgreen) ![Python](https://img.shields.io/badge/Python-3.10+-blue) ![React](https://img.shields.io/badge/React-18-61dafb) ![Three.js](https://img.shields.io/badge/Three.js-3D-black)

## Features

- **3D Court Visualization** — Real-time tennis court with humanoid player models rendered in Three.js
- **Player Tracking** — YOLOv8-Pose based player detection with homography projection
- **Ball Trajectory** — Physics-based ball tracking with Kalman filter and Magnus effect correction
- **Dynamic Stats** — Real-time ball speed (km/h) and spin rate (rpm) display
- **Court Segmentation** — SegFormer-based court surface detection
- **Camera Calibration** — Automatic homography estimation from court line detection

## Tech Stack

| Layer | Technology |
|-------|-----------|
| **Frontend** | React, Three.js (react-three-fiber), TailwindCSS |
| **Backend** | FastAPI, Uvicorn |
| **CV Pipeline** | YOLOv8-Pose, OpenCV, NumPy |
| **Physics** | Kalman Filter, Magnus Effect, EMA Smoothing |
| **ML Models** | SegFormer (HuggingFace), YOLOv8 (Ultralytics) |

## Project Structure

```
CourtSense-AI/
├── courtsense_ai/          # Core Python package
│   ├── core/               # Segmentation, calibration, tracking, biometrics
│   └── utils/              # Visualization helpers
├── scripts/                # Pipeline scripts
│   ├── process_real_video.py   # Real video processing pipeline
│   ├── generate_rally.py       # Synthetic rally data generator
│   ├── init_phase.py           # Phase 1: Initialization
│   ├── phase3_ghost.py         # Phase 3: Player ghost tracking
│   └── phase4_trajectory.py    # Phase 4: Ball trajectory
├── backend/                # FastAPI server
│   ├── main.py
│   └── models.py
├── frontend/               # React + Three.js app
│   └── src/
│       ├── App.tsx
│       └── components/     # TennisScene, Court, Player, Ball
└── data/                   # Generated tracking data (JSON)
```

## Quick Start

### Prerequisites
- Python 3.10+
- Node.js 18+

### Setup

```bash
# Clone
git clone https://github.com/YOUR_USERNAME/CourtSense-AI.git
cd CourtSense-AI

# Python environment
python -m venv .venv
.venv\Scripts\activate  # Windows
pip install -r requirements.txt

# Frontend
cd frontend
npm install
cd ..
```

### Generate Rally Data
```bash
python scripts/generate_rally.py
```

### Run
```bash
# Terminal 1 — Backend
cd backend
python -m uvicorn main:app --host 0.0.0.0 --port 8000

# Terminal 2 — Frontend  
cd frontend
npm run dev
```

Open `http://localhost:5173` to see the 3D visualization.

## Development Phases

1. **Initialization** — Court segmentation + camera calibration
2. **The Ghost** — Player pose estimation + top-down projection
3. **Trajectory** — Ball tracking with physics
4. **Deployment** — FastAPI + React/Three.js frontend

## License

MIT
