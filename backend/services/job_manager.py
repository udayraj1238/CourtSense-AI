import asyncio
import json
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Callable, Awaitable

import aiosqlite

from backend.config import Settings, get_settings
from backend.services import storage

ProgressCallback = Callable[[str, int, int, int, int], Awaitable[None]]
# stage_name, stage_pct, overall_pct, frames_total, frames_processed


def _utc_now() -> str:
    return datetime.now(timezone.utc).isoformat()


class JobManager:
    def __init__(self, settings: Settings | None = None) -> None:
        self.settings = settings or get_settings()
        self._cleanup_task: asyncio.Task | None = None
        self._running_jobs: set[str] = set()

    async def init_db(self) -> None:
        async with aiosqlite.connect(self.settings.jobs_db_path) as db:
            await db.execute(
                """
                CREATE TABLE IF NOT EXISTS jobs (
                    id TEXT PRIMARY KEY,
                    status TEXT NOT NULL,
                    progress INTEGER NOT NULL DEFAULT 0,
                    stage TEXT,
                    stage_progress INTEGER NOT NULL DEFAULT 0,
                    frames_total INTEGER NOT NULL DEFAULT 0,
                    frames_processed INTEGER NOT NULL DEFAULT 0,
                    error TEXT,
                    calibration_failed INTEGER NOT NULL DEFAULT 0,
                    upload_path TEXT,
                    homography_json TEXT,
                    preview_path TEXT,
                    created_at TEXT NOT NULL,
                    updated_at TEXT NOT NULL
                )
                """
            )
            await self._migrate_columns(db)
            await db.commit()

    async def _migrate_columns(self, db: aiosqlite.Connection) -> None:
        async with db.execute("PRAGMA table_info(jobs)") as cursor:
            cols = {row[1] for row in await cursor.fetchall()}
        if "homography_json" not in cols:
            await db.execute("ALTER TABLE jobs ADD COLUMN homography_json TEXT")
        if "preview_path" not in cols:
            await db.execute("ALTER TABLE jobs ADD COLUMN preview_path TEXT")

    async def start_cleanup_loop(self) -> None:
        if self._cleanup_task is None:
            self._cleanup_task = asyncio.create_task(self._cleanup_loop())

    async def stop_cleanup_loop(self) -> None:
        if self._cleanup_task:
            self._cleanup_task.cancel()
            try:
                await self._cleanup_task
            except asyncio.CancelledError:
                pass
            self._cleanup_task = None

    async def _cleanup_loop(self) -> None:
        while True:
            try:
                await self.cleanup_expired_jobs()
            except Exception:
                pass
            await asyncio.sleep(self.settings.cleanup_interval_seconds)

    async def cleanup_expired_jobs(self) -> None:
        cutoff = datetime.now(timezone.utc).timestamp() - self.settings.job_ttl_seconds
        async with aiosqlite.connect(self.settings.jobs_db_path) as db:
            db.row_factory = aiosqlite.Row
            async with db.execute("SELECT * FROM jobs") as cursor:
                rows = await cursor.fetchall()
            for row in rows:
                created = datetime.fromisoformat(row["created_at"])
                if created.timestamp() > cutoff:
                    continue
                if row["status"] in ("completed", "failed", "expired", "calibration_required"):
                    storage.delete_job_files(
                        self.settings, row["id"], row["upload_path"]
                    )
                    await db.execute(
                        "UPDATE jobs SET status = 'expired', updated_at = ? WHERE id = ?",
                        (_utc_now(), row["id"]),
                    )
            await db.commit()

    async def create_job(self, job_id: str, upload_path: Path) -> str:
        now = _utc_now()
        async with aiosqlite.connect(self.settings.jobs_db_path) as db:
            await db.execute(
                """
                INSERT INTO jobs (id, status, upload_path, created_at, updated_at)
                VALUES (?, 'queued', ?, ?, ?)
                """,
                (job_id, str(upload_path), now, now),
            )
            await db.commit()
        return job_id

    async def get_job(self, job_id: str) -> dict[str, Any] | None:
        async with aiosqlite.connect(self.settings.jobs_db_path) as db:
            db.row_factory = aiosqlite.Row
            async with db.execute("SELECT * FROM jobs WHERE id = ?", (job_id,)) as cursor:
                row = await cursor.fetchone()
                return dict(row) if row else None

    async def update_job(self, job_id: str, **fields: Any) -> None:
        if not fields:
            return
        fields["updated_at"] = _utc_now()
        cols = ", ".join(f"{k} = ?" for k in fields)
        values = list(fields.values()) + [job_id]
        async with aiosqlite.connect(self.settings.jobs_db_path) as db:
            await db.execute(f"UPDATE jobs SET {cols} WHERE id = ?", values)
            await db.commit()

    async def enqueue_processing(
        self,
        job_id: str,
        processor: Callable[[str, ProgressCallback], Awaitable[None]],
        *,
        skip_if_completed: bool = False,
    ) -> None:
        if job_id in self._running_jobs:
            return

        if skip_if_completed:
            job = await self.get_job(job_id)
            if job and job.get("status") == "completed":
                return

        self._running_jobs.add(job_id)

        async def _run() -> None:
            try:
                job = await self.get_job(job_id)
                if job and job.get("homography_json") and job.get("status") == "calibration_required":
                    await self.update_job(
                        job_id,
                        status="processing",
                        calibration_failed=0,
                        error=None,
                    )
                elif not job or job.get("status") not in ("processing",):
                    await self.update_job(job_id, status="processing", progress=0, stage="ingest")

                async def on_progress(
                    stage: str,
                    stage_pct: int,
                    overall_pct: int,
                    frames_total: int,
                    frames_processed: int,
                ) -> None:
                    await self.update_job(
                        job_id,
                        stage=stage,
                        stage_progress=stage_pct,
                        progress=overall_pct,
                        frames_total=frames_total,
                        frames_processed=frames_processed,
                    )

                await processor(job_id, on_progress)
                await self.update_job(job_id, status="completed", progress=100, stage="done")
            except CalibrationRequiredError as exc:
                await self.update_job(
                    job_id,
                    status="calibration_required",
                    calibration_failed=1,
                    error=str(exc),
                    stage="calibration",
                )
            except Exception as exc:
                await self.update_job(
                    job_id,
                    status="failed",
                    error=str(exc),
                )
            finally:
                self._running_jobs.discard(job_id)

        asyncio.create_task(_run())

    async def load_stub_sequence(self) -> dict:
        path = self.settings.stub_demo_json
        if not path.exists():
            raise FileNotFoundError(
                f"Stub demo JSON not found at {path}. Run: node scripts/generate_demo_from_video.mjs"
            )
        return json.loads(path.read_text(encoding="utf-8"))


class CalibrationRequiredError(Exception):
    """Raised when auto court calibration fails; frontend prompts manual corners."""


_job_manager: JobManager | None = None


def get_job_manager() -> JobManager:
    global _job_manager
    if _job_manager is None:
        _job_manager = JobManager()
    return _job_manager
