import asyncio
from backend.pipeline.orchestrator import run_pipeline
from backend.services.job_manager import get_job_manager
from backend.config import get_settings
from pathlib import Path
import shutil

async def test_pipeline():
    settings = get_settings()
    job_id = "test_job_123"
    
    # We need a video file. Let's find one in the repo or create a dummy job.
    # The user has some video uploaded before, but we don't have the uploads dir here.
    # Let's just create a dummy video or find one.
    pass

if __name__ == "__main__":
    asyncio.run(test_pipeline())
