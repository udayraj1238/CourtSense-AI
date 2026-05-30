import json
import shutil
from pathlib import Path

from backend.config import Settings


def save_upload(settings: Settings, job_id: str, src_path: Path, suffix: str) -> Path:
    dest = settings.uploads_dir / f"{job_id}{suffix}"
    shutil.copy2(src_path, dest)
    return dest


def normalized_video_path(settings: Settings, job_id: str) -> Path:
    return settings.uploads_dir / f"{job_id}_normalized.mp4"


def result_json_path(settings: Settings, job_id: str) -> Path:
    return settings.results_dir / f"{job_id}.json"


def write_result(settings: Settings, job_id: str, payload: dict) -> Path:
    path = result_json_path(settings, job_id)
    path.write_text(json.dumps(payload), encoding="utf-8")
    return path


def read_result(settings: Settings, job_id: str) -> dict | None:
    path = result_json_path(settings, job_id)
    if not path.exists():
        return None
    return json.loads(path.read_text(encoding="utf-8"))


def delete_job_files(settings: Settings, job_id: str, upload_path: str | None) -> None:
    if upload_path:
        p = Path(upload_path)
        if p.exists():
            p.unlink(missing_ok=True)
    norm = normalized_video_path(settings, job_id)
    if norm.exists():
        norm.unlink(missing_ok=True)
    result = result_json_path(settings, job_id)
    if result.exists():
        result.unlink(missing_ok=True)
