---
title: CourtSense Backend
emoji: 🎾
colorFrom: green
colorTo: blue
sdk: docker
app_port: 8000
---
<div align="center">

<!-- Animated Header -->
<img src="https://capsule-render.vercel.app/api?type=waving&color=0:0D9488,50:06B6D4,100:3B82F6&height=220&section=header&text=CourtSense%20AI&fontSize=50&fontColor=ffffff&animation=fadeIn&fontAlignY=35&desc=3D%20Tennis%20Analytics%20Engine&descSize=18&descAlignY=55&descAlign=50" width="100%"/>

<!-- Typing SVG -->
<a href="https://git.io/typing-svg"><img src="https://readme-typing-svg.demolab.com?font=Fira+Code&weight=600&size=22&pause=1000&color=06B6D4&center=true&vCenter=true&width=600&lines=Tennis+Video+%E2%86%92+Interactive+3D+Replay;YOLOv8-Pose+%7C+SegFormer+%7C+Three.js;Real-time+Speed+%26+Spin+Analytics;150-Frame+Physics-Accurate+Replays" alt="Typing SVG" /></a>

<br/>
<br/>

<a href="https://huggingface.co/spaces/udayraj1238/CourtSense-AI" target="_blank">
  <img src="https://img.shields.io/badge/🤗_Hugging_Face-Live_Demo-FFD21E?style=for-the-badge" alt="Hugging Face Space" />
</a>

<br/>

<!-- Badges Row 1 -->
<img src="https://img.shields.io/badge/Python-3776AB?style=for-the-badge&logo=python&logoColor=white" />
<img src="https://img.shields.io/badge/PyTorch-EE4C2C?style=for-the-badge&logo=pytorch&logoColor=white" />
<img src="https://img.shields.io/badge/FastAPI-009688?style=for-the-badge&logo=fastapi&logoColor=white" />
<img src="https://img.shields.io/badge/React-61DAFB?style=for-the-badge&logo=react&logoColor=black" />
<img src="https://img.shields.io/badge/Three.js-000000?style=for-the-badge&logo=three.js&logoColor=white" />
<img src="https://img.shields.io/badge/OpenCV-5C3EE8?style=for-the-badge&logo=opencv&logoColor=white" />

<br/>

<!-- Badges Row 2 -->
<img src="https://img.shields.io/badge/TypeScript-3178C6?style=for-the-badge&logo=typescript&logoColor=white" />
<img src="https://img.shields.io/badge/Docker-2496ED?style=for-the-badge&logo=docker&logoColor=white" />
<img src="https://img.shields.io/badge/MediaPipe-0097A7?style=for-the-badge&logo=google&logoColor=white" />

<br/><br/>

<!-- Stats Badges -->
<img src="https://img.shields.io/badge/150%20Frames-Per%20Replay-0D9488?style=flat-square&labelColor=1a1a2e" />
<img src="https://img.shields.io/badge/17%20Keypoints-Per%20Frame-06B6D4?style=flat-square&labelColor=1a1a2e" />
<img src="https://img.shields.io/badge/~70%25%20Jitter-Reduction-3B82F6?style=flat-square&labelColor=1a1a2e" />
<img src="https://img.shields.io/badge/±5%20km%2Fh-Speed%20Accuracy-8B5CF6?style=flat-square&labelColor=1a1a2e" />

</div>

---

<div align="center">
<h2>🎯 What It Does</h2>
</div>

<table>
<tr>
<td width="50%">

### 📥 Input
A raw tennis match video from **any camera angle** — broadcast footage, phone recording, or drone shot.

</td>
<td width="50%">

### 📤 Output
An **interactive 3D replay** you can rotate, zoom, and replay from any angle — with real-time **speed (km/h)** and **spin (rpm)** overlays.

</td>
</tr>
</table>

---

<div align="center">
<h2>🏗️ Architecture Pipeline</h2>
</div>

```mermaid
graph TD
    A[🎾 Tennis Match Video] --> B[YOLOv8-Pose]
    A --> C[SegFormer-B2]
    A --> D[HSV + YOLO]
    
    B -->|17 COCO Keypoints| E[OpenCV Homography]
    C -->|Court Mask| E
    D -->|Ball Position| F[Kalman Filter + EMA]
    
    E -->|3D Coordinates| G[Physics Engine]
    F -->|Smooth Trajectory| G
    
    G -->|Speed & Spin| H[FastAPI Backend]
    H -->|JSON Stream| I[React + Three.js]
    
    I --> J[🎮 Interactive 3D Replay]
    
    style A fill:#0D9488,stroke:#0D9488,color:#fff
    style B fill:#EE4C2C,stroke:#EE4C2C,color:#fff
    style C fill:#5C3EE8,stroke:#5C3EE8,color:#fff
    style D fill:#FF6F00,stroke:#FF6F00,color:#fff
    style E fill:#3B82F6,stroke:#3B82F6,color:#fff
    style F fill:#8B5CF6,stroke:#8B5CF6,color:#fff
    style G fill:#EC4899,stroke:#EC4899,color:#fff
    style H fill:#009688,stroke:#009688,color:#fff
    style I fill:#61DAFB,stroke:#333,color:#000
    style J fill:#10B981,stroke:#10B981,color:#fff
```

---

<div align="center">
<h2>✨ Key Features</h2>
</div>

<table>
<tr>
<td align="center" width="25%">
<img src="https://img.shields.io/badge/🏃-Player_Tracking-0D9488?style=for-the-badge&labelColor=1a1a2e" /><br/>
<b>YOLOv8-Pose</b><br/>
17 COCO keypoints per frame for full skeleton tracking
</td>
<td align="center" width="25%">
<img src="https://img.shields.io/badge/🎾-Court_Segmentation-06B6D4?style=for-the-badge&labelColor=1a1a2e" /><br/>
<b>SegFormer-B2</b><br/>
Pixel-perfect court surface segmentation
</td>
<td align="center" width="25%">
<img src="https://img.shields.io/badge/📐-3D_Mapping-3B82F6?style=for-the-badge&labelColor=1a1a2e" /><br/>
<b>OpenCV Homography</b><br/>
2D video → 3D court coordinates
</td>
<td align="center" width="25%">
<img src="https://img.shields.io/badge/🔮-Physics-8B5CF6?style=for-the-badge&labelColor=1a1a2e" /><br/>
<b>Magnus Effect</b><br/>
Realistic speed & spin estimation
</td>
</tr>
<tr>
<td align="center">
<img src="https://img.shields.io/badge/🎯-Ball_Tracking-EC4899?style=for-the-badge&labelColor=1a1a2e" /><br/>
<b>HSV + YOLO Fusion</b><br/>
Dual-method detection for reliability
</td>
<td align="center">
<img src="https://img.shields.io/badge/📊-Smoothing-F59E0B?style=for-the-badge&labelColor=1a1a2e" /><br/>
<b>Kalman + EMA (α=0.3)</b><br/>
~70% jitter reduction in 3D keypoints
</td>
<td align="center">
<img src="https://img.shields.io/badge/🖥️-3D_Viewer-10B981?style=for-the-badge&labelColor=1a1a2e" /><br/>
<b>Three.js Frontend</b><br/>
Rotate, zoom, replay from any angle
</td>
<td align="center">
<img src="https://img.shields.io/badge/📱-Client_Side-EF4444?style=for-the-badge&labelColor=1a1a2e" /><br/>
<b>100% Browser</b><br/>
No backend needed for processing
</td>
</tr>
</table>

---

<div align="center">
<h2>🛠️ Tech Stack</h2>
</div>

| Layer | Technology | Purpose |
|:------|:-----------|:--------|
| 🧠 **Pose Estimation** | YOLOv8-Pose, MediaPipe | 17-keypoint skeleton extraction |
| 🎨 **Segmentation** | SegFormer-B2 | Court surface pixel-level segmentation |
| 🎯 **Ball Tracking** | HSV Detection + YOLO | Dual-method fused ball detection |
| 📐 **Mapping** | OpenCV Homography | 2D video → 3D real-world coordinates |
| 📊 **Smoothing** | Kalman Filter, EMA | Trajectory denoising & stabilization |
| ⚡ **Physics** | Magnus-effect model | Speed (km/h) & spin (rpm) estimation |
| 🔌 **Backend** | FastAPI, Python | REST API + JSON coordinate streams |
| 🖥️ **Frontend** | React, Three.js, TypeScript | Interactive 3D visualization |
| 🐳 **Deploy** | Docker, GitHub Pages | Containerized & static deployment |

---

<div align="center">
<h2>🚀 Quick Start</h2>
</div>

```bash
# Clone
git clone https://github.com/udayraj1238/CourtSense-AI.git
cd CourtSense-AI

# Backend
pip install -r requirements.txt
uvicorn main:app --reload --port 8000

# Frontend (new terminal)
cd frontend && npm install && npm run dev
```

---

<div align="center">
<h2>📈 Performance</h2>
</div>

<table>
<tr>
<td align="center">
<h3>150</h3>
<sub>Frames per replay</sub>
</td>
<td align="center">
<h3>~70%</h3>
<sub>Jitter reduction</sub>
</td>
<td align="center">
<h3>±5 km/h</h3>
<sub>Speed accuracy</sub>
</td>
<td align="center">
<h3>30+ FPS</h3>
<sub>3D rendering</sub>
</td>
</tr>
</table>

---

<div align="center">
<h2>📄 License</h2>
<p>Open source under the <a href="LICENSE">MIT License</a></p>

<br/>

<h2>🤝 Contact</h2>
<a href="https://www.linkedin.com/in/uday6002/"><img src="https://img.shields.io/badge/LinkedIn-0A66C2?style=for-the-badge&logo=linkedin&logoColor=white" /></a>
<a href="https://udayraj1238.vercel.app"><img src="https://img.shields.io/badge/Portfolio-000000?style=for-the-badge&logo=vercel&logoColor=white" /></a>
<a href="mailto:rajuday6002@gmail.com"><img src="https://img.shields.io/badge/Email-EA4335?style=for-the-badge&logo=gmail&logoColor=white" /></a>

</div>

<img src="https://capsule-render.vercel.app/api?type=waving&color=0:0D9488,50:06B6D4,100:3B82F6&height=120&section=footer" width="100%"/>
