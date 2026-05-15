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
    <img src="https://img.shields.io/badge/React-19-61dafb?style=flat-square&logo=react&logoColor=black" alt="React" />
    <img src="https://img.shields.io/badge/Three.js-3D-black?style=flat-square&logo=three.js" alt="Three.js" />
    <img src="https://img.shields.io/badge/YOLOv8-Pose-ff0000?style=flat-square" alt="YOLOv8" />
    <img src="https://img.shields.io/badge/FastAPI-Backend-009688?style=flat-square&logo=fastapi" alt="FastAPI" />
  </p>
</div>

---

**CourtSense AI** processes standard tennis match videos using computer vision and transforms them into a stunning, interactive 3D visualization. Watch every rally in real-time, track player movement, and analyze ball physics — all in your browser.

✨ **[Experience the Live Demo Here](https://udayraj1238.github.io/CourtSense-AI/)** ✨ — no installation required.

---

## 🌟 Key Features

- 🏟️ **Cinematic 3D Court** — Immersive stadium with dynamic lighting, `ContactShadows`, post-processing (Bloom, Chromatic Aberration, Vignette) via `react-three-fiber`.
- 🎾 **Physics-Based Ball Trail** — Real-time comet trail using pre-allocated GPU buffer geometry (zero GC pressure), speed-reactive emissive color (yellow → orange), and dynamic point light.
- 🏃 **Player Tracking** — YOLOv8-Pose detection mapped to 3D via homography. Players have idle breathing animation and anticipation movement toward incoming shots.
- 📊 **Live Analytics HUD** — Right-side panel with radial speed gauge (0–250 km/h), spin rate ring, and progress tracker. Real-time ball speed 120–200 km/h on drives.
- 🗺️ **Ball Heatmap** — Toggle a top-down 2D court overlay showing ball position density (press `H`).
- 🎥 **Interactive Playback** — Glassmorphic controls with timeline scrubbing (drag), variable speed (0.25x–2x), and 4 camera presets (TV, Top-down, P1-POV, P2-POV) with smooth lerp transitions.
- 🔔 **Smart Notifications** — Non-blocking toast system replacing all browser `alert()` dialogs.
- 🔌 **Backend Status Indicator** — Real-time green/red backend connectivity badge. Upload button runs a health check before opening the file picker.

---

## 🛠️ Technology Stack

| Layer | Technology |
|---|---|
| **🎨 Frontend** | React 19, Three.js (`react-three-fiber`), `@react-three/drei`, `@react-three/postprocessing`, TailwindCSS v4, Custom CSS Design System |
| **⚙️ Backend** | FastAPI, Uvicorn, Python 3.10+ |
| **👁️ Computer Vision** | YOLOv8-Pose (Ultralytics), OpenCV, NumPy |
| **🧮 Physics** | Kalman Filters, Magnus Effect Modeling, Parabolic Arc Simulation |
| **☁️ Deployment** | GitHub Pages (Frontend) + Hugging Face Spaces (Backend) |

---

## 🚀 Quick Start

### Option A — Free Demo (No Setup Required)

1. Open **[udayraj1238.github.io/CourtSense-AI](https://udayraj1238.github.io/CourtSense-AI/)**
2. Click **"Or load pre-generated demo →"**
3. The demo auto-plays a cinematic 18-shot rally with real physics

### Option B — Upload Your Own Video

Custom video processing requires the AI backend. You have two options:

#### 🌐 Via Google Colab (Free, Recommended)

1. Open the **[CourtSense Colab Backend](https://colab.research.google.com/github/udayraj1238/CourtSense-AI/blob/main/colab_backend.ipynb)**
2. Click **Runtime → Run all** — wait ~30 seconds
3. Copy the `loca.lt` tunnel URL printed at the bottom
4. On the site, click **⚙️ Settings** → paste the URL → **Save & Connect**
5. The badge turns **green** → now upload any tennis match video!

#### 🖥️ Via Local Backend

```bash
git clone https://github.com/udayraj1238/CourtSense-AI.git
cd CourtSense-AI

# Backend
python -m venv .venv
.venv\Scripts\activate       # Windows
# source .venv/bin/activate  # Mac/Linux
pip install -r requirements.txt
cd backend
uvicorn main:app --host 0.0.0.0 --port 8000

# Frontend (new terminal)
cd frontend
npm install
npm run dev
# Open http://localhost:5173/CourtSense-AI/
```

---

## 📂 Project Architecture

```text
CourtSense-AI/
├── backend/                   # FastAPI server (upload + CV processing)
│   ├── main.py                # /health, /upload, /tracking endpoints
│   └── models.py              # Pydantic schemas
├── frontend/                  # React + Three.js application
│   ├── public/
│   │   └── demo_data.json     # Pre-generated 18-shot rally (loads without backend)
│   └── src/
│       ├── components/
│       │   ├── TennisScene.tsx    # Canvas, lighting, camera lerp, ContactShadows
│       │   ├── Ball.tsx           # Dynamic light, speed-reactive emissive, zero-alloc useFrame
│       │   ├── BallTrail.tsx      # Pre-allocated DynamicDrawUsage BufferGeometry
│       │   ├── Player.tsx         # YOLOv8 player model + breathing animation
│       │   ├── Court.tsx          # Emissive court lines, reflective ground
│       │   ├── Stadium.tsx        # Stadium environment
│       │   ├── Effects.tsx        # Bloom, ChromaticAberration, Vignette, ToneMapping
│       │   ├── AnalyticsSidebar.tsx  # Speed gauge + spin ring HUD
│       │   ├── HeatmapOverlay.tsx    # Canvas-based 2D ball heatmap
│       │   └── Toast.tsx            # Non-blocking notification system
│       ├── App.tsx             # Main UI, state, animation loop
│       └── index.css           # Design system tokens, keyframes, glassmorphism utilities
├── courtsense_ai/             # Core Python ML pipeline
│   ├── core/                  # Segmentation, Homography, Tracking, Physics
│   └── utils/                 # Visualization helpers
├── scripts/
│   └── generate_rally.py      # Generates cinematic demo data (writes public/demo_data.json)
├── data/                      # Generated JSON tracking data
├── Dockerfile                 # HuggingFace Spaces backend container
└── .github/workflows/
    ├── deploy.yml             # GitHub Pages frontend deploy (triggers on push to main)
    └── huggingface.yml        # HF Spaces backend sync (triggers on push to main)
```

---

## ⌨️ Keyboard Shortcuts (Viewer)

| Key | Action |
|---|---|
| `Space` | Play / Pause |
| `←` / `→` | Step one frame |
| `R` | Reset to frame 0 |
| `H` | Toggle ball heatmap |

---

## 🔌 API Reference

| Endpoint | Method | Description |
|---|---|---|
| `/health` | GET | Backend connectivity check |
| `/api/v1/tracking/upload` | POST | Upload video → returns tracking sequence |
| `/api/v1/tracking/real` | GET | Load pre-processed match data from `data/real_match_data.json` |
| `/api/v1/tracking/sequence` | GET | Synthetic mock sequence (no video needed) |

---

## 📄 License

MIT License — see [LICENSE](LICENSE) for details.

<div align="center">
  <i>Built to push the boundaries of sports tech.</i>
</div>
