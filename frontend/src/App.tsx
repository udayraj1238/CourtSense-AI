import { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import { TennisScene } from './components/TennisScene';
import {
  Play, Pause, RotateCcw, Upload, Zap, Eye, Target,
  ChevronLeft, ChevronRight, Video, Settings, X,
} from 'lucide-react';
import axios from 'axios';
import './index.css';
import './App.css';

/* ===== Types ===== */
interface Coordinate { x: number; y: number; z: number; }
interface PlayerState { id: string; position: Coordinate; }
interface BallState { position: Coordinate; is_occluded: boolean; }
interface FrameData {
  frame_index: number;
  ball: BallState | null;
  players: PlayerState[];
  ball_speed_kmh?: number;
  spin_rate_rpm?: number;
}
interface SequenceResponse { sequence: FrameData[]; }

const TRAIL_LENGTH = 20; // Number of ball trail history dots
const SPEED_OPTIONS = [0.25, 0.5, 1, 2];

/* ===== Particles Background ===== */
function Particles() {
  const particles = useMemo(() =>
    Array.from({ length: 30 }, () => ({
      left: Math.random() * 100,
      delay: Math.random() * 8,
      duration: 8 + Math.random() * 12,
      size: 1 + Math.random() * 2,
      bottom: -10 - Math.random() * 20,
    })), []
  );

  return (
    <div className="particles-container">
      {particles.map((p, i) => (
        <div
          key={i}
          className="particle"
          style={{
            left: `${p.left}%`,
            bottom: `${p.bottom}%`,
            width: `${p.size}px`,
            height: `${p.size}px`,
            animationDelay: `${p.delay}s`,
            animationDuration: `${p.duration}s`,
          }}
        />
      ))}
    </div>
  );
}

/* ===== Main App ===== */
function App() {
  const [isPlaying, setIsPlaying] = useState(false);
  const [frame, setFrame] = useState(0);
  const [sequenceData, setSequenceData] = useState<FrameData[]>([]);
  const [appState, setAppState] = useState<'idle' | 'uploading' | 'processing' | 'ready'>('idle');
  const [uploadProgress, setUploadProgress] = useState(0);
  const [speed, setSpeed] = useState(1);
  const [cameraPreset, setCameraPreset] = useState<'default' | 'overhead' | 'p1' | 'p2'>('default');
  
  const [backendUrl, setBackendUrl] = useState(() => 
    localStorage.getItem('courtsense_backend_url') || 'http://localhost:8000'
  );
  const [showSettings, setShowSettings] = useState(false);
  const [tempUrlInput, setTempUrlInput] = useState('');

  const [ballPos, setBallPos] = useState<[number, number, number]>([0, 1, 0]);
  const [p1Pos, setP1Pos] = useState<[number, number, number]>([0, 0, 10]);
  const [p2Pos, setP2Pos] = useState<[number, number, number]>([0, 0, -10]);
  const [ballSpeed, setBallSpeed] = useState(0);
  const [spinRate, setSpinRate] = useState(0);
  const [ballTrail, setBallTrail] = useState<[number, number, number][]>([]);

  const frameRef = useRef(0);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const trailRef = useRef<[number, number, number][]>([]);
  const [isDragging, setIsDragging] = useState(false);

  /* --- Data Loading --- */
  const loadDemo = () => {
    setAppState('processing');
    // Try backend first, fallback to static demo data for deployed site
    axios.get<SequenceResponse>(`${backendUrl}/api/v1/tracking/real`, { 
      timeout: 3000,
      headers: { 'Bypass-Tunnel-Reminder': 'true' }
    })
      .then(res => {
        setSequenceData(res.data.sequence);
        if (res.data.sequence.length > 0) {
          updatePositions(res.data.sequence[0]);
        }
        setAppState('ready');
      })
      .catch(() => {
        // Backend unavailable — load static demo data
        console.log("Backend unavailable, loading static demo data...");
        fetch(`${import.meta.env.BASE_URL}demo_data.json`)
          .then(r => r.json())
          .then((data: SequenceResponse) => {
            setSequenceData(data.sequence);
            if (data.sequence.length > 0) {
              updatePositions(data.sequence[0]);
            }
            setAppState('ready');
          })
          .catch(err2 => {
            console.error("Failed to load demo data:", err2);
            setAppState('idle');
            alert("Failed to load demo data. Make sure the backend is running or demo_data.json exists.");
          });
      });
  };

  const handleFileUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    if (!e.target.files || e.target.files.length === 0) return;
    const file = e.target.files[0];
    if (!file.type.startsWith('video/')) {
      alert("Please select a valid video file.");
      return;
    }

    setAppState('uploading');
    setUploadProgress(0);

    const formData = new FormData();
    formData.append('file', file);

    try {
      const res = await axios.post<SequenceResponse>(`${backendUrl}/api/v1/tracking/upload`, formData, {
        headers: { 
          'Content-Type': 'multipart/form-data',
          'Bypass-Tunnel-Reminder': 'true'
        },
        onUploadProgress: (progressEvent) => {
          const percentCompleted = Math.round((progressEvent.loaded * 100) / (progressEvent.total || 1));
          setUploadProgress(percentCompleted);
          if (percentCompleted === 100) {
            setAppState('processing');
          }
        }
      });

      setSequenceData(res.data.sequence);
      if (res.data.sequence.length > 0) {
        updatePositions(res.data.sequence[0]);
      }
      setAppState('ready');
    } catch (err) {
      console.error("Failed to upload and process video:", err);
      alert("Failed to process the video. See console for details.");
      setAppState('idle');
    }

    if (fileInputRef.current) fileInputRef.current.value = '';
  };

  /* --- Drag and Drop --- */
  const handleDragOver = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(true);
  }, []);

  const handleDragLeave = useCallback(() => {
    setIsDragging(false);
  }, []);

  const handleDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(false);
    const files = e.dataTransfer.files;
    if (files.length > 0) {
      const file = files[0];
      if (file.type.startsWith('video/')) {
        // Trigger the same upload flow
        const dataTransfer = new DataTransfer();
        dataTransfer.items.add(file);
        if (fileInputRef.current) {
          fileInputRef.current.files = dataTransfer.files;
          fileInputRef.current.dispatchEvent(new Event('change', { bubbles: true }));
        }
      } else {
        alert("Please drop a video file.");
      }
    }
  }, []);

  /* --- Position Updates --- */
  const updatePositions = useCallback((frameData: FrameData) => {
    if (frameData.ball) {
      const newPos: [number, number, number] = [
        frameData.ball.position.x,
        frameData.ball.position.y,
        frameData.ball.position.z,
      ];
      setBallPos(newPos);

      // Update trail
      trailRef.current = [...trailRef.current.slice(-(TRAIL_LENGTH - 1)), newPos];
      setBallTrail([...trailRef.current]);
    }
    for (const player of frameData.players) {
      const pos: [number, number, number] = [player.position.x, player.position.y, player.position.z];
      if (player.id.includes('top')) {
        setP1Pos(pos); // top player is P1 (the far player)
      } else if (player.id.includes('bottom')) {
        setP2Pos(pos); // bottom player is P2 (near)  
      }
    }
    if (frameData.ball_speed_kmh !== undefined) setBallSpeed(frameData.ball_speed_kmh);
    if (frameData.spin_rate_rpm !== undefined) setSpinRate(frameData.spin_rate_rpm);
  }, []);

  /* --- Animation Loop --- */
  useEffect(() => {
    let animationFrameId: number;
    let lastTime = performance.now();
    const baseFps = 30;

    const renderLoop = (time: number) => {
      if (isPlaying && sequenceData.length > 0 && appState === 'ready') {
        const frameInterval = 1000 / (baseFps * speed);
        const deltaTime = time - lastTime;

        if (deltaTime >= frameInterval) {
          let nextFrame = frameRef.current + 1;
          if (nextFrame >= sequenceData.length) {
            nextFrame = 0;
            // Reset trail on loop
            trailRef.current = [];
          }
          frameRef.current = nextFrame;
          setFrame(nextFrame);
          updatePositions(sequenceData[nextFrame]);
          lastTime = time - (deltaTime % frameInterval);
        }
      }
      animationFrameId = requestAnimationFrame(renderLoop);
    };

    if (isPlaying && appState === 'ready') {
      animationFrameId = requestAnimationFrame(renderLoop);
    }

    return () => {
      if (animationFrameId) cancelAnimationFrame(animationFrameId);
    };
  }, [isPlaying, sequenceData, appState, speed, updatePositions]);

  /* --- Keyboard Shortcuts --- */
  useEffect(() => {
    if (appState !== 'ready') return;

    const handleKeyDown = (e: KeyboardEvent) => {
      // Don't capture when typing in inputs
      if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) return;

      switch (e.code) {
        case 'Space':
          e.preventDefault();
          setIsPlaying(prev => !prev);
          break;
        case 'ArrowRight':
          e.preventDefault();
          if (sequenceData.length > 0) {
            setIsPlaying(false);
            const next = Math.min(frameRef.current + 1, sequenceData.length - 1);
            frameRef.current = next;
            setFrame(next);
            updatePositions(sequenceData[next]);
          }
          break;
        case 'ArrowLeft':
          e.preventDefault();
          if (sequenceData.length > 0) {
            setIsPlaying(false);
            const prev = Math.max(frameRef.current - 1, 0);
            frameRef.current = prev;
            setFrame(prev);
            updatePositions(sequenceData[prev]);
          }
          break;
        case 'KeyR':
          resetSimulation();
          break;
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [appState, sequenceData, updatePositions]);

  /* --- Controls --- */
  const togglePlay = () => setIsPlaying(!isPlaying);

  const resetSimulation = () => {
    setIsPlaying(false);
    frameRef.current = 0;
    setFrame(0);
    trailRef.current = [];
    setBallTrail([]);
    if (sequenceData.length > 0) {
      updatePositions(sequenceData[0]);
    }
  };

  const seekToFrame = (targetFrame: number) => {
    const clamped = Math.max(0, Math.min(targetFrame, sequenceData.length - 1));
    frameRef.current = clamped;
    setFrame(clamped);
    // Rebuild trail up to this point
    const trailStart = Math.max(0, clamped - TRAIL_LENGTH);
    const newTrail: [number, number, number][] = [];
    for (let i = trailStart; i <= clamped; i++) {
      const fd = sequenceData[i];
      if (fd.ball) {
        newTrail.push([fd.ball.position.x, fd.ball.position.y, fd.ball.position.z]);
      }
    }
    trailRef.current = newTrail;
    setBallTrail([...newTrail]);
    updatePositions(sequenceData[clamped]);
  };

  const handleTimelineClick = (e: React.MouseEvent<HTMLDivElement>) => {
    if (sequenceData.length === 0) return;
    const rect = e.currentTarget.getBoundingClientRect();
    const pct = Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width));
    const targetFrame = Math.round(pct * (sequenceData.length - 1));
    seekToFrame(targetFrame);
  };

  const totalFrames = sequenceData.length || 1;
  const progress = (frame / totalFrames) * 100;

  /* ============================
   *   LANDING PAGE
   * ============================ */
  if (appState !== 'ready') {
    return (
      <div
        className="landing-page"
        onDragOver={handleDragOver}
        onDragLeave={handleDragLeave}
        onDrop={handleDrop}
      >
        {/* Top Right Settings Button */}
        <button 
          className="settings-toggle-btn glass"
          onClick={() => { setTempUrlInput(backendUrl); setShowSettings(true); }}
        >
          <Settings size={20} />
        </button>

        {/* Settings Modal */}
        {showSettings && (
          <div className="settings-modal-overlay">
            <div className="settings-modal glass-heavy">
              <button className="settings-close" onClick={() => setShowSettings(false)}>
                <X size={20} />
              </button>
              <h2>Backend Configuration</h2>
              <p>Enter your local Fast API backend URL or Google Colab online URL to process new videos:</p>
              <input 
                type="text" 
                value={tempUrlInput}
                onChange={(e) => setTempUrlInput(e.target.value)}
                placeholder="https://your-localtunnel-url.loca.lt"
                className="url-input"
              />
              <button 
                className="save-url-btn"
                onClick={() => {
                  let cleanUrl = tempUrlInput.trim();
                  if(cleanUrl.endsWith('/')) cleanUrl = cleanUrl.slice(0, -1);
                  setBackendUrl(cleanUrl);
                  localStorage.setItem('courtsense_backend_url', cleanUrl);
                  setShowSettings(false);
                }}
              >
                Save URL
              </button>
              
              <div style={{ marginTop: '20px', fontSize: '13px', color: 'var(--text-muted)' }}>
                <p><strong>Free Online Processing:</strong></p>
                <a href="https://colab.research.google.com/github/udayraj1238/CourtSense-AI/blob/main/colab_backend.ipynb" target="_blank" rel="noreferrer" style={{ color: 'var(--accent)', textDecoration: 'underline' }}>
                  Run our free Google Colab backend
                </a> and paste the link here!
              </div>
            </div>
          </div>
        )}

        {/* Background Effects */}
        <div className="landing-grid" />
        <div className="landing-glow" />
        <Particles />

        {/* Drag overlay */}
        {isDragging && (
          <div style={{
            position: 'absolute',
            inset: 0,
            zIndex: 50,
            background: 'rgba(163, 230, 53, 0.05)',
            border: '2px dashed rgba(163, 230, 53, 0.3)',
            borderRadius: '24px',
            margin: '20px',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            backdropFilter: 'blur(4px)',
          }}>
            <div style={{
              fontSize: '24px',
              fontWeight: 700,
              color: 'var(--accent)',
            }}>
              Drop your video here
            </div>
          </div>
        )}

        <div className="landing-content">
          {/* Badge */}
          <div className="badge animate-in" style={{ animationDelay: '0.1s' }}>
            <span className="badge-dot" />
            CourtSense AI v2
          </div>

          {/* Hero Title */}
          <h1 className="hero-title animate-in" style={{ animationDelay: '0.2s' }}>
            <span className="text-gradient">Witness the Magic</span>
            <br />
            <span style={{ color: 'var(--text-primary)' }}>of Every Rally.</span>
          </h1>

          {/* Subtitle */}
          <p className="hero-subtitle animate-in-delayed">
            Upload any tennis match video and watch our AI transform it into a
            stunning 3D replay with real-time ball tracking, player analytics,
            and physics visualization.
          </p>

          {/* Feature Cards */}
          <div className="features-row animate-in-delayed-2">
            <div className="feature-card">
              <div className="feature-card-icon" style={{ background: 'rgba(163, 230, 53, 0.1)', color: 'var(--accent)' }}>
                <Eye size={20} />
              </div>
              <span className="feature-card-label">3D Replay</span>
            </div>
            <div className="feature-card">
              <div className="feature-card-icon" style={{ background: 'rgba(34, 211, 238, 0.1)', color: 'var(--cyan)' }}>
                <Zap size={20} />
              </div>
              <span className="feature-card-label">Ball Physics</span>
            </div>
            <div className="feature-card">
              <div className="feature-card-icon" style={{ background: 'rgba(168, 85, 247, 0.1)', color: '#a855f7' }}>
                <Target size={20} />
              </div>
              <span className="feature-card-label">AI Analytics</span>
            </div>
          </div>

          {/* Upload / Status */}
          {appState === 'idle' && (
            <div className="animate-in-delayed-3" style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
              <input
                type="file"
                accept="video/mp4,video/quicktime,video/webm"
                className="hidden"
                ref={fileInputRef}
                onChange={handleFileUpload}
                style={{ display: 'none' }}
              />
              <button
                onClick={() => fileInputRef.current?.click()}
                className="upload-btn"
              >
                <Upload size={20} />
                Select Video to Analyze
              </button>
              <button onClick={loadDemo} className="demo-btn">
                Or load pre-generated demo data →
              </button>
            </div>
          )}

          {appState === 'uploading' && (
            <div className="status-card animate-scale-in">
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '16px' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
                  <Upload size={20} style={{ color: 'var(--accent)', animation: 'float 1.5s ease-in-out infinite' }} />
                  <span style={{ fontWeight: 600, fontSize: '16px' }}>Uploading Video...</span>
                </div>
                <span style={{ fontFamily: 'var(--font-mono)', color: 'var(--accent)', fontSize: '20px', fontWeight: 700 }}>
                  {uploadProgress}%
                </span>
              </div>
              <div className="progress-bar-container">
                <div className="progress-bar-fill" style={{ width: `${uploadProgress}%` }} />
              </div>
            </div>
          )}

          {appState === 'processing' && (
            <div className="status-card animate-scale-in" style={{ textAlign: 'center' }}>
              <div className="spinner-ring">
                <div className="spinner-ring-track" />
                <div className="spinner-ring-fill" />
              </div>
              <h3 style={{ fontSize: '20px', fontWeight: 700, marginBottom: '8px' }}>
                Analyzing Geometry & Biometrics
              </h3>
              <p style={{ color: 'var(--text-muted)', fontSize: '14px', margin: 0 }}>
                Running YOLOv8-Pose and Trajectory Physics Pipeline...
              </p>
              <p style={{ color: 'rgba(163, 230, 53, 0.4)', fontSize: '12px', marginTop: '16px', animation: 'pulse-glow 2s ease infinite' }}>
                This usually takes several minutes on CPU.
              </p>
            </div>
          )}
        </div>
      </div>
    );
  }

  /* ============================
   *   3D VIEWER PAGE
   * ============================ */
  return (
    <div className="viewer-page">
      {/* --- Header --- */}
      <header className="viewer-header">
        {/* Brand */}
        <div className="glass brand-pill">
          <div className="brand-name">CourtSense AI</div>
          <div className="brand-sub">3D Tennis Analytics</div>
        </div>

        {/* Stats Panel */}
        <div className="glass stats-panel">
          <div className="stat-item">
            <span className="stat-label">Speed</span>
            <span className="stat-value" style={{ color: 'var(--accent)' }}>
              {ballSpeed.toFixed(0)}
            </span>
            <span className="stat-unit">km/h</span>
          </div>
          <div className="stat-divider" />
          <div className="stat-item">
            <span className="stat-label">Spin</span>
            <span className="stat-value" style={{ color: 'var(--cyan)' }}>
              {spinRate.toFixed(0)}
            </span>
            <span className="stat-unit">rpm</span>
          </div>
          <div className="stat-divider" />
          <div className="stat-item">
            <span className="stat-label">Frame</span>
            <span className="stat-value" style={{ color: 'var(--text-secondary)', fontSize: '16px' }}>
              {frame.toString().padStart(4, '0')}
            </span>
            <span className="stat-unit">/ {totalFrames}</span>
          </div>
        </div>
      </header>

      {/* --- Camera Presets (right side) --- */}
      <div className="camera-presets">
        {[
          { id: 'default' as const, label: 'TV' },
          { id: 'overhead' as const, label: 'TOP' },
          { id: 'p1' as const, label: 'P1' },
          { id: 'p2' as const, label: 'P2' },
        ].map(cam => (
          <button
            key={cam.id}
            className={`camera-btn ${cameraPreset === cam.id ? 'active' : ''}`}
            onClick={() => setCameraPreset(cam.id)}
            title={`Camera: ${cam.label}`}
          >
            {cam.label}
          </button>
        ))}
      </div>

      {/* --- 3D Canvas --- */}
      <main style={{ flex: 1 }}>
        <TennisScene
          ballPos={ballPos}
          player1Pos={p1Pos}
          player2Pos={p2Pos}
          ballTrail={ballTrail}
          cameraPreset={cameraPreset}
        />
      </main>

      {/* --- Keyboard Hints --- */}
      <div className="keyboard-hint">
        <span className="kbd">Space</span>
        <span className="hint-text">Play/Pause</span>
        <span className="kbd">←</span>
        <span className="kbd">→</span>
        <span className="hint-text">Frame Step</span>
        <span className="kbd">R</span>
        <span className="hint-text">Reset</span>
      </div>

      {/* --- Footer Controls --- */}
      <footer className="viewer-footer">
        {/* Action buttons */}
        <div className="footer-actions">
          <button
            className="action-btn"
            onClick={() => {
              setAppState('idle');
              setSequenceData([]);
              setIsPlaying(false);
              trailRef.current = [];
              setBallTrail([]);
            }}
          >
            <Video size={14} />
            New Video
          </button>
        </div>

        {/* Main controls bar */}
        <div className="glass-heavy controls-bar">
          {/* Timeline */}
          <div className="timeline-container" onClick={handleTimelineClick}>
            <div className="timeline-fill" style={{ width: `${progress}%` }} />
          </div>

          {/* Controls Row */}
          <div className="controls-row">
            <div className="controls-left">
              {/* Reset */}
              <button className="control-icon-btn" onClick={resetSimulation} title="Reset (R)">
                <RotateCcw size={16} />
              </button>

              {/* Step backward */}
              <button
                className="control-icon-btn"
                onClick={() => {
                  if (sequenceData.length > 0) {
                    setIsPlaying(false);
                    const prev = Math.max(frameRef.current - 1, 0);
                    seekToFrame(prev);
                  }
                }}
                title="Previous frame (←)"
              >
                <ChevronLeft size={18} />
              </button>

              {/* Play/Pause */}
              <button className="play-btn" onClick={togglePlay} title="Play/Pause (Space)">
                {isPlaying
                  ? <Pause size={18} fill="currentColor" />
                  : <Play size={18} fill="currentColor" />
                }
              </button>

              {/* Step forward */}
              <button
                className="control-icon-btn"
                onClick={() => {
                  if (sequenceData.length > 0) {
                    setIsPlaying(false);
                    const next = Math.min(frameRef.current + 1, sequenceData.length - 1);
                    seekToFrame(next);
                  }
                }}
                title="Next frame (→)"
              >
                <ChevronRight size={18} />
              </button>
            </div>

            <div className="controls-right">
              {/* Speed Selector */}
              <div className="speed-selector">
                {SPEED_OPTIONS.map(s => (
                  <button
                    key={s}
                    className={`speed-option ${speed === s ? 'active' : ''}`}
                    onClick={() => setSpeed(s)}
                  >
                    {s}×
                  </button>
                ))}
              </div>

              {/* Frame counter */}
              <span className="frame-counter">
                {frame.toString().padStart(4, '0')}
                <span className="frame-counter-dim"> / {totalFrames}</span>
              </span>
            </div>
          </div>
        </div>
      </footer>
    </div>
  );
}

export default App;
