# Python Tailoring Service Dockerfile
FROM python:3.12-slim

WORKDIR /app

# Install system dependencies
RUN apt-get update && apt-get install -y \
    gcc \
    && rm -rf /var/lib/apt/lists/*

# Install Python dependencies
COPY pyproject.toml .
RUN pip install --no-cache-dir \
    fastapi>=0.115.0 \
    uvicorn[standard]>=0.32.0 \
    instructor>=1.6.0 \
    prefect>=3.0.0 \
    pydantic>=2.9.0 \
    httpx>=0.27.0 \
    python-dotenv>=1.0.0 \
    diskcache>=5.6.0

# FORCE REINSTALL with cache busting
RUN pip install --no-cache-dir --upgrade --force-reinstall google-genai>=1.2.0

# Copy source code
COPY src/ ./src/

# Create data directory and ensure it is writable
RUN mkdir -p /app/data && chmod 777 /app/data

# Set environment variables
ENV PYTHONPATH=/app/src
ENV PYTHONUNBUFFERED=1
ENV CACHE_PATH=/tmp/cache.db

# Expose port
EXPOSE 8000

# Run the application
CMD ["uvicorn", "src.main:app", "--host", "0.0.0.0", "--port", "8000"]
