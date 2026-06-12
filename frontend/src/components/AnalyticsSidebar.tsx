import React, { useMemo } from 'react';
import { Activity, Zap, RotateCcw as SpinIcon } from 'lucide-react';

interface AnalyticsSidebarProps {
  ballSpeed: number;   // km/h
  spinRate: number;    // rpm
  frame: number;
  totalFrames: number;
  isPlaying: boolean;
  isServerAnalysis: boolean;
  distP1?: number;
  distP2?: number;
  rallyHits?: number;
  shotHistory?: {frame:number, hitter:string, speed:number}[];
  onSeek?: (frame: number) => void;
  setIsPlaying?: (playing: boolean) => void;
}

/* Radial Speed Gauge */
function SpeedGauge({ speed }: { speed: number }) {
  const maxSpeed = 250; // km/h
  const pct = Math.min(speed / maxSpeed, 1);
  const radius = 36;
  const circumference = 2 * Math.PI * radius;
  // Only use 240° of the circle (from 150° to 390°)
  const arcLength = circumference * (240 / 360);
  const dashOffset = arcLength * (1 - pct);

  // Color: green → amber → rose based on speed
  const color = speed < 100 ? 'var(--accent)' : speed < 180 ? 'var(--amber)' : 'var(--rose)';

  return (
    <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '6px' }}>
      <div style={{ position: 'relative', width: 90, height: 90 }}>
        <svg width="90" height="90" viewBox="0 0 90 90" style={{ transform: 'rotate(150deg)' }}>
          {/* Track */}
          <circle
            cx="45" cy="45" r={radius}
            fill="none"
            stroke="rgba(255,255,255,0.06)"
            strokeWidth="5"
            strokeDasharray={`${arcLength} ${circumference}`}
            strokeLinecap="round"
          />
          {/* Fill */}
          <circle
            cx="45" cy="45" r={radius}
            fill="none"
            stroke={color}
            strokeWidth="5"
            strokeDasharray={`${arcLength - dashOffset} ${circumference}`}
            strokeLinecap="round"
            style={{
              filter: `drop-shadow(0 0 6px ${color})`,
              transition: 'stroke-dasharray 0.3s var(--ease-out-quart), stroke 0.5s ease',
            }}
          />
        </svg>
        {/* Center value */}
        <div style={{
          position: 'absolute',
          inset: 0,
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          justifyContent: 'center',
        }}>
          <span style={{
            fontFamily: 'var(--font-mono)',
            fontSize: '18px',
            fontWeight: 700,
            color,
            lineHeight: 1,
            transition: 'color 0.5s ease',
          }}>
            {Math.round(speed)}
          </span>
          <span style={{ fontSize: '8px', color: 'var(--text-muted)', letterSpacing: '0.1em' }}>km/h</span>
        </div>
      </div>
      <div style={{
        display: 'flex',
        alignItems: 'center',
        gap: '5px',
        fontSize: '9px',
        fontWeight: 700,
        letterSpacing: '0.12em',
        textTransform: 'uppercase',
        color: 'var(--text-muted)',
      }}>
        <Zap size={9} />
        Ball Speed
      </div>
    </div>
  );
}

/* Spin Rate Ring */
function SpinRing({ rpm, isServerAnalysis }: { rpm: number; isServerAnalysis: boolean }) {
  const maxRpm = 5000;
  const pct = Math.min(rpm / maxRpm, 1);
  const radius = 28;
  const circumference = 2 * Math.PI * radius;
  const filled = isServerAnalysis ? circumference * pct : 0;

  return (
    <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '6px' }}>
      <div style={{ position: 'relative', width: 70, height: 70 }}>
        <svg width="70" height="70" viewBox="0 0 70 70">
          {/* Track */}
          <circle cx="35" cy="35" r={radius} fill="none" stroke="rgba(255,255,255,0.06)" strokeWidth="4" />
          {/* Fill — counter-clockwise feel */}
          <circle
            cx="35" cy="35" r={radius}
            fill="none"
            stroke="var(--cyan)"
            strokeWidth="4"
            strokeDasharray={`${filled} ${circumference}`}
            strokeLinecap="round"
            transform="rotate(-90 35 35)"
            style={{
              filter: 'drop-shadow(0 0 5px var(--cyan-glow))',
              transition: 'stroke-dasharray 0.3s var(--ease-out-quart)',
            }}
          />
        </svg>
        <div style={{
          position: 'absolute',
          inset: 0,
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          justifyContent: 'center',
        }}>
          <span style={{
            fontFamily: 'var(--font-mono)',
            fontSize: '13px',
            fontWeight: 700,
            color: 'var(--cyan)',
            lineHeight: 1,
          }}>
            {isServerAnalysis ? Math.round(rpm) : '—'}
          </span>
          <span style={{ fontSize: '7px', color: 'var(--text-muted)', letterSpacing: '0.08em' }}>rpm</span>
        </div>
      </div>
      <div style={{
        display: 'flex',
        alignItems: 'center',
        gap: '5px',
        fontSize: '9px',
        fontWeight: 700,
        letterSpacing: '0.12em',
        textTransform: 'uppercase',
        color: 'var(--text-muted)',
      }}>
        <SpinIcon size={9} />
        {isServerAnalysis ? 'Spin Rate' : 'Est. Spin'}
      </div>
    </div>
  );
}

/* Mini timeline bar */
function MiniTimeline({ frame, total }: { frame: number; total: number }) {
  const pct = total > 0 ? (frame / total) * 100 : 0;
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '6px', width: '100%' }}>
      <div style={{
        fontSize: '9px', fontWeight: 700, letterSpacing: '0.12em',
        textTransform: 'uppercase', color: 'var(--text-muted)',
        display: 'flex', alignItems: 'center', gap: '5px',
      }}>
        <Activity size={9} />
        Progress
      </div>
      <div style={{
        width: '100%', height: '3px',
        background: 'rgba(255,255,255,0.06)',
        borderRadius: '2px', overflow: 'hidden',
      }}>
        <div style={{
          height: '100%',
          width: `${pct}%`,
          background: 'linear-gradient(90deg, var(--accent-dim), var(--accent))',
          borderRadius: '2px',
          transition: 'width 0.08s linear',
          boxShadow: '0 0 6px var(--accent-glow)',
        }} />
      </div>
      <div style={{
        display: 'flex',
        justifyContent: 'space-between',
        fontFamily: 'var(--font-mono)',
        fontSize: '9px',
        color: 'var(--text-muted)',
      }}>
        <span>{frame.toString().padStart(4, '0')}</span>
        <span>{total}</span>
      </div>
    </div>
  );
}

/* Match Stats Card */
function MatchStats({ distP1 = 0, distP2 = 0, rallyHits = 0, avgSpeed = 0 }: { distP1?: number, distP2?: number, rallyHits?: number, avgSpeed?: number }) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '8px', width: '100%' }}>
      <div style={{
        fontSize: '9px', fontWeight: 700, letterSpacing: '0.12em',
        textTransform: 'uppercase', color: 'var(--text-muted)',
        display: 'flex', alignItems: 'center', gap: '5px',
        marginBottom: '2px'
      }}>
        <Activity size={9} />
        Match Stats
      </div>
      
      {/* Rally Length */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <span style={{ fontSize: '10px', color: 'var(--text-secondary)' }}>Rally Hits</span>
        <span style={{ fontFamily: 'var(--font-mono)', fontSize: '12px', fontWeight: 700, color: 'var(--accent)' }}>
          {rallyHits}
        </span>
      </div>

      {/* Distance P1 */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <span style={{ fontSize: '10px', color: 'var(--text-secondary)' }}>Player 1 Run</span>
        <span style={{ fontFamily: 'var(--font-mono)', fontSize: '11px', fontWeight: 600, color: '#fff' }}>
          {distP1.toFixed(1)} <span style={{ fontSize: '8px', color: 'var(--text-muted)' }}>m</span>
        </span>
      </div>

      {/* Average Shot Speed */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <span style={{ fontSize: '10px', color: 'var(--text-secondary)' }}>Avg Speed</span>
        <span style={{ fontFamily: 'var(--font-mono)', fontSize: '11px', fontWeight: 600, color: '#fff' }}>
          {avgSpeed.toFixed(0)} <span style={{ fontSize: '8px', color: 'var(--text-muted)' }}>km/h</span>
        </span>
      </div>
    </div>
  );
}

/* Shot History Card */
function ShotHistoryCard({ shots, onSeek, setIsPlaying, currentFrame }: { shots: {frame:number, hitter:string, speed:number}[], onSeek: (f:number)=>void, setIsPlaying: (b:boolean)=>void, currentFrame: number }) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '8px', width: '100%' }}>
      <div style={{
        fontSize: '9px', fontWeight: 700, letterSpacing: '0.12em',
        textTransform: 'uppercase', color: 'var(--text-muted)',
        display: 'flex', alignItems: 'center', gap: '5px',
        marginBottom: '2px'
      }}>
        <Activity size={9} />
        Shot History
      </div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: '4px', maxHeight: '120px', overflowY: 'auto', paddingRight: '4px' }}>
        {shots.map((shot, idx) => {
          const isP1 = shot.hitter.includes('bottom') || shot.hitter === 'p1';
          const color = isP1 ? 'var(--cyan)' : 'var(--rose)';
          const label = isP1 ? 'P1' : 'P2';
          const isPassed = currentFrame >= shot.frame;
          return (
            <div 
              key={idx} 
              onClick={() => { setIsPlaying(false); onSeek(shot.frame); }}
              style={{
                display: 'flex', justifyContent: 'space-between', alignItems: 'center',
                padding: '4px 6px',
                background: isPassed ? 'rgba(255,255,255,0.08)' : 'rgba(255,255,255,0.02)',
                borderRadius: '6px',
                cursor: 'pointer',
                borderLeft: `2px solid ${color}`,
                transition: 'background 0.2s',
              }}
            >
              <span style={{ fontSize: '9px', color: '#fff', fontWeight: 600 }}>{label}</span>
              <span style={{ fontFamily: 'var(--font-mono)', fontSize: '10px', color: 'var(--accent)' }}>
                {shot.speed.toFixed(0)} <span style={{ fontSize: '7px', color: 'var(--text-muted)' }}>km/h</span>
              </span>
            </div>
          );
        })}
        {shots.length === 0 && (
          <div style={{ fontSize: '9px', color: 'var(--text-muted)', textAlign: 'center', padding: '10px 0' }}>No shots yet</div>
        )}
      </div>
    </div>
  );
}

export const AnalyticsSidebar: React.FC<AnalyticsSidebarProps> = React.memo(({
  ballSpeed, spinRate, frame, totalFrames, isServerAnalysis, distP1, distP2, rallyHits, shotHistory = [], onSeek = ()=>{}, setIsPlaying = ()=>{}
}) => {
  const classifySpeed = useMemo(() => {
    if (ballSpeed > 180) return { label: 'Smash', color: 'var(--rose)' };
    if (ballSpeed > 120) return { label: 'Fast', color: 'var(--amber)' };
    if (ballSpeed > 60) return { label: 'Medium', color: 'var(--accent)' };
    if (ballSpeed > 0) return { label: 'Slow', color: 'var(--cyan)' };
    return { label: 'Idle', color: 'var(--text-muted)' };
  }, [ballSpeed]);

  return (
    <div style={{
      position: 'absolute',
      right: '16px',
      top: '50%',
      transform: 'translateY(-50%)',
      zIndex: 15,
      display: 'flex',
      flexDirection: 'column',
      gap: '10px',
      alignItems: 'center',
      animation: 'slide-in-right 0.5s var(--ease-out-expo) 0.3s forwards',
      opacity: 0,
      width: '130px',
    }}>
      {/* Speed Gauge card */}
      <div style={{
        background: 'var(--bg-glass-heavy)',
        backdropFilter: 'blur(24px)',
        WebkitBackdropFilter: 'blur(24px)',
        border: '1px solid var(--border-light)',
        borderRadius: '18px',
        padding: '14px 10px 10px',
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        gap: '8px',
        width: '100%',
      }}>
        <SpeedGauge speed={ballSpeed} />
        {/* Speed classification badge */}
        <div style={{
          padding: '2px 10px',
          borderRadius: '999px',
          background: 'rgba(255,255,255,0.04)',
          border: `1px solid ${classifySpeed.color}33`,
          fontSize: '9px',
          fontWeight: 700,
          letterSpacing: '0.1em',
          textTransform: 'uppercase',
          color: classifySpeed.color,
          transition: 'color 0.5s ease, border-color 0.5s ease',
        }}>
          {classifySpeed.label}
        </div>
      </div>

      {/* Spin Rate card */}
      <div style={{
        background: 'var(--bg-glass-heavy)',
        backdropFilter: 'blur(24px)',
        WebkitBackdropFilter: 'blur(24px)',
        border: '1px solid var(--border-light)',
        borderRadius: '18px',
        padding: '14px 10px 10px',
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        gap: '8px',
        width: '100%',
      }}>
        <SpinRing rpm={spinRate} isServerAnalysis={isServerAnalysis} />
      </div>

      {/* Timeline mini card */}
      <div style={{
        background: 'var(--bg-glass-heavy)',
        backdropFilter: 'blur(24px)',
        WebkitBackdropFilter: 'blur(24px)',
        border: '1px solid var(--border-light)',
        borderRadius: '14px',
        padding: '12px',
        width: '100%',
      }}>
        <MiniTimeline frame={frame} total={totalFrames} />
      </div>

      {/* Match Stats card */}
      <div style={{
        background: 'var(--bg-glass-heavy)',
        backdropFilter: 'blur(24px)',
        WebkitBackdropFilter: 'blur(24px)',
        border: '1px solid var(--border-light)',
        borderRadius: '14px',
        padding: '12px',
        width: '100%',
      }}>
        {/* Pass shotHistory to calculate average speed */}
        <MatchStats distP1={distP1} distP2={distP2} rallyHits={rallyHits} avgSpeed={shotHistory.length ? shotHistory.reduce((a,b)=>a+b.speed,0)/shotHistory.length : 0} />
      </div>

      {/* Shot History card */}
      <div style={{
        background: 'var(--bg-glass-heavy)',
        backdropFilter: 'blur(24px)',
        WebkitBackdropFilter: 'blur(24px)',
        border: '1px solid var(--border-light)',
        borderRadius: '14px',
        padding: '12px',
        width: '100%',
      }}>
        <ShotHistoryCard shots={shotHistory} onSeek={onSeek} setIsPlaying={setIsPlaying} currentFrame={frame} />
      </div>
    </div>
  );
});

AnalyticsSidebar.displayName = 'AnalyticsSidebar';
