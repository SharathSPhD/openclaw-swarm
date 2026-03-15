#!/usr/bin/env bash
set -euo pipefail

BASE_URL="${1:-http://127.0.0.1:3010}"
KEY="${ADMIN_API_KEY:-}"

echo "Step 1: dispatch tasks"
for i in $(seq 1 12); do
  curl -s -X POST "$BASE_URL/api/orchestrator/dispatch" \
    -H "Content-Type: application/json" \
    ${KEY:+-H "x-api-key: $KEY"} \
    -d "{\"teamId\":\"team-alpha\",\"task\":\"chaos task $i\",\"actorRole\":\"team-lead\"}" >/dev/null
done

echo "Step 2: check health"
curl -s "$BASE_URL/api/health" | cat

echo
echo "Step 3: check audit"
curl -s "$BASE_URL/api/audit" | head -c 1000 | cat

echo
echo "Chaos test completed"
