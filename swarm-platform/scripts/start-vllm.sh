#!/usr/bin/env bash
# start-vllm.sh - Start vLLM OpenAI-compatible server on DGX Spark GB10
# Usage: ./scripts/start-vllm.sh [model_id] [port]
#
# Default: Qwen/Qwen2.5-14B-Instruct on port 8000
# Once running, configure openclaw.json with:
#   "dgx-llm": { "baseUrl": "http://127.0.0.1:8000/v1", ... }

set -euo pipefail

MODEL="${1:-Qwen/Qwen2.5-14B-Instruct}"
PORT="${2:-8000}"
VENV="${HOME}/vllm-env"
HF_CACHE="${HOME}/.cache/huggingface"

echo "[vLLM] Starting server for model: $MODEL on port $PORT"
echo "[vLLM] CUDA: $(nvcc --version 2>/dev/null | grep release | head -1 || echo 'check nvcc')"
echo "[vLLM] venv: $VENV"

if [ ! -f "$VENV/bin/python" ]; then
  echo "[vLLM] ERROR: venv not found at $VENV"
  echo "       Run: python3 -m venv ~/vllm-env --copies && ~/vllm-env/bin/pip install vllm==0.17.1"
  exit 1
fi

if ! "$VENV/bin/python" -c "import vllm" 2>/dev/null; then
  echo "[vLLM] Installing vLLM..."
  "$VENV/bin/pip" install vllm==0.17.1 -q
fi

# Check if port already in use
if lsof -i ":$PORT" >/dev/null 2>&1; then
  echo "[vLLM] Port $PORT already in use. Server may already be running."
  echo "       Test: curl http://127.0.0.1:$PORT/health"
  exit 0
fi

echo "[vLLM] Launching OpenAI-compatible API server..."
echo "[vLLM] Endpoint will be: http://127.0.0.1:$PORT/v1"
echo "[vLLM] Expected throughput: ~70 tok/s for 14B on GB10 (vs ~10 tok/s Ollama)"

exec "$VENV/bin/python" -m vllm.entrypoints.openai.api_server \
  --model "$MODEL" \
  --host 127.0.0.1 \
  --port "$PORT" \
  --dtype auto \
  --max-model-len 32768 \
  --gpu-memory-utilization 0.7 \
  --trust-remote-code \
  --served-model-name "$MODEL" \
  2>&1 | tee "/tmp/vllm-server-$(date +%Y%m%d-%H%M%S).log"
