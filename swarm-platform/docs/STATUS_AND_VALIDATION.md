# Status and Validation

Last updated: 2026-03-15

## Delivery Status

Overall status: Substantially implemented and live.

### Objective-by-objective status

1. Multi-model expansion and role assignment
- Status: Complete
- Evidence: `GET /api/models` shows 12+ required models across deepseek, nemotron, qwen, llama, mistral, gemma, phi, gpt-oss families, plus role/tier routing and alternatives.

2. Low-latency preference and model visibility
- Status: Complete
- Evidence: model selection events include rationale with latency priors and alternatives.

3. Program-lead Telegram, internal team comms for others
- Status: Complete
- Evidence:
  - Internal flow events: objective received, subagent spawned/progress/complete/fail, team.chat.
  - Telegram proof entries with message IDs for program-lead sessions.

4. Admin key not shown in UI
- Status: Complete
- Evidence: no plain admin key input field; unlock/lock prompt-based controls only.

5. GPU/runtime visibility and local model execution proof
- Status: Complete with telemetry caveat
- Evidence:
  - Runtime indicates local `ollama run` processes while tasks are active.
  - `localGpuBacked` toggles true on active local model execution.
- Caveat:
  - On this host, `nvidia-smi` memory fields may return `[N/A]`; fallback process/runtime telemetry is used.

6. End-to-end objective -> team lead -> subagent visibility
- Status: Complete
- Evidence: flow records include objective id, actor role, model, status, internal/telegram counts, and per-task timeline.

7. Timeline/Audit/Ops page quality
- Status: Complete
- Evidence: pages render live data with operationally meaningful tables and traces.

## Validation Evidence Snapshot

### Recent model selection evidence

For recent team-beta research tasks:

- selected model: `phi3:mini`
- tier: `fast`
- rationale: `Matched role=research tier=fast latencyP50=520ms`
- alternatives include: llama3.2:3b, nemotron-mini:4b, qwen2.5:7b, mistral:7b

### Recent flow chain evidence

Observed event sequence for recent tasks:

1. `task.submitted`
2. `agent.assigned`
3. `objective.created`
4. `teamlead.objective.received`
5. `model.selected`
6. `team.chat` objective assignment
7. `team.chat` subagent spawn note
8. `subagent.spawned`
9. `task.started`
10. `subagent.progress`
11. terminal: `task.failed` (timeout) or `task.completed`
12. `subagent.failed|subagent.completed`
13. `team.chat` terminal note
14. `telegram.sent` (program-lead path)

### Telegram proof evidence

Recent proof entries show:

- `telegram.sent` with `chatId=8679892510`
- incremental `messageId` values (for example 66, 67)
- linked `taskId`

## Known Constraints and Follow-up Items

1. GPU memory metrics from `nvidia-smi` may be `[N/A]` on this DGX configuration.
- Mitigation implemented: process/runtime fallback and local execution process tracing.

2. Real tasks may timeout under strict fast-tier limits.
- This is currently intentional to avoid hanging workflows and to force deterministic terminal states.
- Optional tuning: increase per-role timeout or reduce prompt payloads for specific roles.

3. Historical events can skew active/queue perception.
- Mitigation implemented: stale-task reconciliation endpoint and periodic reconciliation.

## Operational Commands (Current)

Start service (real mode):

```bash
cd /home/sharaths/projects/openclaw_build/swarm-platform
set -a && source .env && set +a
ADMIN_API_KEY=test-key RUNNER_MODE=real STALE_TASK_MS=300000 npm start
```

Reconcile stale tasks:

```bash
curl -s -X POST http://127.0.0.1:3010/api/control/reconcile \
  -H "x-api-key: test-key" \
  -H "Content-Type: application/json" \
  -d '{"maxAgeMs":300000}'
```

Check model/routing/capability state:

```bash
curl -s http://127.0.0.1:3010/api/models
```

Check runtime telemetry:

```bash
curl -s http://127.0.0.1:3010/api/system
```

Check flow and objective views:

```bash
curl -s http://127.0.0.1:3010/api/objectives
curl -s http://127.0.0.1:3010/api/flow?teamId=team-beta
```

Check Telegram proof:

```bash
curl -s http://127.0.0.1:3010/api/telegram
```
