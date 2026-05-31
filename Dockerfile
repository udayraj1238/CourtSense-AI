FROM python:3.10-slim

# Install system dependencies for OpenCV and FFmpeg
RUN apt-get update && apt-get install -y \
    ffmpeg \
    libgl1-mesa-glx \
    libglib2.0-0 \
    && rm -rf /var/lib/apt/lists/*

# Set up a non-root user (Hugging Face Spaces requirement)
RUN useradd -m -u 1000 user
USER user
ENV PATH="/home/user/.local/bin:$PATH"

WORKDIR /app

# Copy requirements and install them
COPY --chown=user:user requirements/base.txt requirements/cv.txt requirements/ml-cpu.txt ./requirements/
RUN pip install --no-cache-dir -r requirements/base.txt -r requirements/cv.txt -r requirements/ml-cpu.txt

# Copy backend code
COPY --chown=user:user backend/ ./backend/

# Hugging Face exposes port 7860 by default for gradio, but we configure 8000 in README.md
EXPOSE 8000

CMD ["uvicorn", "backend.main:app", "--host", "0.0.0.0", "--port", "8000"]
