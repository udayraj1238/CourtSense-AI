export interface Coordinate {
  x: number;
  y: number;
  z: number;
}

export interface PlayerState {
  id: 'player_bottom' | 'player_top' | string;
  position: Coordinate;
}

export interface BallState {
  position: Coordinate;
  is_occluded: boolean;
}

export interface ProcFrameData {
  frame_index: number;
  ball: BallState;
  players: PlayerState[];
  ball_speed_kmh: number;
  spin_rate_rpm?: number;
  hitter?: 'p1' | 'p2' | null;
  shot_type?: string;
}

export interface SequenceResponse {
  sequence: ProcFrameData[];
}

export type JobStatus =
  | 'queued'
  | 'processing'
  | 'completed'
  | 'failed'
  | 'calibration_required'
  | 'expired';

export interface JobStatusResponse {
  job_id: string;
  status: JobStatus;
  progress: number;
  stage: string | null;
  stage_progress: number;
  frames_total: number;
  frames_processed: number;
  error: string | null;
  calibration_failed: boolean;
}

export interface JobUploadResponse {
  job_id: string;
  status: 'queued';
  message: string;
}

/** True when VITE_API_URL is set (local dev or production HF backend). */
export function isServerProcessingEnabled(): boolean {
  const url = import.meta.env.VITE_API_URL as string | undefined;
  return Boolean(url && url.trim().length > 0);
}

export function getApiBaseUrl(): string {
  const url = (import.meta.env.VITE_API_URL as string | undefined)?.trim();
  if (!url) throw new Error('VITE_API_URL is not configured');
  return url.replace(/\/$/, '');
}
