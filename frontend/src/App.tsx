import { useState, useEffect, useRef } from 'react';
import { TennisScene } from './components/TennisScene';
import { Play, Pause, RotateCcw, Activity, Upload, CheckCircle2 } from 'lucide-react';
import axios from 'axios';
import './index.css';

interface Coordinate { x: number; y: number; z: number; }
interface PlayerState { id: string; position: Coordinate; }
interface BallState { position: Coordinate; is_occluded: boolean; }
interface FrameData { frame_index: number; ball: BallState | null; players: PlayerState[]; ball_speed_kmh?: number; spin_rate_rpm?: number; }
interface SequenceResponse { sequence: FrameData[]; }

const BACKEND_URL = 'http://localhost:8000';

function App() {
  const [isPlaying, setIsPlaying] = useState(false);
  const [frame, setFrame] = useState(0);
  const [sequenceData, setSequenceData] = useState<FrameData[]>([]);
  
  // App States: 'idle' (waiting for video) -> 'uploading' -> 'processing' -> 'ready' (showing 3D)
  const [appState, setAppState] = useState<'idle' | 'uploading' | 'processing' | 'ready'>('idle');
  const [uploadProgress, setUploadProgress] = useState(0);

  const [ballPos, setBallPos] = useState<[number, number, number]>([0, 1, 0]);
  const [p1Pos, setP1Pos] = useState<[number, number, number]>([0, 0, 10]);
  const [p2Pos, setP2Pos] = useState<[number, number, number]>([0, 0, -10]);
  const [ballSpeed, setBallSpeed] = useState(0);
  const [spinRate, setSpinRate] = useState(0);
  
  const frameRef = useRef(0);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // Load a demo by default on idle if the user clicked "Load Demo"
  const loadDemo = () => {
    setAppState('processing');
    axios.get<SequenceResponse>(`${BACKEND_URL}/api/v1/tracking/real`)
      .then(res => {
        setSequenceData(res.data.sequence);
        if (res.data.sequence.length > 0) {
            updatePositions(res.data.sequence[0]);
        }
        setAppState('ready');
      })
      .catch(err => {
        console.error("Failed to fetch tracking data:", err);
        setAppState('idle');
        alert("Failed to load demo data.");
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
        const res = await axios.post<SequenceResponse>(`${BACKEND_URL}/api/v1/tracking/upload`, formData, {
            headers: { 'Content-Type': 'multipart/form-data' },
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
    
    // reset input
    if (fileInputRef.current) fileInputRef.current.value = '';
  };

  function updatePositions(frameData: FrameData) {
    if (frameData.ball) {
      setBallPos([frameData.ball.position.x, frameData.ball.position.y, frameData.ball.position.z]);
    }
    for (const player of frameData.players) {
      const pos: [number, number, number] = [player.position.x, player.position.y, player.position.z];
      if (player.id.includes('top')) {
        setP1Pos(pos);
      } else if (player.id.includes('bottom')) {
        setP2Pos(pos);
      }
    }
    if (frameData.ball_speed_kmh !== undefined) setBallSpeed(frameData.ball_speed_kmh);
    if (frameData.spin_rate_rpm !== undefined) setSpinRate(frameData.spin_rate_rpm);
  }

  useEffect(() => {
    let animationFrameId: number;
    let lastTime = performance.now();
    const fps = 30;
    const frameInterval = 1000 / fps;

    const renderLoop = (time: number) => {
      if (isPlaying && sequenceData.length > 0 && appState === 'ready') {
        const deltaTime = time - lastTime;
        
        if (deltaTime >= frameInterval) {
            let nextFrame = frameRef.current + 1;
            if (nextFrame >= sequenceData.length) {
                nextFrame = 0;
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
  }, [isPlaying, sequenceData, appState]);

  const togglePlay = () => setIsPlaying(!isPlaying);
  
  const resetSimulation = () => {
    setIsPlaying(false);
    frameRef.current = 0;
    setFrame(0);
    if (sequenceData.length > 0) {
        updatePositions(sequenceData[0]);
    }
  };

  const totalFrames = sequenceData.length || 1;
  const progress = (frame / totalFrames) * 100;

  // --- RENDERING UPLOAD UI ---
  if (appState !== 'ready') {
      return (
        <div className="w-full h-screen bg-neutral-950 text-white flex flex-col items-center justify-center font-sans overflow-hidden pattern-bg relative">
            {/* Minimal Grid Background */}
            <div className="absolute inset-0 bg-[linear-gradient(rgba(255,255,255,0.03)_1px,transparent_1px),linear-gradient(90deg,rgba(255,255,255,0.03)_1px,transparent_1px)] bg-[size:64px_64px] [mask-image:radial-gradient(ellipse_60%_60%_at_50%_50%,#000_70%,transparent_100%)]"></div>
            
            <div className="z-10 text-center max-w-lg w-full px-6">
                 <div className="mb-10 inline-block px-4 py-1.5 rounded-full bg-lime-500/10 border border-lime-500/20 text-lime-400 text-xs font-bold tracking-widest uppercase">
                    CourtSense AI V2
                 </div>
                 <h1 className="text-4xl md:text-5xl font-extrabold tracking-tight text-white leading-tight mb-4">
                     Welcome to the Court.
                 </h1>
                 <p className="text-neutral-400 text-lg mb-10 leading-relaxed font-light">
                     Upload any tennis match video and our AI pipeline will extract 3D telemetry, player biometrics, and ball physics in real-time.
                 </p>

                 {appState === 'idle' && (
                     <div className="flex flex-col gap-4">
                         <input 
                            type="file" 
                            accept="video/mp4,video/quicktime,video/webm" 
                            className="hidden" 
                            ref={fileInputRef}
                            onChange={handleFileUpload}
                         />
                         <button 
                            onClick={() => fileInputRef.current?.click()}
                            className="group relative flex items-center justify-center gap-3 w-full bg-lime-500 hover:bg-lime-400 text-black font-bold text-lg py-4 rounded-2xl transition-all duration-300 hover:scale-[1.02] active:scale-[0.98] shadow-[0_0_20px_rgba(132,204,22,0.2)] hover:shadow-[0_0_30px_rgba(132,204,22,0.4)]"
                         >
                            <Upload className="transition-transform group-hover:-translate-y-1" />
                            Select Video to Analyze
                         </button>
                         <button 
                            onClick={loadDemo}
                            className="text-neutral-500 hover:text-white transition-colors text-sm font-medium py-2"
                         >
                             Or load pre-generated demo data
                         </button>
                     </div>
                 )}

                 {appState === 'uploading' && (
                     <div className="bg-neutral-900 border border-white/10 rounded-3xl p-8 shadow-2xl">
                         <div className="flex justify-between items-end mb-4">
                             <div className="flex items-center gap-3">
                                <Upload className="animate-bounce text-lime-400" size={24} />
                                <span className="font-semibold text-lg">Uploading Video...</span>
                             </div>
                             <span className="font-mono text-lime-400 text-xl">{uploadProgress}%</span>
                         </div>
                         <div className="w-full h-2 bg-neutral-800 rounded-full overflow-hidden">
                             <div 
                                className="h-full bg-lime-500 rounded-full transition-all duration-300" 
                                style={{ width: `${uploadProgress}%` }}
                             />
                         </div>
                     </div>
                 )}

                 {appState === 'processing' && (
                     <div className="bg-neutral-900 border border-white/10 rounded-3xl p-8 shadow-2xl flex flex-col items-center">
                         <div className="relative w-16 h-16 mb-6">
                             <div className="absolute inset-0 border-4 border-neutral-800 rounded-full"></div>
                             <div className="absolute inset-0 border-4 border-lime-500 rounded-full border-t-transparent animate-spin"></div>
                         </div>
                         <h3 className="text-xl font-bold mb-2">Analyzing Geometry & Biometrics</h3>
                         <p className="text-neutral-500 text-sm">Running YOLOv8-Pose and Trajectory Physics Pipeline...</p>
                         <p className="text-lime-500/50 text-xs mt-4 animate-pulse">This usually takes several minutes on CPU depending on video length.</p>
                     </div>
                 )}
            </div>
        </div>
      );
  }

  return (
    <div className="w-full h-screen bg-neutral-950 text-white overflow-hidden relative font-sans flex flex-col">
      {/* Header */}
      <header className="absolute top-0 left-0 right-0 z-10 p-5 flex justify-between items-start">
        <div className="bg-black/50 backdrop-blur-xl border border-white/10 rounded-2xl px-5 py-3">
          <h1 className="text-xl font-extrabold tracking-tight text-white leading-none">
            CourtSense AI
          </h1>
          <p className="text-neutral-400 text-[10px] font-semibold tracking-[0.2em] uppercase mt-0.5">3D Tennis Analytics</p>
        </div>
        
        {/* Stats Panel */}
        <div className="bg-black/50 backdrop-blur-xl border border-white/10 rounded-2xl px-5 py-3 flex gap-5">
          <div className="flex flex-col items-center">
            <span className="text-[10px] text-neutral-500 font-bold tracking-[0.15em] uppercase">Speed</span>
            <span className="text-lg font-bold font-mono text-lime-400 leading-tight">{ballSpeed.toFixed(0)}</span>
            <span className="text-[9px] text-neutral-600 font-medium">km/h</span>
          </div>
          <div className="w-px bg-white/10"></div>
          <div className="flex flex-col items-center">
            <span className="text-[10px] text-neutral-500 font-bold tracking-[0.15em] uppercase">Spin</span>
            <span className="text-lg font-bold font-mono text-cyan-400 leading-tight">{spinRate.toFixed(0)}</span>
            <span className="text-[9px] text-neutral-600 font-medium">rpm</span>
          </div>
        </div>
      </header>

      {/* 3D Canvas */}
      <main className="flex-1">
        <TennisScene ballPos={ballPos} player1Pos={p1Pos} player2Pos={p2Pos} />
      </main>

      {/* Controls Footer */}
      <footer className="absolute bottom-6 left-1/2 -translate-x-1/2 z-10 w-full max-w-lg px-4 flex flex-col gap-3">
        {/* New Session Button */}
        <div className="flex justify-end w-full">
             <button 
                 onClick={() => {
                     setAppState('idle');
                     setSequenceData([]);
                 }}
                 className="bg-neutral-900 hover:bg-neutral-800 border border-white/10 text-xs font-semibold px-4 py-2 rounded-xl transition-colors shadow-lg shadow-black/50 flex items-center gap-2"
             >
                 <Upload size={14} />
                 New Video
             </button>
        </div>

        <div className="bg-black/80 backdrop-blur-xl border border-white/10 rounded-2xl px-5 py-3 shadow-2xl">
          {/* Progress Bar */}
          <div className="w-full h-1 bg-white/10 rounded-full mb-3 overflow-hidden cursor-pointer">
            <div
              className="h-full bg-gradient-to-r from-lime-500 to-emerald-400 rounded-full transition-all duration-100"
              style={{ width: `${progress}%` }}
            />
          </div>
          
          {/* Controls Row */}
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3">
                <button
                onClick={resetSimulation}
                className="text-neutral-500 hover:text-white transition-colors"
                >
                <RotateCcw size={18} />
                </button>

                <button
                onClick={togglePlay}
                className="bg-lime-500 hover:bg-lime-400 text-black rounded-full p-3 transition-all duration-200 shadow-[0_0_16px_rgba(132,204,22,0.3)] hover:shadow-[0_0_24px_rgba(132,204,22,0.5)]"
                >
                {isPlaying ? <Pause size={18} fill="currentColor" /> : <Play size={18} fill="currentColor" />}
                </button>
            </div>

            <div className="flex items-center gap-4">
                <span className="text-[10px] text-neutral-500 font-bold tracking-wider uppercase">1×</span>
                <div className="flex flex-col items-end">
                <span className="text-xs text-neutral-400 font-mono">
                    {frame.toString().padStart(4, '0')}
                    <span className="text-neutral-600"> / {totalFrames}</span>
                </span>
                </div>
            </div>
          </div>
        </div>
      </footer>
    </div>
  );
}

export default App;
