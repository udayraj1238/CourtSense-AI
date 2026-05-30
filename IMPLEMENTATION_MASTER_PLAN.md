# CourtSense AI — Implementation Master Plan

> **Document Version:** 1.1  
> **Author:** Lead AI Engineer / System Architect (Cursor Agent)  
> **Status:** Revised — Awaiting Approval  
> **Last Updated:** 2026-05-30  
> **Official Site:** [https://udayraj1238.github.io/CourtSense-AI/](https://udayraj1238.github.io/CourtSense-AI/)

---

## Executive Summary

CourtSense AI is transitioning from **Version 4 (Hybrid Synthetic)** — where the browser generates a visually perfect but empirically fake rally — to **Version 5 (Empirical CV Pipeline)** — where a Python backend detects real court geometry, players, and ball trajectories from broadcast tennis video, and the React/Three.js frontend remains a pure visualization layer.

This document is the authoritative blueprint. **No implementation code should be written until the user approves this plan.**

---

## Table of Contents

1. [Phase 1 — Codebase Comprehension](#phase-1--codebase-comprehension)
2. [Phase 2 — Backend Architecture & API Design](#phase-2--backend-architecture--api-design)
3. [Phase 3 — Court Calibration & Homography](#phase-3--court-calibration--homography-opencv)
4. [Phase 4 — Ball Tracking Engine](#phase-4--ball-tracking-engine-tracknet--yolo)
5. [Phase 5 — Advanced Player Pose & Biomechanics](#phase-5--advanced-player-pose--biomechanics)
6. [Phase 6 — Model Training & Fine-Tuning Pipeline](#phase-6--model-training--fine-tuning-pipeline)
7. [Phase 7 — Frontend 3D Resilience](#phase-7--frontend-3d-resilience)
8. [Proposed Tech Stack](#proposed-tech-stack)
9. [Target Directory Structure](#target-directory-structure)
10. [JSON Contract Specification](#json-contract-specification)
11. [Execution Roadmap](#execution-roadmap)
12. [Production Deployment — GitHub Pages](#production-deployment--github-pages)
13. [Risk Register & Mitigations](#risk-register--mitigations)
14. [Existing Assets vs. Greenfield Work](#existing-assets-vs-greenfield-work)

---

## Phase 1 — Codebase Comprehension

### 1.1 Current Architecture (V4 Hybrid Synthetic)

```
User uploads .mp4
       │
       ▼
frontend/src/utils/videoProcessor.ts  (100% browser)
       │
       ├── MediaPipe PoseLandmarker (28 samples @ 480×270)
       │     └── Hip midpoint (landmarks 23+24) → normalized court X/Z
       │
       └── Deterministic physics rally engine (generateRally)
             └── Outputs ProcFrameData[] @ 30 FPS
       │
       ▼
App.tsx → updatePositions() → TennisScene.tsx
       │
       ├── Ball.tsx      (lerp delta×18 on x,y,z)
       ├── Player.tsx    (lerp delta×5 on x,z; y locked to 0)
       └── Court.tsx     (ITF dimensions: 10.97m × 23.77m singles)
```

The Python backend (`backend/main.py`) exists but is **not wired into the frontend upload flow**. It offers a synchronous `POST /api/v1/tracking/upload` and mock endpoints. The frontend never calls it during normal use.

### 1.2 Coordinate System (Sacred Contract)

All backend output **must** use this coordinate frame. It is defined identically in:

- `frontend/src/utils/videoProcessor.ts` (lines 30–31)
- `scripts/generate_demo_from_video.mjs` (lines 19–20)
- `frontend/src/components/Court.tsx` (ITF singles court geometry)

| Axis | Meaning | Range (typical) | Notes |
|------|---------|-----------------|-------|
| **X** | Lateral (left ↔ right) | `[-HW, +HW]` = `[-4.115, +4.115]` m | Positive = right side of court |
| **Y** | Height above ground | `[0.08, ~3.0]` m in flight | Players always `y = 0` |
| **Z** | Depth (baseline ↔ baseline) | `[-HL, +HL]` = `[-11.885, +11.885]` m | Positive = near-side (bottom/P1 half) |

**Constants:**

```
HW = 4.115   # half singles width  (8.23 / 2)
HL = 11.885  # half court length   (23.77 / 2)
ORIGIN = court center at ground plane (net line, y=0)
OUTPUT_FPS = 30
MAX_VIDEO_DURATION = 30 seconds (frontend cap; backend should match)
```

**Player ID convention:**

| ID | Role | Z half | Three.js side |
|----|------|--------|---------------|
| `player_bottom` | P1 (near camera / positive Z) | `z ∈ [0.4, HL − 0.2]` | `Player.tsx side="bottom"` |
| `player_top` | P2 (far side / negative Z) | `z ∈ [−HL + 0.2, −0.4]` | `Player.tsx side="top"` |

**Homography mapping note:** OpenCV homography produces a top-down 2D plane `(court_x, court_z)` in meters. The backend must map:

```
pixel (u, v)  →  homography  →  (x, z)   # ground plane
ball pixel height estimation or physics  →  y
```

The existing `camera_calibration.py` maps to `(X, Y)` in a 2D top-down view. We will rename/document this as `(x, z)` to match the frontend, with **Y reserved for height**.

### 1.3 ProcFrameData JSON Contract

This is the **single integration boundary** between backend and frontend. Defined in `videoProcessor.ts`:

```typescript
interface ProcFrameData {
  frame_index: number;
  ball: {
    position: { x: number; y: number; z: number };
    is_occluded: boolean;
  };
  players: {
    id: string;           // "player_bottom" | "player_top"
    position: { x: number; y: number; z: number };
  }[];
  ball_speed_kmh: number;
  spin_rate_rpm: number;
  hitter: 'p1' | 'p2' | null;
}
```

**Envelope:**

```json
{ "sequence": [ /* ProcFrameData[] */ ] }
```

**Precision:** Round coordinates to 3 decimal places (`r3()` helper in videoProcessor).

**Per-frame invariants the backend must satisfy:**

- `players.length === 2` (always both players present)
- Player `y` always `0.0`
- Ball `y >= 0.08` (never underground)
- `ball_speed_kmh` and `spin_rate_rpm` are non-negative floats
- `hitter` is set only on contact frames (~6% window at shot start/end in V4)

### 1.4 Frontend Rendering Mechanics

Understanding these is critical for Phase 7 jitter handling:

| Component | Smoothing | Key Detail |
|-----------|-----------|------------|
| `Ball.tsx` | `lerp(delta × 18)` toward target position | Also derives visual spin/glow from positional delta |
| `Player.tsx` | `lerp(delta × 5)` on X/Z only | Y forced to 0; arm swing driven by `isHitting` prop |
| `TennisScene.tsx` | Camera `lerp(delta × 3.5)` | No entity interpolation at scene level |
| `App.tsx` | **None** — discrete 30 FPS frame stepping | `updatePositions()` sets state directly from sequence |

**Implication:** Noisy backend data will be partially smoothed by Ball/Player lerp, but large frame gaps (>20 frames) will cause visible lag or drift. Phase 7 must add **sequence-level gap filling** before data reaches the 3D components.

**Player mapping (fixed in Milestone 1):** `App.tsx` previously inverted P1/P2 (`top` → P1). Correct mapping: `player_bottom` → P1, `player_top` → P2. This fix ships in Milestone 1 so all integration tests from day one show correct positions on the live site.

### 1.5 Existing Python Modules (Reusable Skeleton)

| Module | Status | Reuse Strategy |
|--------|--------|----------------|
| `camera_calibration.py` | Functional homography math | Extend with auto line detection |
| `ball_tracking.py` | YOLO COCO class-32 only | Replace with fine-tuned model + TrackNet |
| `biometrics.py` | YOLOv8n-pose wrapper | Upgrade to yolov8m-pose + wrist extraction |
| `physics.py` | 2D Kalman (pixel space) | Upgrade to 3D state + cubic spline |
| `segmentation.py` | Cityscapes placeholder | Replace with court-specific model or line CV |
| `tracking.py` | Ankle midpoint → homography | Extend with hip fallback + player assignment |
| `process_real_video.py` | Monolithic sync script | Refactor into pipeline orchestrator |

---

## Phase 2 — Backend Architecture & API Design

### 2.1 Design Principles

1. **Frontend = visualization only.** No ML in browser for V5 production path.
2. **Async by default.** CV on 30s of 1080p video takes 30–120s on CPU, 10–30s on GPU.
3. **Contract-first.** Every pipeline stage emits partial results toward `ProcFrameData[]`.
4. **Graceful degradation.** Missing ball frames → Kalman/spline fill + `is_occluded: true`.
5. **V4 fallback preserved.** Client-side `videoProcessor.ts` remains as offline/demo mode.

### 2.2 Proposed Backend Folder Structure

```
backend/
├── main.py                    # FastAPI app entry, CORS, lifespan
├── config.py                  # Settings via pydantic-settings
├── models/
│   ├── api.py                 # JobStatus, UploadResponse, SequenceResponse
│   └── tracking.py            # ProcFrameData Pydantic models (mirror TS)
├── api/
│   ├── routes/
│   │   ├── health.py
│   │   ├── jobs.py            # POST upload, GET status, GET result
│   │   └── ws.py              # WebSocket progress stream (optional V1.1)
│   └── deps.py
├── services/
│   ├── job_manager.py         # Job lifecycle, progress callbacks
│   └── storage.py             # Temp file + result JSON persistence
├── pipeline/
│   ├── orchestrator.py        # Runs stages, reports progress
│   ├── stages/
│   │   ├── ingest.py          # FFmpeg decode, frame extraction
│   │   ├── calibration.py     # Court line detection + homography
│   │   ├── player_tracking.py # YOLOv8-pose per frame
│   │   ├── ball_tracking.py   # TrackNet/YOLO + Kalman
│   │   ├── event_detection.py # Bounce/hit classification
│   │   ├── analytics.py       # Speed, spin estimation
│   │   └── export.py          # ProcFrameData[] serializer
│   └── progress.py            # Stage weights for progress bar
├── cv/                        # Moved/refactored from courtsense_ai/core/
│   ├── homography.py
│   ├── court_lines.py
│   ├── ball_tracker.py
│   ├── pose_estimator.py
│   ├── kalman3d.py
│   └── spline.py
└── training/                  # Phase 6
    ├── datasets/
    ├── scripts/
    └── configs/
```

The existing `courtsense_ai/` package will be **gradually migrated** into `backend/cv/` to avoid dual maintenance. During transition, `courtsense_ai` remains importable.

### 2.3 Task Queue Strategy

| Tier | Technology | When |
|------|------------|------|
| **V1 (MVP)** | `asyncio` background tasks + in-memory dict OR SQLite job store | Single-server dev/demo; Hugging Face Spaces |
| **V1.1** | Same + Redis for job state persistence | Survive server restarts |
| **V2 (Production)** | Celery + Redis/RabbitMQ | Horizontal scaling, GPU workers |

**V1 recommendation:** `asyncio.create_task()` with a `JobManager` singleton. Jobs stored in SQLite (`jobs.db`) with states: `queued → processing → completed | failed`. This avoids Celery/Redis infrastructure for initial development while supporting polling.

**Progress reporting:** Each pipeline stage reports `(stage_name, stage_pct, overall_pct)`. Weights:

| Stage | Weight |
|-------|--------|
| Ingest / decode | 5% |
| Court calibration | 15% |
| Player pose (all frames) | 35% |
| Ball tracking (all frames) | 30% |
| Analytics + export | 15% |

### 2.4 API Endpoints

#### CORS (Milestone 1 — mandatory)

The official frontend runs at `https://udayraj1238.github.io` (base path `/CourtSense-AI/`). Local dev uses `http://localhost:5173`. The backend runs on a **different origin** (localhost:8000 or Hugging Face Spaces). **Every browser request will silently fail without explicit CORS.**

`backend/main.py` must register this middleware on app creation (before any routes):

```python
from fastapi.middleware.cors import CORSMiddleware

app.add_middleware(
    CORSMiddleware,
    allow_origins=[
        "http://localhost:5173",
        "http://127.0.0.1:5173",
        "https://udayraj1238.github.io",
    ],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)
```

For Hugging Face Spaces dev, also allow the Space origin via `config.py` (`CORS_ORIGINS` env var). Do **not** rely on `allow_origins=["*"]` with `allow_credentials=True` — browsers reject that combination.

#### `POST /api/v2/jobs/upload`

```
Content-Type: multipart/form-data
Body: file=<video.mp4>

Response 202 Accepted:
{
  "job_id": "550e8400-e29b-41d4-a716-446655440000",
  "status": "queued",
  "message": "Video accepted for processing"
}
```

Constraints:
- Max file size: 100 MB (configurable)
- Accepted formats: `.mp4`, `.mov`, `.webm`
- Max duration: 30s — **enforced in `ingest.py` via ffprobe before any CV stage** (see §2.6)

#### `GET /api/v2/jobs/{job_id}/status`

```
Response 200:
{
  "job_id": "...",
  "status": "processing",          // queued | processing | completed | failed | calibration_required
  "progress": 42,                  // 0-100 overall
  "stage": "ball_tracking",        // current stage name
  "stage_progress": 67,            // 0-100 within stage
  "frames_total": 900,
  "frames_processed": 603,
  "error": null,
  "calibration_failed": false      // true → frontend prompts manual 4-corner input
}
```

#### `GET /api/v2/jobs/{job_id}/result`

```
Response 200 (when status=completed):
{
  "sequence": [ /* ProcFrameData[] */ ]
}

Response 202 (when still processing):
{ "status": "processing", "progress": 42 }

Response 404 / 410 if job not found or expired
```

#### `WS /api/v2/jobs/{job_id}/ws` (V1.1 optional)

Push `{ progress, stage, stage_progress }` every 500ms. Frontend subscribes during processing overlay.

#### Legacy endpoints (preserved)

- `GET /health`
- `GET /api/v1/tracking/sequence` — mock data (dev)
- `POST /api/v1/tracking/upload` — deprecated sync upload (remove after V2 migration)

### 2.5 Job Lifecycle, Cleanup & TTL

Jobs and uploaded videos **must not accumulate on disk indefinitely.**

| Policy | Value |
|--------|-------|
| Job TTL | 1 hour after creation |
| Temp video files | Deleted on `completed`, `failed`, or TTL expiry |
| Result JSON | Deleted on TTL expiry (client must fetch before expiry) |
| Cleanup trigger | Background asyncio task every 5 minutes in `job_manager.py` |

```python
# services/job_manager.py (conceptual)
JOB_TTL_SECONDS = 3600

async def cleanup_expired_jobs():
    for job in expired_jobs():
        delete_temp_video(job.upload_path)
        delete_result_json(job.result_path)
        mark_job_expired(job.id)
```

### 2.6 Video Ingest — FPS Normalization & Duration Gate

**All CV stages assume exactly 30 FPS.** If the user uploads 60fps slow-motion or 24fps broadcast footage, frame indices and physics timing will corrupt without explicit resampling.

`pipeline/stages/ingest.py` responsibilities (runs **first**, before calibration):

```
1. ffprobe → read duration, native fps, resolution
2. IF duration > 30s → reject with 400 { "error": "video_too_long", "max_seconds": 30 }
3. FFmpeg resample → exactly 30fps, H.264 intermediate:
     ffmpeg -i input.mp4 -t 30 -r 30 -vf "scale=min(1920,iw):-2" ingest/{job_id}/normalized.mp4
4. Extract frame manifest: frame_index, timestamp_ms (always 1000/30 ≈ 33.33ms apart)
5. Pass normalized video path to all downstream stages
```

**Duration enforcement location:** `ingest.py` only — never after pose/ball stages. Rejecting late wastes GPU minutes.

**Output frame count invariant:** `len(sequence) == min(duration_sec, 30) * 30`

### 2.7 Frontend Polling Contract

When the frontend polls `GET /api/v2/jobs/{job_id}/status`:

| Phase | Interval | Behavior |
|-------|----------|----------|
| First 60 seconds | **2 seconds** | Fixed interval |
| After 60 seconds | Exponential backoff | 2s → 4s → 8s → cap at 15s |
| On `status === "completed"` | Stop polling | Fetch result immediately |
| On `calibration_failed: true` | Stop polling | Show manual 4-corner UI |
| On `status === "failed"` | Stop polling | Show error toast |

Implement in `frontend/src/utils/jobPoller.ts` (Milestone 1).

### 2.8 Frontend Integration (Minimal Rewrite)

Changes to `App.tsx`:

1. Add `VITE_API_URL` env var — production build points to Hugging Face Space URL; local dev defaults to `http://localhost:8000`.
2. New upload handler: `POST /api/v2/jobs/upload` → poll status (§2.7) → fetch result.
3. Keep `processVideoFile()` as **default on GitHub Pages** (no backend on static host); enable server path when `VITE_API_URL` is set.
4. Shared type: extract `ProcFrameData` to `frontend/src/types/tracking.ts`.
5. **Player ID mapping fix** — ship in Milestone 1 (`player_bottom` → P1, `player_top` → P2).
6. On `calibration_failed: true` → render 4-corner overlay on video thumbnail → `POST /api/v2/jobs/{id}/calibrate` with pixel corners → resume job.

Processing overlay already supports step labels and percentage — map backend `stage` strings to existing `PROCESSING_STEPS` array.

### 2.9 Orchestrator Error Handling — Homography Failure

`pipeline/orchestrator.py` must define explicit behavior when `CourtProjector.from_frame()` raises:

```python
try:
    projector = CourtProjector.from_frame(calibration_frame)
except CalibrationError as e:
    job_manager.fail_calibration(
        job_id,
        error_code="calibration_failed",
        message=str(e),
        calibration_failed=True,
    )
    return  # do NOT proceed to pose/ball stages
```

**API response when calibration fails:**

```json
{
  "job_id": "...",
  "status": "calibration_required",
  "progress": 15,
  "stage": "calibration",
  "calibration_failed": true,
  "error": "Could not detect court lines. Manual corner input required."
}
```

**Frontend behavior:** Do not show a generic "Processing failed" toast. Instead, overlay the first video frame and prompt the user to click 4 court corners (TL, TR, BR, BL), then resubmit via `POST /api/v2/jobs/{job_id}/calibrate`.

**Manual calibration endpoint (Milestone 2):**

```
POST /api/v2/jobs/{job_id}/calibrate
Body: { "corners": [[u1,v1], [u2,v2], [u3,v3], [u4,v4]] }
→ Recomputes homography, resumes pipeline from calibration stage
```

---

## Phase 3 — Court Calibration & Homography (OpenCV)

### 3.1 Problem Statement

Broadcast tennis cameras use perspective projection. We must recover a homography `H` mapping image pixels to the court ground plane in meters `(x, z)`.

### 3.2 OpenCV Pipeline

```
Frame (720p/1080p)
    │
    ▼
[1] Preprocessing
    ├── Resize to max 1280px width (speed)
    ├── Convert BGR → HSV/LAB
    └── White line enhancement (adaptive threshold on high-V/low-S pixels)
    │
    ▼
[2] Edge Detection
    ├── Gaussian blur (5×5)
    ├── Canny (adaptive thresholds via median intensity)
    └── Morphological close to connect broken line segments
    │
    ▼
[3] Line Detection
    ├── Probabilistic Hough Transform (cv2.HoughLinesP)
    ├── Filter by angle buckets: ~0° (baselines), ~90° (sidelines/service lines)
    └── Merge collinear segments (DBSCAN or distance clustering)
    │
    ▼
[4] Court Geometry Matching
    ├── Detect parallel line pairs at known ITF ratios:
    │     singles width : court length = 8.23 : 23.77
    │     service line distance from net = 6.4m
    ├── Find 4 outer corners OR 6+ line intersections
    └── RANSAC homography fit (cv2.findHomography, RANSAC)
    │
    ▼
[5] Validation
    ├── Reproject known court points; max reprojection error < 5px
    ├── Check aspect ratio of projected court quad
    └── Fallback: manual 4-point click UI (Phase 7 frontend) if auto fails
    │
    ▼
[6] CourtProjector class
    pixel (u,v) → (x, z) in meters
```

### 3.3 CourtProjector Utility Class

```python
# backend/cv/homography.py (conceptual API)

class CourtProjector:
    HW: float = 4.115
    HL: float = 11.885

    def __init__(self, homography: np.ndarray):
        self.H = homography

    @classmethod
    def from_frame(cls, frame: np.ndarray) -> "CourtProjector":
        """Auto-detect court lines and compute H."""
        ...

    def pixel_to_court(self, u: float, v: float) -> tuple[float, float]:
        """Returns (x, z) in meters on ground plane."""
        pt = np.array([[[u, v]]], dtype=np.float32)
        xz = cv2.perspectiveTransform(pt, self.H)[0, 0]
        return float(xz[0]), float(xz[1])

    def pixel_to_3d(
        self, u: float, v: float, y: float = 0.0
    ) -> tuple[float, float, float]:
        """Returns (x, y, z). y passed explicitly for ball height."""
        x, z = self.pixel_to_court(u, v)
        return x, y, z

    def clamp_to_court(self, x: float, z: float) -> tuple[float, float]:
        return (
            max(-self.HW, min(self.HW, x)),
            max(-self.HL, min(self.HL, z)),
        )
```

**Reference destination points** for `findHomography` (image corners → court meters):

```
Top-left baseline corner:      (-HW, -HL)
Top-right baseline corner:     (+HW, -HL)
Bottom-right baseline corner:  (+HW, +HL)
Bottom-left baseline corner:   (-HW, +HL)
```

Assignment of image corners to court corners uses line intersection ordering (top/bottom by Y, left/right by X in image space after clustering).

### 3.4 SegFormer Alternative (Phase 3b)

The existing `CourtSegmenter` uses a Cityscapes model (placeholder). For broadcast footage where white lines are clear, **classical CV (Hough) is faster and more interpretable**. SegFormer fine-tuned on tennis courts becomes a fallback when:

- Clay courts with low line contrast
- Partial court visibility
- Heavy shadow

---

## Phase 4 — Ball Tracking Engine (TrackNet / YOLO)

### 4.1 Why Standard YOLO Fails

| Challenge | Impact |
|-----------|--------|
| Ball diameter 3–8 px at 1080p | Below reliable detection threshold |
| Motion blur streaks | Bounding box models miss elongated blur |
| Occlusion (player, net) | 10–40% of rally frames |
| Yellow/green color confusion | False positives on court lines, logos |

### 4.2 Proposed Model Architecture

**Primary: TrackNetV2-style temporal heatmap model**

- Input: 3 consecutive frames stacked (RGB × 3 = 9 channels), resized to 512×288
- Output: 2D Gaussian heatmap centered on ball
- Architecture: U-Net encoder-decoder (TrackNet paper) or lightweight custom CNN
- Inference: argmax of heatmap → `(u, v)` sub-pixel centroid

**Secondary / fusion: Fine-tuned YOLOv8n**

- Custom class `tennis_ball` (single class)
- Input tiles at full resolution for zoomed broadcast crops
- Fuse: if TrackNet confidence > τ₁ use TrackNet; elif YOLO confidence > τ₂ use YOLO; else `None`

**Fallback: HSV blob detector** (already in `process_real_video.py`)

- For yellow ball on hard court
- Low compute; useful as ensemble voter

### 4.3 Temporal Smoothing — 3D Kalman Filter

Upgrade `physics.py` from 2D pixel Kalman to **3D court-space Kalman**:

```
State vector: [x, y, z, vx, vy, vz]  (meters, m/s)
Measurement:  [x, y, z] from projected detections
```

**Occlusion handling:**

1. Detection missing → `predict()` only, set `is_occluded: true`
2. Gap ≤ 20 frames → Kalman prediction + cubic spline bridge
3. Gap > 20 frames → mark segment as `occluded`; frontend tweens (Phase 7)

**Post-processing:**

- Gaussian smoothing `[0.25, 0.50, 0.25]` (match V4 `gaussSmooth`)
- Minimum height clamp `y >= 0.08`

### 4.4 Ball Height (Y) Estimation

Pixel-only detection gives reliable `(x, z)` on the ground plane. **Y (height) must not rely on bounding-box bottom-edge heuristics** — at broadcast angles, ball shadows and perspective make this noisy and unreliable.

**V5.0 Y estimation strategy (mandatory order):**

```
1. PRIMARY — Parabolic arc fit between consecutive ground bounces
   ├── Detect bounces (§4.5) where y ≈ 0.08–0.35m
   ├── Between bounce_i and bounce_{i+1}, fit y(t) = a*t² + b*t + c
   │     subject to y(bounce) = 0.08 (court contact clamp)
   └── Sample y at each frame_index from the fitted parabola

2. SECONDARY — Kalman filter Y state (when bounce anchors exist)
   └── 3D Kalman propagates y between bounce-anchored segments

3. HARD FALLBACK — y = 0.08
   ├── Used when: no bounce detected in segment, gap > 20 frames, or fit R² < threshold
   └── Always clamp: y = max(0.08, y)
```

**Explicitly NOT used in V5.0:** bbox bottom-edge relative to ground projection.

**V5.1+:** Multi-segment spin-aware trajectory fitting; perspective height from court line geometry.

### 4.5 Bounce & Hit Detection

**Bounce detection algorithm:**

```python
def detect_bounces(positions: list[Vec3], fps: int = 30) -> list[int]:
    """
    Returns frame indices of court bounces.
    """
    bounces = []
    for i in range(2, len(positions) - 2):
        y_prev, y_curr, y_next = positions[i-1].y, positions[i].y, positions[i+1].y
        vy_before = (y_curr - y_prev) * fps
        vy_after  = (y_next - y_curr) * fps

        # Bounce: descending → ascending, near ground
        if y_curr < 0.35 and vy_before < -0.5 and vy_after > 0.5:
            bounces.append(i)

        # Alternative: local minimum in y with |z| velocity preserved
    return bounces
```

**Hit (racket contact) detection:**

```python
def detect_hits(
    ball_positions, player_wrists, fps=30
) -> list[tuple[int, str]]:  # (frame, 'p1'|'p2')
    """
    Hit criteria (any 2 of 3):
    1. Ball-wrist distance < 1.2m (3D)
    2. |Δvelocity| > threshold (impulsive change)
    3. Elbow angle local minimum (swing contact)
    """
```

Output `hitter: 'p1' | 'p2' | null` on contact frames (±2 frames), matching V4 swing trigger windows.

### 4.6 Speed & Spin Analytics

**Speed (km/h):**

```python
speed_kmh = np.linalg.norm([vx, vy, vz]) * 3.6
```

Smooth with 5-frame rolling median; emit per frame.

**Spin (rpm):**

| Version | Behavior |
|---------|----------|
| **V5.0** | Return `spin_rate_rpm: 0.0` for all frames unless a rough curvature proxy is available (optional, off by default). Magnus-effect fitting requires clean multi-bounce trajectories; a 30s clip rarely provides enough clean data. **Do not emit garbage spin values** — the frontend spin visualization must not show nonsense. |
| **V5.1** | Fit spin from post-bounce trajectory curvature change when ≥2 clean bounces exist in a segment |

```python
# analytics.py V5.0 default
spin_rate_rpm = 0.0  # honest placeholder until V5.1
```

---

## Phase 5 — Advanced Player Pose (Biomechanics)

### 5.1 Model Upgrade Path

| Version | Model | Rationale |
|---------|-------|-----------|
| V5.0 | `yolov8m-pose.pt` | Better accuracy than nano; feasible on GPU |
| V5.1 | `yolov8x-pose.pt` or RTMPose | Broadcast quality |
| V5.2 | Temporal smoothing (OneEuro filter) | Reduce jitter |

### 5.2 Keypoint Extraction

COCO 17-keypoint layout. Critical indices:

| Index | Joint | Use |
|-------|-------|-----|
| 9, 10 | Left/Right Wrist | Racket contact zone proxy |
| 15, 16 | Left/Right Ankle | Ground contact / base position |
| 23, 24 (MediaPipe) / hip estimate | Hip midpoint | Fallback position (match V4) |

**YOLO hip:** Midpoint of left/right hip keypoints (indices 11, 12 in COCO).

### 5.3 Player Assignment & Tracking

Broadcast footage routinely includes ball kids, chair umpires, and line judges. Naive Z-half assignment breaks when a non-player walks onto the near side.

**Per-frame filtering pipeline:**

```
1. Detect all persons (YOLOv8-pose)
2. Project ankle midpoint → (x, z) via CourtProjector
3. COURT-BOUNDS FILTER — discard detections where:
     x ∉ [-HW, +HW]  OR  z ∉ [-HL, +HL]
   (This removes most umpires in elevated chairs and crowd-adjacent staff)
4. CONFIDENCE FILTER — discard pose detections with keypoint confidence < 0.4
5. RANK remaining by mean keypoint confidence
6. Select top-2 detections only
7. Assign by Z half:
     z > 0 → player_bottom (P1)
     z < 0 → player_top (P2)
8. If only 1 valid detection → hold previous frame's missing player position
9. If 0 valid detections → hold both previous positions (do not snap to origin)
10. Maintain identity with ByteTrack or nearest-neighbor across frames
11. Apply OneEuro filter on (x, z) before export
```

**Edge case:** Two detections on same Z half (e.g., ball kid + player both near-side) → keep highest-confidence; second slot filled from temporal hold of the missing-side player.

### 5.4 Output Format

```json
{
  "id": "player_bottom",
  "position": { "x": 0.42, "y": 0.0, "z": 10.85 }
}
```

Wrist positions stored internally for hit detection but **not exported** in V5.0 (frontend uses procedural racket on Player mesh).

---

## Phase 6 — Model Training & Fine-Tuning Pipeline

### 6.1 Directory Structure

```
backend/training/
├── README.md
├── datasets/
│   ├── tennis_ball/
│   │   ├── images/
│   │   │   ├── train/
│   │   │   ├── val/
│   │   │   └── test/
│   │   ├── labels/              # YOLO format (.txt per image)
│   │   │   ├── train/
│   │   │   ├── val/
│   │   │   └── test/
│   │   └── data.yaml            # Ultralytics dataset config
│   ├── court_lines/             # Optional segmentation masks
│   └── tracknet/
│       ├── frames/              # Sequential frame triplets
│       └── heatmaps/            # Gaussian labels
├── scripts/
│   ├── extract_frames.py        # FFmpeg frame extraction
│   ├── label_review.py          # Visual QA tool
│   ├── generate_synthetic_balls.py
│   ├── train_yolo_ball.py
│   ├── train_tracknet.py
│   └── export_onnx.py
├── configs/
│   ├── yolov8n_ball.yaml
│   └── tracknet_v2.yaml
└── notebooks/
    └── eda.ipynb
```

### 6.2 Dataset Label Format (YOLO Ball)

Each image `frame_000123.jpg` gets `frame_000123.txt`:

```
# class x_center y_center width height  (all normalized 0-1)
0 0.512 0.384 0.008 0.012
```

- Class `0` = `tennis_ball`
- For motion blur: use **elongated bbox** covering blur streak, or keypoint-only label at streak center

**data.yaml:**

```yaml
path: ../datasets/tennis_ball
train: images/train
val: images/val
test: images/test
nc: 1
names: ['tennis_ball']
```

### 6.3 Frame Extraction Script (Outline)

```python
# backend/training/scripts/extract_frames.py
# Usage: python extract_frames.py --video match.mp4 --out datasets/tennis_ball/raw --fps 30
#
# 1. FFmpeg decode at native FPS
# 2. Save every Nth frame as JPEG (quality 95)
# 3. Generate manifest.csv: frame_id, timestamp, source_video
# 4. Optional: auto-prelabel with current YOLO for human correction
```

### 6.4 YOLOv8 Fine-Tuning Commands

```bash
# Install
pip install ultralytics

# Train (from repo root)
yolo detect train \
  model=yolov8n.pt \
  data=backend/training/datasets/tennis_ball/data.yaml \
  epochs=100 \
  imgsz=1280 \
  batch=16 \
  patience=20 \
  project=backend/training/runs \
  name=ball_v1 \
  augment=hsv_v,hflip,mosaic \
  degrees=5 \
  scale=0.3

# Validate
yolo detect val \
  model=backend/training/runs/ball_v1/weights/best.pt \
  data=backend/training/datasets/tennis_ball/data.yaml

# Export for inference
yolo export model=backend/training/runs/ball_v1/weights/best.pt format=onnx
```

**Training tips:**

- Start with `yolov8n` (speed) → graduate to `yolov8s` if recall insufficient
- Heavy mosaic augmentation helps small objects
- Include motion-blur frames in training set (critical)
- Minimum dataset: 2,000 labeled frames; target: 10,000+

### 6.5 Synthetic Data Generation

```python
# backend/training/scripts/generate_synthetic_balls.py
#
# 1. Collect empty court background images (no ball)
# 2. For each background:
#    a. Random (x, y) position
#    b. Draw motion-blurred yellow circle (length ∝ simulated speed)
#    c. Add Gaussian noise, JPEG compression artifacts
#    d. Write YOLO label from blur centroid + bbox
# 3. Target ratio: 30% synthetic, 70% real (adjust based on overfitting)
```

Parameters to randomize: ball radius (3–12 px), blur angle, blur length, brightness, shadow.

### 6.6 TrackNet Training (Phase 6b)

**Do not train TrackNet from scratch.** Public pre-trained weights exist and dramatically reduce time-to-first-detection:

| Source | Weights | Use |
|--------|---------|-----|
| TrackNet (original) | [GitHub — yastrebksv/TrackNet](https://github.com/yastrebksv/TrackNet) | Tennis broadcast baseline |
| TrackNetV2 | [GitHub — yastrebksv/TrackNetV2](https://github.com/yastrebksv/TrackNetV2) | Improved temporal model |

**Recommended workflow:**

```
1. Download published TrackNet/TrackNetV2 weights
2. Verify inference on sample broadcast clip (sanity check before fine-tuning)
3. Fine-tune on custom labeled tennis footage (transfer learning, lower LR)
4. Export ONNX for optional deployment optimization
```

Separate pipeline for temporal model:

1. Label ball `(x, y)` per frame (Label Studio or CVAT)
2. Generate Gaussian heatmaps (σ = 2–4 px)
3. Build triplets `(frame[t-1], frame[t], frame[t+1]) → heatmap[t]`
4. Fine-tune from pre-trained weights with BCE loss; evaluate with F1 at 4px radius

---

## Phase 7 — Frontend 3D Resilience

### 7.1 Goals

Real CV data is noisy. The frontend must:

1. Smooth jitter without killing responsiveness
2. Bridge ball tracking gaps (≤20 frames default, configurable)
3. Never snap/teleport entities
4. Degrade gracefully when backend returns sparse data

### 7.2 Proposed Upgrades

#### A. Shared sequence preprocessor (`frontend/src/utils/sequenceSmoother.ts`)

```typescript
export function smoothSequence(raw: ProcFrameData[]): ProcFrameData[] {
  // 1. Gaussian smooth ball x,y,z (match backend/V4 kernel)
  // 2. OneEuro filter on player x,z
  // 3. Gap-fill ball: cubic Hermite spline between known frames
  // 4. Mark filled frames: is_occluded = true
}
```

Run once when sequence loads (before `setSequenceData`).

#### B. Ball.tsx — adaptive lerp

```typescript
// Increase lerp speed when is_occluded (predictive fill)
// Reduce lerp when large positional delta (noise spike rejection)
const lerpFactor = ball.is_occluded
  ? Math.min(delta * 12, 1)   // slower follow during prediction
  : Math.min(delta * 18, 1);
```

#### C. Player.tsx — jitter gate

Reject player position updates where `Δx > 2m` or `Δz > 2m` in one frame (impossible at 30 FPS). Hold previous position until next stable frame.

#### D. App.tsx — gap-aware playback

When `ball.is_occluded` for consecutive frames, optionally show subtle "predicted path" on BallTrail (dashed/dimmed).

#### E. Dual-mode toggle

Settings flag: "Server Analysis" (V5 backend) vs "Quick Preview" (V4 client). User sees label indicating data source. On GitHub Pages, V4 client mode is the default (see §Production Deployment).

---

## Proposed Tech Stack

| Layer | Technology | Version Target |
|-------|------------|----------------|
| API | FastAPI | ≥ 0.100 |
| Validation | Pydantic v2 | ≥ 2.0 |
| Server | Uvicorn | ≥ 0.23 |
| Job Queue V1 | asyncio + SQLite | stdlib + aiosqlite |
| Job Queue V2 | Celery + Redis | optional |
| Video I/O | OpenCV + FFmpeg (ffmpeg-python) | — |
| Court CV | OpenCV (Hough, homography) | ≥ 4.8 |
| Pose | Ultralytics YOLOv8-pose | ≥ 8.0 |
| Ball | TrackNet (custom) + YOLOv8n fine-tuned | — |
| Smoothing | OpenCV Kalman, scipy CubicSpline | — |
| ML Framework | PyTorch | ≥ 2.0 |
| Frontend | React 19 + Three.js + R3F | current |
| Deploy | Docker (backend), GitHub Pages (frontend) | current |

---

## Target Directory Structure

Full repo after all phases:

```
CourtSense-AI/
├── IMPLEMENTATION_MASTER_PLAN.md    ← this document
├── backend/                         ← NEW structured backend
├── courtsense_ai/                   ← legacy (deprecated after migration)
├── frontend/                        ← visualization + optional V4 fallback
├── scripts/                         ← dev utilities, demo generators
├── data/                            ← sample JSON, test videos
├── docker-compose.yml               ← backend + redis (V2)
├── Dockerfile
└── requirements.txt
```

---

## JSON Contract Specification

### Pydantic Models (backend)

```python
class Coordinate(BaseModel):
    x: float
    y: float
    z: float

class BallState(BaseModel):
    position: Coordinate
    is_occluded: bool

class PlayerState(BaseModel):
    id: Literal["player_bottom", "player_top"]
    position: Coordinate

class ProcFrameData(BaseModel):
    frame_index: int
    ball: BallState
    players: list[PlayerState] = Field(min_length=2, max_length=2)
    ball_speed_kmh: float = Field(ge=0)
    spin_rate_rpm: float = Field(ge=0)
    hitter: Literal["p1", "p2"] | None = None

class SequenceResponse(BaseModel):
    sequence: list[ProcFrameData]
```

### Validation Rules (backend export stage)

- [ ] All coordinates rounded to 3 decimal places
- [ ] `frame_index` sequential from 0
- [ ] Exactly 2 players with correct IDs
- [ ] Player `y == 0.0`
- [ ] Ball `y >= 0.08`
- [ ] P1 `z > 0`, P2 `z < 0` (soft constraint; clamp if violated)
- [ ] Frame count = `min(video_duration, 30) * 30`

---

## Execution Roadmap

### Milestone 0 — Approval Gate ⬅ CURRENT

- [ ] User reviews and approves this document (v1.1)
- [ ] User confirms V1 queue choice (asyncio + SQLite vs Celery)
- [ ] User confirms TrackNet vs YOLO-only for V5.0 ball tracking

### Milestone 1 — Backend Scaffold + Frontend Fixes (Est. 1 session)

**Environment Bootstrap (do this first):**

```
Python >= 3.10 required  (X | Y union syntax in Pydantic models)

requirements/
├── base.txt          # fastapi, uvicorn, pydantic, python-multipart, aiosqlite
├── cv.txt            # opencv-python, numpy, scipy, ffmpeg-python
├── ml-cpu.txt        # torch, torchvision, ultralytics, transformers (CPU wheels)
└── ml-gpu.txt        # torch+cu118, torchvision+cu118 (install ONLY if CUDA available)

Install:
  pip install -r requirements/base.txt -r requirements/cv.txt
  pip install -r requirements/ml-cpu.txt   # or ml-gpu.txt if nvcc present
```

Root `requirements.txt` remains a convenience meta-file pointing to `requirements/base.txt + cv.txt + ml-cpu.txt` for Hugging Face Spaces.

**Backend scaffold:**

- [ ] Create `backend/` folder structure (§2.2)
- [ ] **CORS middleware** with `localhost:5173` + `https://udayraj1238.github.io` (§2.4)
- [ ] Pydantic models mirroring `ProcFrameData`
- [ ] Job manager + SQLite persistence + **1-hour TTL cleanup** (§2.5)
- [ ] `POST /api/v2/jobs/upload`, `GET status`, `GET result`
- [ ] Stub pipeline returning mock `ProcFrameData[]`
- [ ] **`ingest.py` stub** with ffprobe duration gate + FFmpeg 30fps resample (§2.6)

**Stub regression baseline (critical):**

The Milestone 1 stub must return **byte-identical structure** to `frontend/public/demo_data.json` as produced by `scripts/generate_demo_from_video.mjs`. Run the script, commit output, load stub from that file. This enables pixel-perfect V4 vs V5 visual comparison before any real CV runs.

**Frontend (ships to live site on merge to `main`):**

- [ ] Fix `App.tsx` player mapping bug (`player_bottom` → P1) — **done in codebase**
- [ ] Extract `ProcFrameData` to `frontend/src/types/tracking.ts`
- [ ] Implement `jobPoller.ts` — 2s polling, exponential backoff after 60s (§2.7)
- [ ] Wire backend upload path behind `VITE_API_URL` feature flag
- [ ] **Default GitHub Pages build:** V4 client processing (no backend dependency)
- [ ] Verify deploy to [udayraj1238.github.io/CourtSense-AI/](https://udayraj1238.github.io/CourtSense-AI/) after merge

### Milestone 2 — Homography & CourtProjector (Est. 1–2 sessions)

- [ ] `court_lines.py` — Hough pipeline
- [ ] `CourtProjector` class with tests on sample frames
- [ ] Integration test: project known pixel → expected `(x, z)`
- [ ] **Orchestrator calibration failure path** → `calibration_failed: true` (§2.9)
- [ ] `POST /api/v2/jobs/{id}/calibrate` manual 4-corner endpoint
- [ ] Frontend 4-corner overlay UI on calibration failure

### Milestone 3 — Player Pose Pipeline (Est. 1–2 sessions)

- [ ] Upgrade to `yolov8m-pose`
- [ ] **Court-bounds + confidence filter** for non-player rejection (§5.3)
- [ ] Per-frame player assignment + OneEuro smoothing
- [ ] Export player positions in contract format
- [ ] Progress reporting for pose stage

### Milestone 4 — Ball Tracking V1 (Est. 2–3 sessions)

- [ ] HSV + fine-tuned YOLO ensemble
- [ ] 3D Kalman filter in court space
- [ ] **Parabolic Y estimation between bounces** (§4.4)
- [ ] Cubic spline gap fill
- [ ] Bounce/hit detection
- [ ] Speed analytics; **`spin_rate_rpm: 0.0` placeholder** (§4.6)

### Milestone 5 — Training Pipeline (Est. 2 sessions + user labeling time)

- [ ] `extract_frames.py`
- [ ] `generate_synthetic_balls.py`
- [ ] `data.yaml` + train script
- [ ] Document labeling workflow

### Milestone 6 — TrackNet Integration (Est. 2–3 sessions)

- [ ] **Load published TrackNet/TrackNetV2 pre-trained weights** (§6.6)
- [ ] Verify baseline inference on sample clip
- [ ] Fine-tune on custom dataset
- [ ] Fuse TrackNet + YOLO in inference

### Milestone 7 — Frontend Resilience (Est. 1 session)

- [ ] `sequenceSmoother.ts`
- [ ] Ball/Player adaptive lerp
- [ ] Dual-mode toggle UI (V4 Quick Preview vs V5 Server Analysis)
- [ ] Gap-aware BallTrail for occluded segments

### Milestone 8 — Integration & Deploy (Est. 1 session)

- [ ] End-to-end test with real broadcast clip
- [ ] Docker compose update
- [ ] Hugging Face Spaces backend deployment (synced via `.github/workflows/huggingface.yml`)
- [ ] GitHub Pages production build with `VITE_API_URL` → HF Space
- [ ] Deprecate sync V1 upload endpoint
- [ ] Smoke test on live site: demo load, upload (V4), server upload (V5 when API live)

---

## Production Deployment — GitHub Pages

**Official public URL (immutable — LinkedIn, portfolio, README):**

> [https://udayraj1238.github.io/CourtSense-AI/](https://udayraj1238.github.io/CourtSense-AI/)

All user-visible frontend changes **must** be merged to `main` and deployed via `.github/workflows/deploy.yml`. There is no alternate production URL.

### Architecture on Production

```
┌─────────────────────────────────────────────────────────────┐
│  udayraj1238.github.io/CourtSense-AI/   (static frontend) │
│  ├── Demo mode: demo_data.json (always works)               │
│  ├── Upload V4: browser MediaPipe + synthetic rally         │
│  └── Upload V5: calls Hugging Face backend API (when live)  │
└──────────────────────────┬──────────────────────────────────┘
                           │ HTTPS (CORS-enabled)
                           ▼
┌─────────────────────────────────────────────────────────────┐
│  huggingface.co/spaces/rajuday6002/courtsense-backend       │
│  FastAPI + GPU/CPU CV pipeline                              │
└─────────────────────────────────────────────────────────────┘
```

### Vite / Build Configuration

Already configured in `frontend/vite.config.ts`:

```typescript
base: '/CourtSense-AI/'   // DO NOT CHANGE — breaks all asset paths on GitHub Pages
```

### Environment Variables for CI Build

Add to `.github/workflows/deploy.yml` build step when V5 backend is live:

```yaml
- name: Build
  working-directory: frontend
  env:
    VITE_API_URL: https://rajuday6002-courtsense-backend.hf.space
  run: npm run build
```

Until V5 backend is production-ready, **omit `VITE_API_URL`** so the live site uses V4 client processing exclusively — ensuring upload/demo always works for LinkedIn visitors.

### Visibility Checklist (every milestone touching frontend)

- [ ] Changes are in `frontend/` (not backend-only unless API wiring)
- [ ] `npm run build` succeeds with `base: '/CourtSense-AI/'`
- [ ] Demo button loads `demo_data.json` from `${import.meta.env.BASE_URL}demo_data.json`
- [ ] Merged to `main` → GitHub Actions deploy completes
- [ ] Manually verify at [udayraj1238.github.io/CourtSense-AI/](https://udayraj1238.github.io/CourtSense-AI/)

### `generate_demo_from_video.mjs` — Regression Tool

**Preserve and maintain** this script. It is the fastest way to test the frontend against realistic `ProcFrameData[]` without running the full backend:

```bash
node scripts/generate_demo_from_video.mjs
# writes frontend/public/demo_data.json
```

**Policy:** Any change to the `ProcFrameData` contract must update:
1. `frontend/src/types/tracking.ts`
2. `scripts/generate_demo_from_video.mjs`
3. Backend Pydantic models
4. Re-run script and commit updated `demo_data.json`

This keeps the live demo and stub API in sync.

---

## Risk Register & Mitigations

| Risk | Severity | Mitigation |
|------|----------|------------|
| CORS blocks all API calls from GitHub Pages | **Critical** | Explicit origins in Milestone 1 (§2.4) |
| Wrong FPS corrupts frame timing | **Critical** | FFmpeg 30fps resample in ingest.py (§2.6) |
| Ball Y axis broken at launch | **High** | Parabolic arc between bounces; y=0.08 fallback (§4.4) |
| Homography silent failure | **High** | `calibration_failed` structured error + manual UI (§2.9) |
| Ball kids/umpires assigned as players | **High** | Court-bounds + confidence filter (§5.3) |
| Disk fills with temp videos | **Medium** | 1-hour job TTL + cleanup task (§2.5) |
| 30s+ video wastes GPU time | **Medium** | ffprobe reject in ingest.py before CV (§2.6) |
| Garbage spin values in UI | **Medium** | `spin_rate_rpm: 0.0` in V5.0 (§4.6) |
| Ball detection recall < 50% on broadcast | High | TrackNet pre-trained weights + fine-tune (§6.6) |
| Processing > 2 min on CPU-only | Medium | GPU worker; reduce to 720p processing |
| Player ID swap mid-rally | Medium | Z-half + temporal hold (§5.3) |
| Live site breaks after deploy | Medium | Visibility checklist (§Production Deployment) |
| Frontend regression during migration | Low | V4 client default on GitHub Pages; stub = demo_data.json |

---

## Existing Assets vs. Greenfield Work

| Asset | Action |
|-------|--------|
| `videoProcessor.ts` | **Keep** as V4 fallback (default on GitHub Pages); extract shared constants |
| `generate_demo_from_video.mjs` | **Keep & maintain** — regression baseline; update on any contract change (§Production Deployment) |
| `frontend/public/demo_data.json` | **Regenerate** from script when contract changes; stub API loads this file |
| `courtsense_ai/core/*` | **Migrate** → `backend/cv/` |
| `backend/main.py` | **Replace** with new modular app |
| `process_real_video.py` | **Refactor** into pipeline stages |
| `Court.tsx`, `TennisScene.tsx` | **Minimal changes** (Phase 7 only) |
| `Ball.tsx`, `Player.tsx` | **Enhance** smoothing (Phase 7) |
| `.github/workflows/deploy.yml` | **Primary deploy path** to udayraj1238.github.io/CourtSense-AI/ |

---

## Decisions Required From User

Before Milestone 1 implementation, please confirm:

1. **Job queue V1:** asyncio + SQLite (recommended) or Celery + Redis from day one?
2. **Ball model V5.0 priority:** Start with fine-tuned YOLO only (faster to ship) or parallel TrackNet development?
3. **GPU target:** Will development/deployment have CUDA GPU (affects model size choices)?
4. **Manual calibration fallback:** Acceptable to require 4-click court corner selection when auto-detection fails?
5. **V4 client path:** Keep browser-based processing as permanent fallback, or deprecate after V5 stabilizes?

---

## Revision History

| Version | Date | Changes |
|---------|------|---------|
| 1.0 | 2026-05-30 | Initial master plan |
| 1.1 | 2026-05-30 | CORS, FPS normalization, Y estimation, homography failure path, player filtering, job TTL, ffprobe gate, spin placeholder, TrackNet pre-trained weights, env bootstrap, polling spec, demo script policy, player bug → M1, GitHub Pages deployment section |

---

## Approval

> **Step B — User Alignment**
>
> Please review **v1.1** of this master plan and reply with **"approved"** (with any remaining corrections), or list specific changes before we begin Milestone 1.
>
> Once approved, we execute **one milestone at a time**, starting with backend scaffold + environment bootstrap. Every frontend milestone merges to `main` and deploys to [udayraj1238.github.io/CourtSense-AI/](https://udayraj1238.github.io/CourtSense-AI/).

---

*End of IMPLEMENTATION_MASTER_PLAN.md*
