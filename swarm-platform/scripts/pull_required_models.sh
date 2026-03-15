#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
ROUTING_FILE="$ROOT_DIR/data/model_routing.json"

if ! command -v ollama >/dev/null 2>&1; then
  echo "ollama is not installed or not in PATH"
  exit 1
fi

if [[ ! -f "$ROUTING_FILE" ]]; then
  echo "missing routing file: $ROUTING_FILE"
  exit 1
fi

mapfile -t MODELS < <(node -e "const fs=require('fs');const r=JSON.parse(fs.readFileSync(process.argv[1],'utf8'));for(const m of (r.requiredModels||[])){console.log(m)}" "$ROUTING_FILE")

if [[ ${#MODELS[@]} -eq 0 ]]; then
  echo "no required models defined"
  exit 1
fi

PULL_TIMEOUT_SEC="${PULL_TIMEOUT_SEC:-2400}"
SUCCESS=()
FAILED=()

echo "Pulling required models (${#MODELS[@]}) with timeout=${PULL_TIMEOUT_SEC}s..."
for model in "${MODELS[@]}"; do
  echo "[pull] $model"
  if timeout "$PULL_TIMEOUT_SEC" ollama pull "$model"; then
    SUCCESS+=("$model")
  else
    echo "[warn] failed to pull $model"
    FAILED+=("$model")
  fi
done

echo "Model pull complete"
echo "success=${#SUCCESS[@]} failed=${#FAILED[@]}"
if [[ ${#FAILED[@]} -gt 0 ]]; then
  echo "failed models: ${FAILED[*]}"
fi
ollama list
