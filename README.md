<div align="center">
  <img src="https://img.icons8.com/color/96/000000/tennis.png" alt="Tennis Icon" width="80" />
  
  # CourtSense AI 🎾
  
  **A Next-Generation 3D Tennis Analytics Engine**

  <p>
    <a href="https://udayraj1238.github.io/CourtSense-AI/">
      <img src="https://img.shields.io/badge/Live_Demo-Play_Now-a3e635?style=for-the-badge&logo=vercel&logoColor=black" alt="Live Demo" />
    </a>
  </p>

  <p>
    <img src="https://img.shields.io/badge/Python-3.10+-blue?style=flat-square&logo=python" alt="Python" />
    <img src="https://img.shields.io/badge/React-18-61dafb?style=flat-square&logo=react&logoColor=black" alt="React" />
    <img src="https://img.shields.io/badge/Three.js-3D-black?style=flat-square&logo=three.js" alt="Three.js" />
    <img src="https://img.shields.io/badge/YOLOv8-Pose-ff0000?style=flat-square" alt="YOLOv8" />
  </p>
</div>

---

**CourtSense AI** processes standard tennis match videos using computer vision and transforms them into stunning, interactive 3D visualizations. Witness every rally, track player movement, and analyze ball physics in real-time.

✨ **[Experience the Live 3D Viewer Here](https://udayraj1238.github.io/CourtSense-AI/)** ✨

---

## 🌟 Key Features

- 🏟️ **Cinematic 3D Court** — Immersive real-time tennis stadium with lighting, dynamic shadows, and post-processing (Bloom/Vignette) rendered using `react-three-fiber`.
- 🏃 **Player Tracking & Ghosting** — Real-world player detection using YOLOv8-Pose, mapped to 3D space via homography projection.
- 🎾 **Physics-Based Ball Trajectory** — Smooth, lag-free ball tracking with Kalman filters, Magnus effect correction, and a dynamic "comet tail" visualizer.
- 📊 **Live Analytics Dashboard** — Real-time display of ball speed (km/h), spin rate (rpm), and frame-accurate playback.
- 🎥 **Interactive Playback** — Glassmorphic UI with timeline scrubbing, variable playback speed (0.25x - 2x), and smart camera presets (TV, Top-down, Player POV).
- 🧠 **AI Court Segmentation** — SegFormer-based court surface detection and automatic camera calibration.

---

## 🛠️ Technology Stack

| Layer | Technology |
|---|---|
| **🎨 Frontend** | React, Three.js (`react-three-fiber`), TailwindCSS, Vanilla CSS Design System |
| **⚙️ Backend** | FastAPI, Uvicorn, Python |
| **👁️ Computer Vision** | YOLOv8-Pose (Ultralytics), OpenCV, NumPy |
| **🧮 Physics & Math** | Kalman Filters, Magnus Effect Modeling, EMA Smoothing |
| **🤖 Machine Learning** | SegFormer (HuggingFace) |

---

## 🚀 Quick Start (Local Development)

Want to run the full CV pipeline and backend locally to analyze your own videos?

### 1. Prerequisites
- Python 3.10+
- Node.js 18+

### 2. Setup

```bash
# Clone the repository
git clone https://github.com/udayraj1238/CourtSense-AI.git
cd CourtSense-AI

# Setup Python environment
python -m venv .venv
source .venv/bin/activate  # Mac/Linux
# .venv\Scripts\activate   # Windows

# Install backend dependencies
pip install -r requirements.txt

# Setup frontend
cd frontend
npm install
cd ..
```

### 3. Run the App

Open two terminals:

**Terminal 1 — Backend (API & Video Processing)**
```bash
cd backend
python -m uvicorn main:app --host 0.0.0.0 --port 8000
```

**Terminal 2 — Frontend (3D UI)**
```bash
cd frontend
npm run dev
```

Point your browser to `http://localhost:5173` to upload videos or load demo data!

---

## 📂 Project Architecture

```text
CourtSense-AI/
├── backend/                # FastAPI server (Video Upload & Processing)
│   ├── main.py
│   └── models.py
├── frontend/               # React + Three.js Application
│   ├── src/
│   │   ├── components/     # TennisScene, Court, Ball, Player, Stadium, Effects
│   │   ├── App.tsx         # Main UI, Glassmorphic Controls, Routing
│   │   └── index.css       # Custom Design System Tokens & Animations
├── courtsense_ai/          # Core Python ML Pipeline
│   ├── core/               # Segmentation, Homography, Tracking, Physics
│   └── utils/              # Visualization helpers
├── scripts/                # Standalone Video Processing Scripts
└── data/                   # Generated JSON tracking data files
```

---

## 📄 License

This project is licensed under the MIT License.

<div align="center">
  <i>Built to push the boundaries of sports tech.</i>
</div>
