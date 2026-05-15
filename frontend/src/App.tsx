import { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import { TennisScene } from './components/TennisScene';
import { ToastContainer, useToast } from './components/Toast';
import { AnalyticsSidebar } from './components/AnalyticsSidebar';
import { HeatmapOverlay } from './components/HeatmapOverlay';
import {
  Play, Pause, RotateCcw, Upload, Zap, Eye, Target,
  ChevronLeft, ChevronRight, Video, Settings, X, Map,
} from 'lucide-react';
import axios from 'axios';
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
  'Uploading video',
  'Extracting frames',
  'Running YOLOv8 detection',
  'Computing trajectories',
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
  const [appState, setAppState] = useState<'idle' | 'uploading' | 'processing' | 'ready'>('idle');
  const [uploadProgress, setUploadProgress] = useState(0);
  const [speed, setSpeed] = useState(1);
  const [cameraPreset, setCameraPreset] = useState<'default' | 'overhead' | 'p1' | 'p2'>('default');
  const [showHeatmap, setShowHeatmap] = useState(false);
  const [processingStep, setProcessingStep] = useState(0);

  const [backendUrl, setBackendUrl] = useState(() =>
    localStorage.getItem('courtsense_backend_url') || 'http://localhost:8000'
  );
  const [showSettings, setShowSettings] = useState(false);
  const [tempUrlInput, setTempUrlInput] = useState('');
  // 'unknown' = not yet checked, 'online' = reachable, 'offline' = not reachable
  const [backendStatus, setBackendStatus] = useState<'unknown' | 'online' | 'offline'>('unknown');
  const [showBackendHelp, setShowBackendHelp] = useState(false);

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

  const frameRef = useRef(0);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const trailRef = useRef<[number, number, number][]>([]);
  const heatRef = useRef<[number, number][]>([]);
  const [isDragging, setIsDragging] = useState(false);
  const timelineRef = useRef<HTMLDivElement>(null);
  const isDraggingTimeline = useRef(false);

  const { toasts, addToast, dismiss } = useToast();

  /* --- Backend health probe --- */
  const checkBackendHealth = useCallback(async (url: string) => {
    setBackendStatus('unknown');
    try {
      await axios.get(`${url}/health`, {
        timeout: 4000,
        headers: { 'Bypass-Tunnel-Reminder': 'true' },
      });
      setBackendStatus('online');
      return true;
    } catch {
      setBackendStatus('offline');
      return false;
    }
  }, []);

  // Probe on mount and whenever backendUrl changes
  useEffect(() => {
    checkBackendHealth(backendUrl);
  }, [backendUrl, checkBackendHealth]);

  /* --- Simulated step advancement during processing --- */
  useEffect(() => {
    if (appState !== 'processing') { setProcessingStep(0); return; }
    setProcessingStep(0);
    const intervals = PROCESSING_STEPS.map((_, i) =>
      setTimeout(() => setProcessingStep(i + 1), i * 900)
    );
    return () => intervals.forEach(clearTimeout);
  }, [appState]);

  /* --- Data Loading --- */
  // Demo always loads the static JSON — no backend needed
  const loadDemo = useCallback(() => {
    setAppState('processing');
    fetch(`${import.meta.env.BASE_URL}demo_data.json`)
      .then(r => {
        if (!r.ok) throw new Error(`HTTP ${r.status}`);
        return r.json();
      })
      .then((data: SequenceResponse) => {
        setSequenceData(data.sequence);
        heatRef.current = [];
        trailRef.current = [];
        frameRef.current = 0;
        setFrame(0);
        setBallTrail([]);
        setHeatmapData([]);
        if (data.sequence.length > 0) updatePositions(data.sequence[0]);
        setAppState('ready');
        setIsPlaying(true); // auto-play
        addToast(`Demo loaded — ${data.sequence.length} frames!`, 'success');
      })
      .catch(err => {
        console.error('Demo load failed:', err);
        setAppState('idle');
        addToast('Could not load demo_data.json. Check the public/ folder.', 'error', 6000);
      });
  }, [updatePositions, addToast]);

  /* Pre-flight check then open file picker */
  const handleUploadClick = async () => {
    const isOnline = await checkBackendHealth(backendUrl);
    if (!isOnline) {
      setShowBackendHelp(true);
      return;
    }
    fileInputRef.current?.click();
  };

  const handleFileUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    if (!e.target.files || e.target.files.length === 0) return;
    const file = e.target.files[0];
    if (!file.type.startsWith('video/')) {
      addToast('Please select a valid video file (mp4, mov, webm).', 'warning');
      return;
    }
    setAppState('uploading');
    setUploadProgress(0);
    const formData = new FormData();
    formData.append('file', file);
    try {
      const res = await axios.post<SequenceResponse>(`${backendUrl}/api/v1/tracking/upload`, formData, {
        headers: { 'Content-Type': 'multipart/form-data', 'Bypass-Tunnel-Reminder': 'true' },
        timeout: 0, // no timeout — video processing can take minutes
        onUploadProgress: (evt) => {
          const pct = Math.round((evt.loaded * 100) / (evt.total || 1));
          setUploadProgress(pct);
          if (pct === 100) setAppState('processing');
        },
      });
      setSequenceData(res.data.sequence);
      if (res.data.sequence.length > 0) updatePositions(res.data.sequence[0]);
      setAppState('ready');
      addToast(`Analysis complete — ${res.data.sequence.length} frames tracked!`, 'success');
    } catch (err: unknown) {
      setBackendStatus('offline');
      setAppState('idle');
      // Distinguish network errors from server errors
      if (axios.isAxiosError(err) && err.response) {
        const detail = err.response.data?.detail || `Server error ${err.response.status}`;
        addToast(`Processing failed: ${detail}`, 'error', 8000);
      } else {
        setShowBackendHelp(true);
      }
    }
    if (fileInputRef.current) fileInputRef.current.value = '';
  };

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

  /* --- Position Updates: single batched setState per frame --- */
  const updatePositions = useCallback((fd: FrameData) => {
    if (fd.ball) {
      const np: [number, number, number] = [fd.ball.position.x, fd.ball.position.y, fd.ball.position.z];
      setBallPos(np);
      trailRef.current = [...trailRef.current.slice(-15), np];
      setBallTrail(trailRef.current.slice());
      // Only append heatmap every 3rd frame to limit canvas redraws
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
    // Hitting flash: brief true pulse when hitter is set
    if (fd.hitter) {
      if (hittingTimerRef.current) clearTimeout(hittingTimerRef.current);
      if (fd.hitter === 'p1') { setP1Hitting(true); setP2Hitting(false); }
      else { setP2Hitting(true); setP1Hitting(false); }
      hittingTimerRef.current = setTimeout(() => { setP1Hitting(false); setP2Hitting(false); }, 250);
    }
  }, []);

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
        {/* Top-right: backend status + settings */}
        <div style={{ position: 'absolute', top: '1.5rem', right: '1.5rem', display: 'flex', alignItems: 'center', gap: '10px', zIndex: 100 }}>
          {/* Backend status badge */}
          <div
            title={`Backend: ${backendStatus === 'online' ? 'Connected' : backendStatus === 'offline' ? 'Offline — click to configure' : 'Checking...'}`}
            onClick={() => { if (backendStatus !== 'online') { setTempUrlInput(backendUrl); setShowSettings(true); } }}
            style={{
              display: 'flex', alignItems: 'center', gap: '7px',
              padding: '6px 12px',
              borderRadius: '999px',
              background: backendStatus === 'online'
                ? 'rgba(16,185,129,0.1)'
                : backendStatus === 'offline'
                  ? 'rgba(244,63,94,0.1)'
                  : 'rgba(255,255,255,0.05)',
              border: `1px solid ${backendStatus === 'online' ? 'rgba(16,185,129,0.3)' : backendStatus === 'offline' ? 'rgba(244,63,94,0.3)' : 'rgba(255,255,255,0.1)'}`,
              cursor: backendStatus !== 'online' ? 'pointer' : 'default',
              transition: 'all 0.4s ease',
              fontSize: '11px',
              fontWeight: 600,
              color: backendStatus === 'online' ? '#6ee7b7' : backendStatus === 'offline' ? '#fda4af' : 'var(--text-muted)',
              fontFamily: 'var(--font-sans)',
              userSelect: 'none',
            }}
          >
            <span style={{
              width: 7, height: 7, borderRadius: '50%', flexShrink: 0,
              background: backendStatus === 'online' ? '#10b981' : backendStatus === 'offline' ? '#f43f5e' : '#6b7280',
              boxShadow: backendStatus === 'online' ? '0 0 8px rgba(16,185,129,0.6)' : backendStatus === 'offline' ? '0 0 8px rgba(244,63,94,0.5)' : 'none',
              animation: backendStatus === 'unknown' ? 'pulse-glow 1.5s ease infinite' : 'none',
            }} />
            {backendStatus === 'online' ? 'Backend Online' : backendStatus === 'offline' ? 'Backend Offline' : 'Checking...'}
          </div>
          <button className="settings-toggle-btn" style={{ position: 'static' }} onClick={() => { setTempUrlInput(backendUrl); setShowSettings(true); }}>
            <Settings size={18} />
          </button>
        </div>

        {/* Settings Modal */}
        {showSettings && (
          <div className="settings-modal-overlay" onClick={e => { if (e.target === e.currentTarget) setShowSettings(false); }}>
            <div className="settings-modal glass-heavy">
              <button className="settings-close" onClick={() => setShowSettings(false)}><X size={18} /></button>
              <h2>Backend Config</h2>
              <p>Enter your FastAPI backend URL or Google Colab tunnel URL to process videos.</p>
              <input type="text" value={tempUrlInput} onChange={e => setTempUrlInput(e.target.value)} placeholder="https://your-tunnel.loca.lt" className="url-input" />
              <button className="save-url-btn" onClick={() => {
                let url = tempUrlInput.trim();
                if (url.endsWith('/')) url = url.slice(0, -1);
                setBackendUrl(url);
                localStorage.setItem('courtsense_backend_url', url);
                setShowSettings(false);
                addToast('Backend URL saved — checking connection…', 'info');
              }}>Save & Connect</button>
              <div style={{ marginTop: '20px', fontSize: '13px', color: 'var(--text-muted)' }}>
                <p style={{ marginBottom: '6px' }}><strong style={{ color: 'var(--text-secondary)' }}>Free Processing via Google Colab:</strong></p>
                <a href="https://colab.research.google.com/github/udayraj1238/CourtSense-AI/blob/main/colab_backend.ipynb" target="_blank" rel="noreferrer" style={{ color: 'var(--accent)', textDecoration: 'underline' }}>
                  Open the free Colab backend notebook →
                </a>
                <p style={{ marginTop: '12px' }}>Run all cells, copy the <code style={{ background: 'rgba(255,255,255,0.06)', padding: '1px 5px', borderRadius: '4px' }}>loca.lt</code> URL it prints, paste it above.</p>
              </div>
            </div>
          </div>
        )}

        {/* Backend Help Modal — shown when upload is attempted with no backend */}
        {showBackendHelp && (
          <div className="settings-modal-overlay" onClick={e => { if (e.target === e.currentTarget) setShowBackendHelp(false); }}>
            <div className="settings-modal glass-heavy">
              <button className="settings-close" onClick={() => setShowBackendHelp(false)}><X size={18} /></button>
              <div style={{ fontSize: '28px', marginBottom: '12px' }}>🚫</div>
              <h2>Backend Not Reachable</h2>
              <p>Custom video processing requires the CourtSense AI backend to be running. It's currently unreachable at:</p>
              <div style={{ background: 'rgba(244,63,94,0.08)', border: '1px solid rgba(244,63,94,0.2)', borderRadius: '10px', padding: '10px 14px', fontFamily: 'var(--font-mono)', fontSize: '12px', color: '#fda4af', marginBottom: '20px', wordBreak: 'break-all' }}>
                {backendUrl}
              </div>
              <p style={{ fontWeight: 600, color: 'var(--text-secondary)', marginBottom: '12px' }}>Choose an option:</p>

              {/* Option 1: Colab */}
              <div style={{ background: 'rgba(163,230,53,0.06)', border: '1px solid rgba(163,230,53,0.15)', borderRadius: '14px', padding: '16px', marginBottom: '12px' }}>
                <div style={{ fontWeight: 700, marginBottom: '6px', fontSize: '14px' }}>✨ Option 1 — Free Google Colab (Recommended)</div>
                <div style={{ fontSize: '12px', color: 'var(--text-secondary)', marginBottom: '10px' }}>Run the backend for free on Google's servers. No setup required.</div>
                <a
                  href="https://colab.research.google.com/github/udayraj1238/CourtSense-AI/blob/main/colab_backend.ipynb"
                  target="_blank" rel="noreferrer"
                  style={{ display: 'inline-block', background: 'var(--accent)', color: '#000', fontWeight: 700, fontSize: '13px', padding: '8px 16px', borderRadius: '10px', textDecoration: 'none' }}
                >
                  Open Colab Notebook →
                </a>
                <div style={{ fontSize: '11px', color: 'var(--text-muted)', marginTop: '8px' }}>Then run all cells, copy the tunnel URL, paste it in Settings (⚙️) above.</div>
              </div>

              {/* Option 2: Local */}
              <div style={{ background: 'rgba(255,255,255,0.03)', border: '1px solid var(--border-subtle)', borderRadius: '14px', padding: '16px', marginBottom: '16px' }}>
                <div style={{ fontWeight: 700, marginBottom: '6px', fontSize: '14px' }}>🖥️ Option 2 — Run Locally</div>
                <div style={{ fontFamily: 'var(--font-mono)', fontSize: '11px', background: 'rgba(0,0,0,0.4)', borderRadius: '8px', padding: '10px 12px', color: 'var(--text-secondary)' }}>
                  cd backend<br/>
                  pip install -r ../requirements.txt<br/>
                  uvicorn main:app --reload
                </div>
              </div>

              <div style={{ display: 'flex', gap: '10px' }}>
                <button className="save-url-btn" style={{ flex: 1 }} onClick={() => { setShowBackendHelp(false); setTempUrlInput(backendUrl); setShowSettings(true); }}>
                  Configure URL ⚙️
                </button>
                <button onClick={() => setShowBackendHelp(false)} style={{ flex: 1, padding: '1rem', background: 'rgba(255,255,255,0.06)', border: '1px solid var(--border-light)', borderRadius: '14px', color: 'var(--text-secondary)', cursor: 'pointer', fontWeight: 600, fontFamily: 'var(--font-sans)' }}>
                  Try Demo Instead
                </button>
              </div>
            </div>
          </div>
        )}

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
            <div className="animate-in-delayed-3" style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
              <input type="file" accept="video/mp4,video/quicktime,video/webm" ref={fileInputRef} onChange={handleFileUpload} style={{ display: 'none' }} />
              <button
                onClick={handleUploadClick}
                className="upload-btn"
                style={backendStatus === 'offline' ? { opacity: 0.85 } : undefined}
              >
                <Upload size={18} />
                {backendStatus === 'checking' ? 'Checking backend…' : 'Select Video to Analyze'}
              </button>
              {backendStatus === 'offline' && (
                <div style={{
                  display: 'flex', alignItems: 'center', gap: '8px',
                  padding: '10px 14px',
                  borderRadius: '12px',
                  background: 'rgba(244,63,94,0.07)',
                  border: '1px solid rgba(244,63,94,0.2)',
                  fontSize: '12px',
                  color: '#fda4af',
                  fontFamily: 'var(--font-sans)',
                }}>
                  <span>⚠</span>
                  <span>Backend offline — <button onClick={() => setShowBackendHelp(true)} style={{ background:'none', border:'none', color:'var(--accent)', cursor:'pointer', fontFamily:'var(--font-sans)', fontSize:'12px', fontWeight:600, padding:0, textDecoration:'underline' }}>see how to start it</button>, or try the demo below.</span>
                </div>
              )}
              <button onClick={loadDemo} className="demo-btn">
                Or load pre-generated demo →
              </button>
            </div>
          )}

          {appState === 'uploading' && (
            <div className="status-card animate-scale-in">
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '16px' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
                  <Upload size={18} style={{ color: 'var(--accent)' }} />
                  <span style={{ fontWeight: 700, fontSize: '15px' }}>Uploading Video...</span>
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
                <div className="spinner-ring-fill-2" />
              </div>
              <h3 style={{ fontSize: '18px', fontWeight: 800, marginBottom: '6px', letterSpacing: '-0.02em' }}>
                Analyzing Match Data
              </h3>
              <p style={{ color: 'var(--text-muted)', fontSize: '13px', margin: '0 0 20px' }}>
                Running YOLOv8-Pose + Trajectory Physics Pipeline
              </p>
              <div className="processing-steps">
                {PROCESSING_STEPS.map((label, i) => {
                  const state = i < processingStep ? 'done' : i === processingStep ? 'active' : 'pending';
                  return (
                    <div key={i} className={`processing-step ${state}`}>
                      <div className="processing-step-dot" />
                      <span className="processing-step-label" style={{ fontSize: '13px', color: 'inherit' }}>{label}</span>
                      {state === 'done' && <span className="processing-step-check">✓</span>}
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
