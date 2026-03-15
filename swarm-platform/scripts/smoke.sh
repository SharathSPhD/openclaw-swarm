#!/usr/bin/env bash
set -euo pipefail

base_url="${1:-http://127.0.0.1:3010}"
key="${ADMIN_API_KEY:-}"

echo "health"
curl -s "$base_url/api/health" | cat

echo
echo "dispatch"
curl -s -X POST "$base_url/api/orchestrator/dispatch" \
  -H "Content-Type: application/json" \
  ${key:+-H "x-api-key: $key"} \
  -d '{"teamId":"team-alpha","task":"Implement secure task queue and review with tests","actorRole":"team-lead"}' | cat

echo
echo "leaderboard"
curl -s "$base_url/api/leaderboard" | cat

echo
echo "queue"
curl -s "$base_url/api/queue" | cat

echo
echo "audit"
curl -s "$base_url/api/audit" | head -c 800 | cat
