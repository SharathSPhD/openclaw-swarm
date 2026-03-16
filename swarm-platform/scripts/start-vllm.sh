#!/usr/bin/env bash
# start-vllm.sh - Start vLLM server via NVIDIA official Docker container
# Usage: ./scripts/start-vllm.sh [model_id] [port]
#
# Default: nvidia/Qwen3-14B-FP8 on port 8000
# Requires: docker, NVIDIA Container Toolkit
# Image: nvcr.io/nvidia/vllm:25.11-py3 (requires driver 570+, works on DGX Spark)
#
# Supported models (from https://build.nvidia.com/spark/vllm):
#   nvidia/Qwen3-14B-FP8         - Best coordinator/evaluator model
#   nvidia/Qwen3-8B-FP8          - Faster alternative
#   nvidia/Llama-3.1-8B-Instruct-FP8
#   nvidia/Nemotron-Super-49B-v1-FP8

set -euo pipefail

MODEL="${1:-nvidia/Qwen3-14B-FP8}"
PORT="${2:-8000}"
CONTAINER_NAME="vllm-server"
IMAGE="nvcr.io/nvidia/vllm:25.11-py3"

echo "[vLLM] Starting Docker-based vLLM server"
echo "[vLLM] Model: $MODEL  Port: $PORT"
echo "[vLLM] Image: $IMAGE"

# Check if port already in use
if lsof -i ":$PORT" >/dev/null 2>&1; then
  echo "[vLLM] Port $PORT already in use. Server may already be running."
  echo "       Test: curl http://127.0.0.1:$PORT/health"
  exit 0
fi

# Stop existing container if present
docker rm -f "$CONTAINER_NAME" 2>/dev/null || true

echo "[vLLM] Launching container..."
docker run -d \
  --gpus all \
  --ipc=host \
  --ulimit memlock=-1 \
  --ulimit stack=67108864 \
  -p "${PORT}:8000" \
  --name "$CONTAINER_NAME" \
  --restart unless-stopped \
  "$IMAGE" \
  vllm serve "$MODEL" --enforce-eager

echo "[vLLM] Container started. Waiting for readiness..."
for i in $(seq 1 60); do
  if curl -sf "http://127.0.0.1:${PORT}/health" >/dev/null 2>&1; then
    echo "[vLLM] Server ready at http://127.0.0.1:${PORT}/v1"
    echo "[vLLM] Test: curl http://127.0.0.1:${PORT}/v1/models"
    exit 0
  fi
  sleep 5
done
echo "[vLLM] WARNING: Server did not become ready in 5 minutes."
echo "       Check logs: docker logs $CONTAINER_NAME"
