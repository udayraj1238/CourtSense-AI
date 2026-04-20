FROM python:3.10-slim

# Install system dependencies required for OpenCV
RUN apt-get update && apt-get install -y \
    libgl1-mesa-glx \
    libglib2.0-0 \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

# Install Python dependencies
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

# Copy application files
COPY courtsense_ai/ courtsense_ai/
COPY scripts/ scripts/
COPY backend/ backend/
COPY data/ data/

# Hugging Face Spaces expose port 7860 by default
ENV PORT=7860
EXPOSE 7860

# Start FastAPI server
CMD ["uvicorn", "backend.main:app", "--host", "0.0.0.0", "--port", "7860"]
