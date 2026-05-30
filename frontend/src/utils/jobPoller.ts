import { fetchJobResult, fetchJobStatus } from './apiClient';
import type { JobStatusResponse, SequenceResponse } from '../types/tracking';

export type JobProgressCb = (label: string, pct: number, status: JobStatusResponse) => void;

export class CalibrationNeededError extends Error {
  readonly jobId: string;

  constructor(jobId: string, message?: string) {
    super(message ?? 'Manual court calibration required.');
    this.name = 'CalibrationNeededError';
    this.jobId = jobId;
  }
}

const STAGE_LABELS: Record<string, string> = {
  ingest: 'Loading video',
  calibration: 'Detecting court',
  ball_tracking: 'Tracking ball',
  player_tracking: 'Tracking players',
  analytics: 'Building 3D replay',
  done: 'Done!',
};

function stageLabel(stage: string | null): string {
  if (!stage) return 'Processing…';
  return STAGE_LABELS[stage] ?? stage;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export async function pollJobUntilComplete(
  jobId: string,
  onProgress: JobProgressCb,
): Promise<SequenceResponse> {
  const started = Date.now();
  let intervalMs = 2000;

  while (true) {
    const status = (await fetchJobStatus(jobId)) as JobStatusResponse;
    onProgress(stageLabel(status.stage), status.progress, status);

    if (status.status === 'completed') {
      return fetchJobResult(jobId);
    }

    if (status.status === 'calibration_required' || status.calibration_failed) {
      throw new CalibrationNeededError(jobId, status.error ?? undefined);
    }

    if (status.status === 'failed') {
      throw new Error(status.error ?? 'Server processing failed.');
    }

    if (status.status === 'expired') {
      throw new Error('Job expired. Please upload again.');
    }

    const elapsed = Date.now() - started;
    if (elapsed > 60_000) {
      intervalMs = Math.min(intervalMs * 2, 15_000);
    }

    await sleep(intervalMs);
  }
}
