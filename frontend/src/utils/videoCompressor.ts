/**
 * Browser-based video compressor using HTMLVideoElement + Canvas + MediaRecorder.
 * Caps resolution at 720p (1280×720), maintains aspect ratio, limits to 30s,
 * re-encodes as WebM at ~2 Mbps. Falls back to original file if unsupported.
 */

const MAX_WIDTH = 1280;
const MAX_HEIGHT = 720;
const MAX_DURATION_S = 30;
const TARGET_BITRATE = 2_000_000; // 2 Mbps
const FPS = 30;

export async function compressVideo(
  file: File,
  onProgress?: (pct: number) => void,
): Promise<Blob> {
  // Feature check — bail early if MediaRecorder or canvas capture aren't available
  if (
    typeof MediaRecorder === 'undefined' ||
    !('captureStream' in HTMLCanvasElement.prototype)
  ) {
    console.warn('compressVideo: MediaRecorder / captureStream not supported — returning original file.');
    return file;
  }

  return new Promise<Blob>((resolve, reject) => {
    const video = document.createElement('video');
    video.muted = true;
    video.playsInline = true;
    video.preload = 'auto';

    const objectUrl = URL.createObjectURL(file);
    video.src = objectUrl;

    const cleanup = () => {
      video.pause();
      video.removeAttribute('src');
      video.load();
      URL.revokeObjectURL(objectUrl);
    };

    video.addEventListener('error', () => {
      cleanup();
      reject(new Error('compressVideo: failed to load video element'));
    });

    video.addEventListener('loadedmetadata', () => {
      // --- Determine output dimensions (cap at 720p, maintain ratio) ---
      const srcW = video.videoWidth;
      const srcH = video.videoHeight;
      let outW = srcW;
      let outH = srcH;

      if (srcW > MAX_WIDTH || srcH > MAX_HEIGHT) {
        const scale = Math.min(MAX_WIDTH / srcW, MAX_HEIGHT / srcH);
        outW = Math.round(srcW * scale);
        outH = Math.round(srcH * scale);
      }

      // Ensure even dimensions (required by many codecs)
      outW = outW % 2 === 0 ? outW : outW - 1;
      outH = outH % 2 === 0 ? outH : outH - 1;

      // --- Duration cap ---
      const duration = Math.min(video.duration || MAX_DURATION_S, MAX_DURATION_S);

      // --- Canvas setup ---
      const canvas = document.createElement('canvas');
      canvas.width = outW;
      canvas.height = outH;
      const ctx = canvas.getContext('2d');
      if (!ctx) {
        cleanup();
        reject(new Error('compressVideo: could not get canvas 2d context'));
        return;
      }

      // --- MediaRecorder setup ---
      let stream: MediaStream;
      try {
        stream = (canvas as any).captureStream(FPS) as MediaStream;
      } catch {
        cleanup();
        resolve(file); // fallback
        return;
      }

      let recorder: MediaRecorder;
      try {
        recorder = new MediaRecorder(stream, {
          mimeType: 'video/webm',
          videoBitsPerSecond: TARGET_BITRATE,
        });
      } catch {
        // Some browsers may not support webm — try without specifying mimeType
        try {
          recorder = new MediaRecorder(stream);
        } catch {
          cleanup();
          resolve(file); // fallback
          return;
        }
      }

      const chunks: Blob[] = [];
      recorder.ondataavailable = (e) => {
        if (e.data.size > 0) chunks.push(e.data);
      };

      recorder.onstop = () => {
        cleanup();
        const blob = new Blob(chunks, { type: recorder.mimeType || 'video/webm' });
        resolve(blob);
      };

      recorder.onerror = () => {
        cleanup();
        resolve(file); // fallback
      };

      // --- Frame-by-frame draw loop ---
      let stopped = false;

      const drawFrame = () => {
        if (stopped) return;

        // Progress reporting
        if (onProgress && duration > 0) {
          const pct = Math.min(100, (video.currentTime / duration) * 100);
          onProgress(pct);
        }

        // Check if we've exceeded duration cap
        if (video.currentTime >= duration) {
          stopped = true;
          recorder.stop();
          return;
        }

        ctx.drawImage(video, 0, 0, outW, outH);
        requestAnimationFrame(drawFrame);
      };

      // Start recording once video is playing
      video.addEventListener('play', () => {
        recorder.start(100); // collect data every 100ms
        drawFrame();
      });

      // When video ends naturally (shorter than 30s)
      video.addEventListener('ended', () => {
        if (!stopped) {
          stopped = true;
          // Draw the last frame
          ctx.drawImage(video, 0, 0, outW, outH);
          if (onProgress) onProgress(100);
          recorder.stop();
        }
      });

      // Kick off playback
      video.currentTime = 0;
      video.play().catch(() => {
        cleanup();
        resolve(file); // fallback — autoplay blocked etc.
      });
    });
  });
}
