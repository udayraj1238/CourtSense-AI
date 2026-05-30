import type {
  JobStatusResponse,
  JobUploadResponse,
  SequenceResponse,
} from '../types/tracking';
import { getApiBaseUrl } from '../types/tracking';

export async function uploadVideo(file: File): Promise<JobUploadResponse> {
  const base = getApiBaseUrl();
  const form = new FormData();
  form.append('file', file);

  const res = await fetch(`${base}/api/v2/jobs/upload`, {
    method: 'POST',
    body: form,
  });

  if (!res.ok) {
    const detail = await res.text();
    throw new Error(detail || `Upload failed (${res.status})`);
  }

  return res.json() as Promise<JobUploadResponse>;
}

export async function fetchJobStatus(jobId: string): Promise<JobStatusResponse> {
  const base = getApiBaseUrl();
  const res = await fetch(`${base}/api/v2/jobs/${jobId}/status`);
  if (!res.ok) {
    throw new Error(`Status check failed (${res.status})`);
  }
  return res.json() as Promise<JobStatusResponse>;
}

export async function fetchJobResult(jobId: string): Promise<SequenceResponse> {
  const base = getApiBaseUrl();
  const res = await fetch(`${base}/api/v2/jobs/${jobId}/result`);

  if (res.status === 202) {
    throw new Error('Job still processing');
  }

  if (!res.ok) {
    const detail = await res.text();
    throw new Error(detail || `Result fetch failed (${res.status})`);
  }

  return res.json() as Promise<SequenceResponse>;
}

export async function checkBackendHealth(): Promise<boolean> {
  try {
    const base = getApiBaseUrl();
    const res = await fetch(`${base}/health`, { signal: AbortSignal.timeout(5000) });
    return res.ok;
  } catch {
    return false;
  }
}
