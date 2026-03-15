#!/usr/bin/env bash
set -euo pipefail

BASE_URL="${1:-http://127.0.0.1:3010}"
COUNT="${2:-40}"
KEY="${ADMIN_API_KEY:-}"

echo "Dispatching $COUNT load test tasks to $BASE_URL"
for i in $(seq 1 "$COUNT"); do
  curl -s -X POST "$BASE_URL/api/orchestrator/dispatch" \
    -H "Content-Type: application/json" \
    ${KEY:+-H "x-api-key: $KEY"} \
    -d "{\"teamId\":\"team-alpha\",\"task\":\"load test task $i\",\"actorRole\":\"team-lead\"}" >/dev/null
  sleep 0.05
done

echo "System"
curl -s "$BASE_URL/api/system" | cat

echo
echo "Queue"
curl -s "$BASE_URL/api/queue" | cat
