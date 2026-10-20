FROM node:24-bookworm-slim AS node
FROM python:3.12-slim-bookworm
WORKDIR /app
ENV PYTHONUNBUFFERED=1 MODEL_CACHE=/models WHISPER_MODEL=base WHISPER_THREADS=2
RUN apt-get update && apt-get install -y --no-install-recommends ffmpeg ca-certificates libstdc++6 && rm -rf /var/lib/apt/lists/*
COPY --from=node /usr/local/bin/node /usr/local/bin/node
COPY requirements.txt ./
RUN pip install --no-cache-dir -r requirements.txt
COPY adapters.py transcriber.py main.py probe.py ./
EXPOSE 8080
CMD ["python", "main.py"]
