#!/usr/bin/env bash
# start-vllm.sh - Start vLLM server via NVIDIA official Docker container
# Usage: ./scripts/start-vllm.sh [model_id] [port]
#
# Default: nvidia/Qwen3-14B-FP8 on port 8000
# Requires: docker, NVIDIA Container Toolkit
# Image: nvcr.io/nvidia/vllm:25.12-py3 (CUDA Forward Compat, works with driver 580 on DGX Spark)
# Note: FP8 models have CUDA stream capture issues on GB10; use NVFP4 variants instead.
#
# Supported models (from https://build.nvidia.com/spark/vllm):
#   nvidia/NVIDIA-Nemotron-3-Super-120B-A12B-FP8  - MoE 120B (12B active) - best quality
#   openai/gpt-oss-120b           - 120B MXFP4 - high quality
#   openai/gpt-oss-20b            - 20B MXFP4 - fast+capable
#   nvidia/Qwen3-14B-NVFP4        - CURRENTLY LOADED - best coordinator (default)
#   nvidia/Qwen3-8B-NVFP4         - Faster alternative
#   nvidia/Llama-3.1-8B-Instruct-NVFP4

set -euo pipefail

MODEL="${1:-nvidia/Qwen3-14B-NVFP4}"
PORT="${2:-8000}"
CONTAINER_NAME="vllm-server"
IMAGE="nvcr.io/nvidia/vllm:25.12-py3"

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
# NOTE: For 120B models, use --gpu-memory-utilization 0.9 --max-model-len 32768
docker run -d \
  --gpus all \
  --ipc=host \
  --ulimit memlock=-1 \
  --ulimit stack=67108864 \
  -p "${PORT}:8000" \
  --name "$CONTAINER_NAME" \
  --restart unless-stopped \
  "$IMAGE" \
  vllm serve "$MODEL" --enforce-eager --gpu-memory-utilization 0.7 --enable-auto-tool-choice --tool-call-parser hermes

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
