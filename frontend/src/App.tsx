import { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import { TennisScene } from './components/TennisScene';
import { ToastContainer, useToast } from './components/Toast';
import { AnalyticsSidebar } from './components/AnalyticsSidebar';
import { HeatmapOverlay } from './components/HeatmapOverlay';
import { processVideoFile } from './utils/videoProcessor';
import {
  Play, Pause, RotateCcw, Upload, Zap, Eye, Target,
  ChevronLeft, ChevronRight, Video, Map,
} from 'lucide-react';
import './index.css';
import './App.css';

interface Coordinate { x: number; y: number; z: number; }
interface PlayerState { id: string; position: Coordinate; }
interface BallState { position: Coordinate; is_occluded: boolean; }
interface FrameData {
  frame_index: number;
  ball: BallState | null;
  players: PlayerState[];
  ball_speed_kmh?: number;
  spin_rate_rpm?: number;
  hitter?: 'p1' | 'p2' | null;
}
interface SequenceResponse { sequence: FrameData[]; }

const TRAIL_LENGTH = 24;
const SPEED_OPTIONS = [0.25, 0.5, 1, 2];

const PROCESSING_STEPS = [
  'Loading video',
  'Detecting court',
  'Tracking ball',
  'Tracking players',
  'Building 3D replay',
];

function Particles() {
  const particles = useMemo(() =>
    Array.from({ length: 35 }, () => ({
      left: Math.random() * 100,
      delay: Math.random() * 10,
      duration: 9 + Math.random() * 14,
      size: 1 + Math.random() * 2,
      bottom: -10 - Math.random() * 20,
    })), []
  );
  return (
    <div className="particles-container">
      {particles.map((p, i) => (
        <div key={i} className="particle" style={{
          left: `${p.left}%`, bottom: `${p.bottom}%`,
          width: `${p.size}px`, height: `${p.size}px`,
          animationDelay: `${p.delay}s`, animationDuration: `${p.duration}s`,
        }} />
      ))}
    </div>
  );
}

function App() {
  const [isPlaying, setIsPlaying] = useState(false);
  const [frame, setFrame] = useState(0);
  const [sequenceData, setSequenceData] = useState<FrameData[]>([]);
  const [appState, setAppState] = useState<'idle' | 'processing' | 'ready'>('idle');
  const [speed, setSpeed] = useState(1);
  const [cameraPreset, setCameraPreset] = useState<'default' | 'overhead' | 'p1' | 'p2'>('default');
  const [showHeatmap, setShowHeatmap] = useState(false);
  const [processingStep, setProcessingStep] = useState(0);


  const [ballPos, setBallPos] = useState<[number, number, number]>([0, 1, 0]);
  const [p1Pos, setP1Pos] = useState<[number, number, number]>([0, 0, 10]);
  const [p2Pos, setP2Pos] = useState<[number, number, number]>([0, 0, -10]);
  const [ballSpeed, setBallSpeed] = useState(0);
  const [spinRate, setSpinRate] = useState(0);
  const [ballTrail, setBallTrail] = useState<[number, number, number][]>([]);
  const [heatmapData, setHeatmapData] = useState<[number, number][]>([]);
  const [p1Hitting, setP1Hitting] = useState(false);
  const [p2Hitting, setP2Hitting] = useState(false);
  const hittingTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Client-side processing progress
  const [processingLabel, setProcessingLabel] = useState('');
  const [processingPct, setProcessingPct] = useState(0);

  const frameRef = useRef(0);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const trailRef = useRef<[number, number, number][]>([]);
  const heatRef = useRef<[number, number][]>([]);
  const [isDragging, setIsDragging] = useState(false);
  const timelineRef = useRef<HTMLDivElement>(null);
  const isDraggingTimeline = useRef(false);

  const { toasts, addToast, dismiss } = useToast();

  /* --- Position Updates (declared first — referenced by loadDemo & handleFileUpload) --- */
  const updatePositions = useCallback((fd: FrameData) => {
    if (fd.ball) {
      const np: [number, number, number] = [fd.ball.position.x, fd.ball.position.y, fd.ball.position.z];
      setBallPos(np);
      trailRef.current = [...trailRef.current.slice(-15), np];
      setBallTrail(trailRef.current.slice());
      if (heatRef.current.length === 0 || Math.random() > 0.67) {
        heatRef.current = [...heatRef.current, [np[0], np[2]]];
        setHeatmapData(heatRef.current.slice());
      }
    }
    let newP1: [number,number,number] | null = null;
    let newP2: [number,number,number] | null = null;
    for (const player of fd.players) {
      const pos: [number, number, number] = [player.position.x, player.position.y, player.position.z];
      if (player.id.includes('top')) newP1 = pos;
      else if (player.id.includes('bottom')) newP2 = pos;
    }
    if (newP1) setP1Pos(newP1);
    if (newP2) setP2Pos(newP2);
    if (fd.ball_speed_kmh !== undefined) setBallSpeed(fd.ball_speed_kmh);
    if (fd.spin_rate_rpm !== undefined) setSpinRate(fd.spin_rate_rpm);
    if (fd.hitter) {
      if (hittingTimerRef.current) clearTimeout(hittingTimerRef.current);
      if (fd.hitter === 'p1') { setP1Hitting(true); setP2Hitting(false); }
      else { setP2Hitting(true); setP1Hitting(false); }
      hittingTimerRef.current = setTimeout(() => { setP1Hitting(false); setP2Hitting(false); }, 250);
    }
  }, []);

  /* --- Demo loads static JSON — no backend needed --- */
  const loadDemo = useCallback(() => {
    setAppState('processing');
    setProcessingLabel('Loading demo data…');
    setProcessingPct(10);
    fetch(`${import.meta.env.BASE_URL}demo_data.json`)
      .then(r => { if (!r.ok) throw new Error(`HTTP ${r.status}`); return r.json(); })
      .then((data: SequenceResponse) => {
        setSequenceData(data.sequence);
        heatRef.current = []; trailRef.current = [];
        frameRef.current = 0; setFrame(0);
        setBallTrail([]); setHeatmapData([]);
        if (data.sequence.length > 0) updatePositions(data.sequence[0]);
        setAppState('ready'); setIsPlaying(true);
        addToast(`Demo loaded — ${data.sequence.length} frames!`, 'success');
      })
      .catch(err => {
        setAppState('idle');
        addToast('Could not load demo_data.json.', 'error', 5000);
        console.error(err);
      });
  }, [updatePositions, addToast]);

  /* --- Client-side video processing --- */
  const handleFileUpload = useCallback(async (e: React.ChangeEvent<HTMLInputElement>) => {
    if (!e.target.files || e.target.files.length === 0) return;
    const file = e.target.files[0];
    if (!file.type.startsWith('video/')) {
      addToast('Please select a valid video file (mp4, mov, webm).', 'warning');
      return;
    }
    setAppState('processing');
    setProcessingLabel('Loading video…');
    setProcessingPct(0);
    heatRef.current = [];
    trailRef.current = [];
    frameRef.current = 0;
    setFrame(0);
    setBallTrail([]);
    setHeatmapData([]);
    try {
      const result = await processVideoFile(file, (step, pct) => {
        setProcessingLabel(step);
        setProcessingPct(pct);
        // Advance processing step indicator based on pct
        const stepIdx = Math.min(Math.floor(pct / 20), PROCESSING_STEPS.length - 1);
        setProcessingStep(stepIdx);
      });
      setSequenceData(result.sequence as FrameData[]);
      if (result.sequence.length > 0) updatePositions(result.sequence[0] as FrameData);
      setAppState('ready');
      setIsPlaying(true);
      addToast(`Analysis complete — ${result.sequence.length} frames tracked!`, 'success');
    } catch (err) {
      console.error('Processing error:', err);
      setAppState('idle');
      addToast(`Processing failed: ${err instanceof Error ? err.message : 'Unknown error'}`, 'error', 8000);
    }
    if (fileInputRef.current) fileInputRef.current.value = '';
  }, [addToast, updatePositions]);

  /* --- Drag and Drop --- */
  const handleDragOver = useCallback((e: React.DragEvent) => { e.preventDefault(); setIsDragging(true); }, []);
  const handleDragLeave = useCallback(() => setIsDragging(false), []);
  const handleDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault(); setIsDragging(false);
    const file = e.dataTransfer.files[0];
    if (!file?.type.startsWith('video/')) { addToast('Please drop a video file.', 'warning'); return; }
    const dt = new DataTransfer(); dt.items.add(file);
    if (fileInputRef.current) { fileInputRef.current.files = dt.files; fileInputRef.current.dispatchEvent(new Event('change', { bubbles: true })); }
  }, [addToast]);




  /* --- Animation Loop --- */
  useEffect(() => {
    let rafId: number;
    let lastTime = performance.now();
    const baseFps = 30;
    const loop = (time: number) => {
      if (isPlaying && sequenceData.length > 0 && appState === 'ready') {
        const interval = 1000 / (baseFps * speed);
        const dt = time - lastTime;
        if (dt >= interval) {
          let next = frameRef.current + 1;
          if (next >= sequenceData.length) { next = 0; trailRef.current = []; }
          frameRef.current = next;
          setFrame(next);
          updatePositions(sequenceData[next]);
          lastTime = time - (dt % interval);
        }
      }
      rafId = requestAnimationFrame(loop);
    };
    if (isPlaying && appState === 'ready') rafId = requestAnimationFrame(loop);
    return () => { if (rafId) cancelAnimationFrame(rafId); };
  }, [isPlaying, sequenceData, appState, speed, updatePositions]);

  /* --- Keyboard --- */
  useEffect(() => {
    if (appState !== 'ready') return;
    const onKey = (e: KeyboardEvent) => {
      if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) return;
      switch (e.code) {
        case 'Space': e.preventDefault(); setIsPlaying(p => !p); break;
        case 'ArrowRight': e.preventDefault(); if (sequenceData.length > 0) { setIsPlaying(false); const n = Math.min(frameRef.current + 1, sequenceData.length - 1); seekToFrame(n); } break;
        case 'ArrowLeft': e.preventDefault(); if (sequenceData.length > 0) { setIsPlaying(false); const p = Math.max(frameRef.current - 1, 0); seekToFrame(p); } break;
        case 'KeyR': resetSimulation(); break;
        case 'KeyH': setShowHeatmap(h => !h); break;
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [appState, sequenceData]);

  /* --- Controls --- */
  const resetSimulation = () => {
    setIsPlaying(false);
    frameRef.current = 0; setFrame(0);
    trailRef.current = []; setBallTrail([]);
    heatRef.current = []; setHeatmapData([]);
    if (sequenceData.length > 0) updatePositions(sequenceData[0]);
  };

  const seekToFrame = (target: number) => {
    const c = Math.max(0, Math.min(target, sequenceData.length - 1));
    frameRef.current = c; setFrame(c);
    const start = Math.max(0, c - TRAIL_LENGTH);
    const trail: [number, number, number][] = [];
    for (let i = start; i <= c; i++) { const fd = sequenceData[i]; if (fd.ball) trail.push([fd.ball.position.x, fd.ball.position.y, fd.ball.position.z]); }
    trailRef.current = trail; setBallTrail([...trail]);
    updatePositions(sequenceData[c]);
  };

  /* --- Timeline drag --- */
  const getFrameFromEvent = (e: MouseEvent | React.MouseEvent) => {
    const el = timelineRef.current;
    if (!el || sequenceData.length === 0) return null;
    const rect = el.getBoundingClientRect();
    const pct = Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width));
    return Math.round(pct * (sequenceData.length - 1));
  };

  const handleTimelineMouseDown = (e: React.MouseEvent<HTMLDivElement>) => {
    isDraggingTimeline.current = true;
    const f = getFrameFromEvent(e);
    if (f !== null) seekToFrame(f);
  };

  useEffect(() => {
    const onMove = (e: MouseEvent) => { if (!isDraggingTimeline.current) return; const f = getFrameFromEvent(e); if (f !== null) seekToFrame(f); };
    const onUp = () => { isDraggingTimeline.current = false; };
    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', onUp);
    return () => { window.removeEventListener('mousemove', onMove); window.removeEventListener('mouseup', onUp); };
  }, [sequenceData]);

  const totalFrames = sequenceData.length || 1;
  const progress = (frame / totalFrames) * 100;

  /* ==== LANDING PAGE ==== */
  if (appState !== 'ready') {
    return (
      <div className="landing-page" onDragOver={handleDragOver} onDragLeave={handleDragLeave} onDrop={handleDrop}>

        <div className="landing-grid" />
        <div className="landing-glow" />
        <Particles />

        {isDragging && (
          <div className="drag-overlay">
            <div className="drag-overlay-text">⬇ Drop video here</div>
          </div>
        )}

        <div className="landing-content">
          <div className="badge animate-in" style={{ animationDelay: '0.05s' }}>
            <span className="badge-dot" />
            CourtSense AI v2
          </div>

          <h1 className="hero-title animate-in" style={{ animationDelay: '0.15s' }}>
            <span className="text-gradient">Witness the Magic</span>
            <br />
            <span style={{ color: 'var(--text-primary)' }}>of Every Rally.</span>
          </h1>

          <p className="hero-subtitle animate-in-delayed">
            Upload any tennis match video and watch our AI transform it into a
            stunning 3D replay with real-time ball tracking, player analytics,
            and physics visualization.
          </p>

          <div className="features-row animate-in-delayed-2">
            <div className="feature-pill">
              <div className="feature-pill-icon" style={{ background: 'rgba(163,230,53,0.12)', color: 'var(--accent)' }}>
                <Eye size={16} />
              </div>
              <div className="feature-pill-text">
                <span className="feature-pill-label">3D Replay</span>
                <span className="feature-pill-desc">Cinematic angles</span>
              </div>
            </div>
            <div className="feature-pill">
              <div className="feature-pill-icon" style={{ background: 'rgba(34,211,238,0.12)', color: 'var(--cyan)' }}>
                <Zap size={16} />
              </div>
              <div className="feature-pill-text">
                <span className="feature-pill-label">Ball Physics</span>
                <span className="feature-pill-desc">Speed & spin</span>
              </div>
            </div>
            <div className="feature-pill">
              <div className="feature-pill-icon" style={{ background: 'rgba(139,92,246,0.12)', color: 'var(--violet)' }}>
                <Target size={16} />
              </div>
              <div className="feature-pill-text">
                <span className="feature-pill-label">AI Analytics</span>
                <span className="feature-pill-desc">YOLOv8 powered</span>
              </div>
            </div>
          </div>

          {appState === 'idle' && (
            <div className="animate-in-delayed-3" style={{ display: 'flex', flexDirection: 'column', gap: '14px' }}>
              <input type="file" accept="video/mp4,video/quicktime,video/webm" ref={fileInputRef} onChange={handleFileUpload} style={{ display: 'none' }} />

              {/* Upload button */}
              <button onClick={() => fileInputRef.current?.click()} className="upload-btn">
                <Upload size={18} />
                Select Your Tennis Video
              </button>
              <div style={{ fontSize: '11px', color: 'var(--text-muted)', textAlign: 'center', lineHeight: 1.5 }}>
                ✨ Analysed entirely in your browser — no server, no upload
              </div>

              {/* Divider */}
              <div style={{ display: 'flex', alignItems: 'center', gap: '10px', margin: '2px 0' }}>
                <div style={{ flex: 1, height: '1px', background: 'var(--border-subtle)' }} />
                <span style={{ fontSize: '11px', color: 'var(--text-muted)', fontWeight: 600, letterSpacing: '0.06em' }}>OR WATCH THE DEMO</span>
                <div style={{ flex: 1, height: '1px', background: 'var(--border-subtle)' }} />
              </div>

              {/* Demo video card */}
              <button onClick={loadDemo} className="demo-video-card" style={{
                position: 'relative', width: '100%', borderRadius: '16px',
                overflow: 'hidden', border: '1px solid rgba(163,230,53,0.25)',
                background: 'rgba(0,0,0,0.5)', cursor: 'pointer', padding: 0,
                display: 'block', textAlign: 'left',
              }}>
                {/* Video thumbnail strip */}
                <div style={{ position: 'relative', height: '110px', overflow: 'hidden' }}>
                  <video
                    src={`${import.meta.env.BASE_URL}demo_video.mp4`}
                    autoPlay muted loop playsInline
                    style={{ width: '100%', height: '160px', objectFit: 'cover', objectPosition: 'center 30%',
                      filter: 'brightness(0.65) saturate(1.2)', marginTop: '-25px' }}
                  />
                  {/* Gradient overlay */}
                  <div style={{ position: 'absolute', inset: 0,
                    background: 'linear-gradient(to bottom, rgba(0,0,0,0) 40%, rgba(6,6,10,0.95) 100%)' }} />
                  {/* Play badge */}
                  <div style={{
                    position: 'absolute', top: '10px', right: '10px',
                    background: 'rgba(163,230,53,0.9)', borderRadius: '999px',
                    padding: '3px 10px', fontSize: '10px', fontWeight: 800,
                    color: '#000', letterSpacing: '0.05em',
                  }}>▶ 3D REPLAY</div>
                  {/* Duration */}
                  <div style={{
                    position: 'absolute', bottom: '10px', right: '10px',
                    background: 'rgba(0,0,0,0.7)', borderRadius: '6px',
                    padding: '2px 7px', fontSize: '10px', color: 'var(--text-secondary)',
                    fontFamily: 'var(--font-mono)',
                  }}>0:28</div>
                </div>
                {/* Card text */}
                <div style={{ padding: '10px 14px 12px' }}>
                  <div style={{ fontSize: '13px', fontWeight: 800, color: 'var(--text-primary)', marginBottom: '3px', letterSpacing: '-0.01em' }}>
                    Djokovic vs Nadal — Epic Rally
                  </div>
                  <div style={{ fontSize: '11px', color: 'var(--text-muted)' }}>
                    70 shots · 200 km/h peak · 28 seconds · Clay court
                  </div>
                </div>
              </button>
            </div>
          )}




          {appState === 'processing' && (
            <div className="status-card animate-scale-in" style={{ textAlign: 'center' }}>
              <div className="spinner-ring">
                <div className="spinner-ring-track" />
                <div className="spinner-ring-fill" />
                <div className="spinner-ring-fill-2" />
              </div>
              <h3 style={{ fontSize: '18px', fontWeight: 800, marginBottom: '6px', letterSpacing: '-0.02em' }}>
                Analysing Your Video
              </h3>
              <p style={{ color: 'var(--text-muted)', fontSize: '13px', margin: '0 0 16px' }}>
                {processingLabel || 'Running in-browser CV pipeline…'}
              </p>
              {/* Real progress bar */}
              <div className="progress-bar-container" style={{ marginBottom: '16px' }}>
                <div className="progress-bar-fill" style={{ width: `${processingPct}%`, transition: 'width 0.3s ease' }} />
              </div>
              <div style={{ fontSize: '11px', color: 'var(--text-muted)', fontFamily: 'var(--font-mono)' }}>
                {Math.round(processingPct)}% complete
              </div>
              <div className="processing-steps" style={{ marginTop: '16px' }}>
                {PROCESSING_STEPS.map((label, i) => {
                  const st = i < processingStep ? 'done' : i === processingStep ? 'active' : 'pending';
                  return (
                    <div key={i} className={`processing-step ${st}`}>
                      <div className="processing-step-dot" />
                      <span className="processing-step-label" style={{ fontSize: '13px', color: 'inherit' }}>{label}</span>
                      {st === 'done' && <span className="processing-step-check">✓</span>}
                    </div>
                  );
                })}
              </div>
            </div>
          )}
        </div>

        <ToastContainer toasts={toasts} onDismiss={dismiss} />
      </div>
    );
  }

  /* ==== 3D VIEWER PAGE ==== */
  return (
    <div className="viewer-page">
      {/* Header */}
      <header className="viewer-header">
        <div className="glass brand-pill">
          <div className="brand-name">CourtSense AI</div>
          <div className="brand-sub">3D Tennis Analytics</div>
        </div>
        <div className="glass stats-panel">
          <div className="stat-item">
            <span className="stat-label">Speed</span>
            <span className="stat-value" style={{ color: ballSpeed > 180 ? 'var(--rose)' : ballSpeed > 120 ? 'var(--amber)' : 'var(--accent)' }}>{ballSpeed.toFixed(0)}</span>
            <span className="stat-unit">km/h</span>
          </div>
          <div className="stat-divider" />
          <div className="stat-item">
            <span className="stat-label">Spin</span>
            <span className="stat-value" style={{ color: 'var(--cyan)' }}>{spinRate.toFixed(0)}</span>
            <span className="stat-unit">rpm</span>
          </div>
          <div className="stat-divider" />
          <div className="stat-item">
            <span className="stat-label">Frame</span>
            <span className="stat-value" style={{ color: 'var(--text-secondary)', fontSize: '15px' }}>{frame.toString().padStart(4, '0')}</span>
            <span className="stat-unit">/ {totalFrames}</span>
          </div>
        </div>
      </header>

      {/* Camera Presets — left side */}
      <div className="camera-presets">
        {([
          { id: 'default' as const, label: 'TV' },
          { id: 'overhead' as const, label: 'TOP' },
          { id: 'p1' as const, label: 'P1' },
          { id: 'p2' as const, label: 'P2' },
        ] as const).map(cam => (
          <button key={cam.id} className={`camera-btn ${cameraPreset === cam.id ? 'active' : ''}`}
            onClick={() => setCameraPreset(cam.id)} title={`Camera: ${cam.label}`}>
            {cam.label}
          </button>
        ))}
        <button
          className={`heatmap-btn ${showHeatmap ? 'active' : ''}`}
          onClick={() => setShowHeatmap(h => !h)}
          title="Toggle Heatmap (H)"
        >
          <Map size={15} />
        </button>
      </div>

      {/* Analytics Sidebar — right side */}
      <AnalyticsSidebar
        ballSpeed={ballSpeed}
        spinRate={spinRate}
        frame={frame}
        totalFrames={totalFrames}
        isPlaying={isPlaying}
      />

      {/* 3D Canvas */}
      <main style={{ flex: 1 }}>
        <TennisScene
          ballPos={ballPos}
          player1Pos={p1Pos}
          player2Pos={p2Pos}
          ballTrail={ballTrail}
          cameraPreset={cameraPreset}
          p1Hitting={p1Hitting}
          p2Hitting={p2Hitting}
        />
      </main>

      {/* Heatmap Overlay */}
      <HeatmapOverlay positions={heatmapData} visible={showHeatmap} />

      {/* Keyboard Hints */}
      <div className="keyboard-hint">
        <span className="kbd">Space</span>
        <span className="hint-text">Play/Pause</span>
        <span className="kbd">←</span>
        <span className="kbd">→</span>
        <span className="hint-text">Step</span>
        <span className="kbd">R</span>
        <span className="hint-text">Reset</span>
        <span className="kbd">H</span>
        <span className="hint-text">Heatmap</span>
      </div>

      {/* Footer Controls */}
      <footer className="viewer-footer">
        <div className="footer-actions">
          <button className="action-btn" onClick={() => {
            setAppState('idle'); setSequenceData([]); setIsPlaying(false);
            trailRef.current = []; setBallTrail([]);
            heatRef.current = []; setHeatmapData([]);
          }}>
            <Video size={13} /> New Video
          </button>
        </div>

        <div className="glass-heavy controls-bar">
          {/* Timeline */}
          <div
            ref={timelineRef}
            className="timeline-container"
            onMouseDown={handleTimelineMouseDown}
          >
            <div className="timeline-fill" style={{ width: `${progress}%` }} />
          </div>

          <div className="controls-row">
            <div className="controls-left">
              <button className="control-icon-btn" onClick={resetSimulation} title="Reset (R)">
                <RotateCcw size={15} />
              </button>
              <button className="control-icon-btn" onClick={() => { if (sequenceData.length > 0) { setIsPlaying(false); seekToFrame(Math.max(frameRef.current - 1, 0)); } }} title="Prev frame (←)">
                <ChevronLeft size={17} />
              </button>
              <button className="play-btn" onClick={() => setIsPlaying(p => !p)} title="Play/Pause (Space)">
                {isPlaying ? <Pause size={17} fill="currentColor" /> : <Play size={17} fill="currentColor" />}
              </button>
              <button className="control-icon-btn" onClick={() => { if (sequenceData.length > 0) { setIsPlaying(false); seekToFrame(Math.min(frameRef.current + 1, sequenceData.length - 1)); } }} title="Next frame (→)">
                <ChevronRight size={17} />
              </button>
            </div>
            <div className="controls-right">
              <div className="speed-selector">
                {SPEED_OPTIONS.map(s => (
                  <button key={s} className={`speed-option ${speed === s ? 'active' : ''}`} onClick={() => setSpeed(s)}>
                    {s}×
                  </button>
                ))}
              </div>
              <span className="frame-counter">
                {frame.toString().padStart(4, '0')}
                <span className="frame-counter-dim"> / {totalFrames}</span>
              </span>
            </div>
          </div>
        </div>
      </footer>

      <ToastContainer toasts={toasts} onDismiss={dismiss} />
    </div>
  );
}

export default App;
