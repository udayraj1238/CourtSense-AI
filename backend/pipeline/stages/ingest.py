import json
import subprocess
from dataclasses import dataclass
from pathlib import Path

from backend.config import Settings, get_settings


class IngestError(Exception):
    pass


class VideoTooLongError(IngestError):
    pass


class FFmpegNotFoundError(IngestError):
    pass


@dataclass
class IngestResult:
    normalized_path: Path
    duration_sec: float
    native_fps: float
    frame_count: int
    width: int
    height: int


def _run(cmd: list[str]) -> subprocess.CompletedProcess[str]:
    try:
        return subprocess.run(cmd, capture_output=True, text=True, check=True)
    except FileNotFoundError as exc:
        raise FFmpegNotFoundError(
            "FFmpeg/ffprobe not found. Install FFmpeg and add it to PATH."
        ) from exc
    except subprocess.CalledProcessError as exc:
        raise IngestError(exc.stderr or exc.stdout or str(exc)) from exc


def probe_video(path: Path) -> dict:
    result = _run(
        [
            "ffprobe",
            "-v",
            "quiet",
            "-print_format",
            "json",
            "-show_format",
            "-show_streams",
            str(path),
        ]
    )
    return json.loads(result.stdout)


def _parse_fps(rate: str) -> float:
    if not rate or rate == "0/0":
        return 30.0
    if "/" in rate:
        num, den = rate.split("/", 1)
        den_f = float(den)
        return float(num) / den_f if den_f else 30.0
    return float(rate)


def ingest_video(
    input_path: Path,
    job_id: str,
    settings: Settings | None = None,
) -> IngestResult:
    """
    Gate on duration via ffprobe, then normalize to exactly 30fps (max 30s).
    Must run before any CV stage.
    """
    settings = settings or get_settings()
    meta = probe_video(input_path)

    duration = float(meta.get("format", {}).get("duration", 0))
    if duration > settings.max_video_duration_sec + 0.05:
        raise VideoTooLongError(
            f"Video duration {duration:.1f}s exceeds maximum "
            f"{settings.max_video_duration_sec}s"
        )

    video_stream = next(
        (s for s in meta.get("streams", []) if s.get("codec_type") == "video"),
        {},
    )
    native_fps = _parse_fps(video_stream.get("avg_frame_rate", "30/1"))
    width = int(video_stream.get("width", 0))
    height = int(video_stream.get("height", 0))

    output_path = settings.uploads_dir / f"{job_id}_normalized.mp4"
    _run(
        [
            "ffmpeg",
            "-y",
            "-i",
            str(input_path),
            "-t",
            str(settings.max_video_duration_sec),
            "-r",
            str(settings.output_fps),
            "-vf",
            "scale=min(1920\\,iw):-2",
            "-c:v",
            "libx264",
            "-preset",
            "fast",
            "-an",
            str(output_path),
        ]
    )

    out_meta = probe_video(output_path)
    out_duration = float(out_meta.get("format", {}).get("duration", duration))
    
    out_stream = next(
        (s for s in out_meta.get("streams", []) if s.get("codec_type") == "video"),
        {},
    )
    actual_fps = _parse_fps(out_stream.get("r_frame_rate", "30/1"))
    
    nb_frames = out_stream.get("nb_frames")
    if nb_frames is not None:
        frame_count = int(nb_frames)
    else:
        frame_count = int(round(out_duration * actual_fps))

    return IngestResult(
        normalized_path=output_path,
        duration_sec=out_duration,
        native_fps=actual_fps,
        frame_count=frame_count,
        width=width,
        height=height,
    )
