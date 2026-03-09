import { useState, useEffect, useRef } from 'react';
import { TennisScene } from './components/TennisScene';
import { Play, Pause, RotateCcw, Activity } from 'lucide-react';
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
  const [isLoading, setIsLoading] = useState(true);

  const [ballPos, setBallPos] = useState<[number, number, number]>([0, 1, 0]);
  const [p1Pos, setP1Pos] = useState<[number, number, number]>([0, 0, 10]);
  const [p2Pos, setP2Pos] = useState<[number, number, number]>([0, 0, -10]);
  const [ballSpeed, setBallSpeed] = useState(0);
  const [spinRate, setSpinRate] = useState(0);
  
  const frameRef = useRef(0);

  useEffect(() => {
    axios.get<SequenceResponse>(`${BACKEND_URL}/api/v1/tracking/real`)
      .then(res => {
        setSequenceData(res.data.sequence);
        setIsLoading(false);
        if (res.data.sequence.length > 0) {
            updatePositions(res.data.sequence[0]);
        }
      })
      .catch(err => {
        console.error("Failed to fetch tracking data:", err);
        setIsLoading(false);
      });
  }, []);

  const updatePositions = (frameData: FrameData) => {
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
  };

  useEffect(() => {
    let animationFrameId: number;
    let lastTime = performance.now();
    const fps = 30;
    const frameInterval = 1000 / fps;

    const renderLoop = (time: number) => {
      if (isPlaying && sequenceData.length > 0) {
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

    if (isPlaying) {
      animationFrameId = requestAnimationFrame(renderLoop);
    }

    return () => {
      if (animationFrameId) cancelAnimationFrame(animationFrameId);
    };
  }, [isPlaying, sequenceData]);

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
      <footer className="absolute bottom-6 left-1/2 -translate-x-1/2 z-10 w-full max-w-lg px-4">
        <div className="bg-black/60 backdrop-blur-xl border border-white/10 rounded-2xl px-5 py-3 shadow-2xl">
          {/* Progress Bar */}
          <div className="w-full h-1 bg-white/10 rounded-full mb-3 overflow-hidden cursor-pointer">
            <div
              className="h-full bg-gradient-to-r from-lime-500 to-emerald-400 rounded-full transition-all duration-100"
              style={{ width: `${progress}%` }}
            />
          </div>
          
          {/* Controls Row */}
          <div className="flex items-center justify-between">
            {isLoading ? (
              <div className="flex items-center gap-2 text-lime-400 w-full justify-center">
                <Activity className="animate-spin" size={18} />
                <span className="text-xs font-bold uppercase tracking-widest">Loading...</span>
              </div>
            ) : (
              <>
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
              </>
            )}
          </div>
        </div>
      </footer>
    </div>
  );
}

export default App;
