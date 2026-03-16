#!/usr/bin/env bash
# start-vllm-multi.sh - Start vLLM server with configurable model selection
# Usage: ./scripts/start-vllm-multi.sh [--model <alias|id>] [--port <port>] [--list-models]
#
# Aliases (for GB10 Spark with ~120GB unified memory):
#   14b (default)  → nvidia/Qwen3-14B-NVFP4 (best coordinator)
#   8b             → nvidia/Qwen3-8B-NVFP4 (faster alternative)
#   llama-8b       → nvidia/Llama-3.1-8B-Instruct-NVFP4 (task-focused)
#   gpt-20b        → openai/gpt-oss-20b (fast+capable)
#   nemotron       → nvidia/NVIDIA-Nemotron-3-Super-120B-A12B-FP8 (120B MoE, uses 0.9 gpu-memory-utilization)
#
# Examples:
#   ./scripts/start-vllm-multi.sh --model 8b --port 8000
#   ./scripts/start-vllm-multi.sh --model llama-8b
#   ./scripts/start-vllm-multi.sh --list-models
#
# Requires: docker, NVIDIA Container Toolkit
# Image: nvcr.io/nvidia/vllm:25.12-py3 (CUDA Forward Compat, works with driver 580 on DGX Spark)
# Note: NVFP4 variants avoid CUDA stream capture issues on GB10; FP8 not recommended.

set -euo pipefail

# Model alias mappings
declare -A MODEL_ALIASES=(
  ["14b"]="nvidia/Qwen3-14B-NVFP4"
  ["8b"]="nvidia/Qwen3-8B-NVFP4"
  ["llama-8b"]="nvidia/Llama-3.1-8B-Instruct-NVFP4"
  ["gpt-20b"]="openai/gpt-oss-20b"
  ["nemotron"]="nvidia/NVIDIA-Nemotron-3-Super-120B-A12B-FP8"
)

# Model size -> GPU memory utilization mapping
declare -A GPU_MEM_UTIL=(
  ["nvidia/Qwen3-14B-NVFP4"]="0.7"
  ["nvidia/Qwen3-8B-NVFP4"]="0.5"
  ["nvidia/Llama-3.1-8B-Instruct-NVFP4"]="0.5"
  ["openai/gpt-oss-20b"]="0.6"
  ["nvidia/NVIDIA-Nemotron-3-Super-120B-A12B-FP8"]="0.9"
)

# Model size -> max model length mapping
declare -A MAX_MODEL_LEN=(
  ["nvidia/NVIDIA-Nemotron-3-Super-120B-A12B-FP8"]="32768"
)

# Defaults
MODEL="14b"
PORT="8000"
SHOW_MODELS=false

# Parse arguments
while [[ $# -gt 0 ]]; do
  case "$1" in
    --model)
      MODEL="$2"
      shift 2
      ;;
    --port)
      PORT="$2"
      shift 2
      ;;
    --list-models)
      SHOW_MODELS=true
      shift
      ;;
    *)
      echo "Unknown option: $1"
      exit 1
      ;;
  esac
done

# Handle --list-models
if [[ "$SHOW_MODELS" == "true" ]]; then
  echo "Supported vLLM models for GB10 Spark:"
  echo ""
  echo "Aliases:"
  for alias in "${!MODEL_ALIASES[@]}"; do
    model_id="${MODEL_ALIASES[$alias]}"
    mem_util="${GPU_MEM_UTIL[$model_id]:-0.7}"
    echo "  $alias"
    echo "    → $model_id"
    echo "    → GPU memory utilization: $mem_util"
  done
  echo ""
  echo "Full model IDs also accepted directly."
  echo ""
  echo "Examples:"
  echo "  ./scripts/start-vllm-multi.sh --model 14b"
  echo "  ./scripts/start-vllm-multi.sh --model nemotron --port 8001"
  echo "  ./scripts/start-vllm-multi.sh --model nvidia/Qwen3-14B-NVFP4"
  exit 0
fi

# Resolve alias to full model ID
if [[ -v MODEL_ALIASES[$MODEL] ]]; then
  RESOLVED_MODEL="${MODEL_ALIASES[$MODEL]}"
  echo "[vLLM] Resolved alias '$MODEL' → $RESOLVED_MODEL"
else
  RESOLVED_MODEL="$MODEL"
fi

# Determine GPU memory utilization
GPU_MEM="${GPU_MEM_UTIL[$RESOLVED_MODEL]:-0.7}"

# Check if max-model-len should be set
EXTRA_FLAGS=""
if [[ -v MAX_MODEL_LEN[$RESOLVED_MODEL] ]]; then
  MAX_LEN="${MAX_MODEL_LEN[$RESOLVED_MODEL]}"
  EXTRA_FLAGS="--max-model-len $MAX_LEN"
fi

CONTAINER_NAME="vllm-server"
IMAGE="nvcr.io/nvidia/vllm:25.12-py3"

echo "[vLLM] Starting Docker-based vLLM server"
echo "[vLLM] Model: $RESOLVED_MODEL (alias: $MODEL)"
echo "[vLLM] Port: $PORT"
echo "[vLLM] GPU Memory Utilization: $GPU_MEM"
if [[ -n "$EXTRA_FLAGS" ]]; then
  echo "[vLLM] Extra flags: $EXTRA_FLAGS"
fi
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
# Build the vllm serve command with conditional extra flags
if [[ -n "$EXTRA_FLAGS" ]]; then
  docker run -d \
    --gpus all \
    --ipc=host \
    --ulimit memlock=-1 \
    --ulimit stack=67108864 \
    -p "${PORT}:8000" \
    --name "$CONTAINER_NAME" \
    --restart unless-stopped \
    "$IMAGE" \
    vllm serve "$RESOLVED_MODEL" --enforce-eager --gpu-memory-utilization "$GPU_MEM" --enable-auto-tool-choice --tool-call-parser hermes $EXTRA_FLAGS
else
  docker run -d \
    --gpus all \
    --ipc=host \
    --ulimit memlock=-1 \
    --ulimit stack=67108864 \
    -p "${PORT}:8000" \
    --name "$CONTAINER_NAME" \
    --restart unless-stopped \
    "$IMAGE" \
    vllm serve "$RESOLVED_MODEL" --enforce-eager --gpu-memory-utilization "$GPU_MEM" --enable-auto-tool-choice --tool-call-parser hermes
fi

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
