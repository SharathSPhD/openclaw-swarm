#!/usr/bin/env bash
set -euo pipefail

cd "$(dirname "$0")/.."
LOG_FILE="${SWARM_LOG:-/tmp/swarm-server.log}"

# Rotate log if > 50MB
if [ -f "$LOG_FILE" ] && [ "$(wc -c < "$LOG_FILE")" -gt 52428800 ]; then
  mv "$LOG_FILE" "${LOG_FILE}.1"
  echo "[run-swarm] Log rotated at $(date)" > "$LOG_FILE"
fi

while true; do
  echo "[run-swarm] Starting swarm server at $(date)..." | tee -a "$LOG_FILE"
  node --env-file .env src/server.js >> "$LOG_FILE" 2>&1
  EXIT_CODE=$?

  if [ "$EXIT_CODE" -eq 42 ]; then
    echo "[run-swarm] Exit code 42 = self-update restart. Restarting in 3s..." | tee -a "$LOG_FILE"
    sleep 3
    continue
  elif [ "$EXIT_CODE" -eq 0 ]; then
    echo "[run-swarm] Clean exit. Not restarting." | tee -a "$LOG_FILE"
    break
  else
    echo "[run-swarm] Crashed with exit code $EXIT_CODE. Restarting in 5s..." | tee -a "$LOG_FILE"
    sleep 5
    continue
  fi
done
