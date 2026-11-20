# One container: Node web app + Python ECAPA speaker service (CPU only).
# Build:  docker build -t voice-banking .
# Run:    docker run -p 7860:7860 -e SESSION_SECRET=change-me voice-banking     then open http://localhost:7860
FROM node:20-bookworm-slim

ENV DEBIAN_FRONTEND=noninteractive PIP_NO_CACHE_DIR=1 PYTHONUNBUFFERED=1
RUN apt-get update \
 && apt-get install -y --no-install-recommends python3 python3-venv python3-pip ffmpeg libsndfile1 ca-certificates \
 && rm -rf /var/lib/apt/lists/*

WORKDIR /app

# Python dependencies first (cached layer). CPU-only PyTorch keeps the image much smaller than the CUDA build.
COPY ml/requirements.txt ml/requirements.txt
RUN python3 -m venv /opt/venv \
 && /opt/venv/bin/pip install --upgrade pip \
 && /opt/venv/bin/pip install torch==2.9.1 torchaudio==2.9.1 --index-url https://download.pytorch.org/whl/cpu \
 && /opt/venv/bin/pip install -r ml/requirements.txt

COPY package.json package-lock.json ./
RUN npm ci --omit=dev || npm install --omit=dev

COPY . .

# Download the pretrained ECAPA model into the image so the first request is fast.
RUN /opt/venv/bin/python -c "from ml.service.speaker import SpeakerVerifier; SpeakerVerifier()"

# /data holds the JSON database (users, voice profiles, audit log). Mount a volume here to keep data between restarts.
RUN mkdir -p /data && chown -R node:node /app /data
USER node

ENV PORT=7860 \
    SPEAKER_SERVICE_URL=http://127.0.0.1:5005 \
    STT_SERVICE_URL= \
    STORE_FILE=/data/store.json \
    TRUST_PROXY=1 \
    COOKIE_SECURE=true
# Set SESSION_SECRET (random, 32+ chars) as an environment variable / secret at run time.
EXPOSE 7860
CMD ["bash", "deploy/start.sh"]
