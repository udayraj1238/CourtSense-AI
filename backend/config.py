from functools import lru_cache
from pathlib import Path

from pydantic_settings import BaseSettings, SettingsConfigDict

REPO_ROOT = Path(__file__).resolve().parent.parent


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=".env", extra="ignore")

    app_name: str = "CourtSense AI API"
    debug: bool = False

    cors_origins: list[str] = [
        "http://localhost:5173",
        "http://127.0.0.1:5173",
        "https://udayraj1238.github.io",
    ]

    data_dir: Path = REPO_ROOT / "backend" / "data"
    jobs_db_path: Path = REPO_ROOT / "backend" / "data" / "jobs.db"
    uploads_dir: Path = REPO_ROOT / "backend" / "data" / "uploads"
    results_dir: Path = REPO_ROOT / "backend" / "data" / "results"

    job_ttl_seconds: int = 3600
    cleanup_interval_seconds: int = 300

    max_upload_bytes: int = 100 * 1024 * 1024
    max_video_duration_sec: float = 30.0
    output_fps: int = 30

    stub_demo_json: Path = REPO_ROOT / "frontend" / "public" / "demo_data.json"

    # Stub pipeline simulates CV work (seconds). Set 0 for instant response in tests.
    stub_processing_delay_sec: float = 2.0


@lru_cache
def get_settings() -> Settings:
    settings = Settings()
    settings.data_dir.mkdir(parents=True, exist_ok=True)
    settings.uploads_dir.mkdir(parents=True, exist_ok=True)
    settings.results_dir.mkdir(parents=True, exist_ok=True)
    return settings
