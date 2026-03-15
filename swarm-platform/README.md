# OpenClaw Swarm Platform

Production-oriented OpenClaw swarm orchestration platform for DGX with team roles, policy gates, DGX-aware admission control, Telegram relay, scoring engine, and live dashboard pages.

## Implemented Features

- Real runner integration layer (`mock` or `real`) for task lifecycle events
- Program-lead/team-lead role policy engine and dispatch validation
- Admission controller and queue manager with load-state transitions
- Event pipeline with idempotent writes and JSONL fallback
- PostgreSQL support + schema for events/snapshots/audit/telegram deliveries
- Telegram relay with retries and event/task linkage
- Balanced scoring v2 with role/agent breakdowns
- Multi-page dashboard: command center, leaderboard, timeline, audit, ops
- API auth gate (`x-api-key`) for protected write endpoints
- Unit/integration/e2e test suites + load/chaos scripts

## Run

```bash
cd /home/sharaths/projects/openclaw_build/swarm-platform
npm install
npm start
```

Open:

- http://127.0.0.1:3010

Dashboard pages:

- http://127.0.0.1:3010/pages/leaderboard.html
- http://127.0.0.1:3010/pages/timeline.html
- http://127.0.0.1:3010/pages/audit.html
- http://127.0.0.1:3010/pages/ops.html

## API

- `GET /api/health`
- `GET /api/snapshot`
- `GET /api/leaderboard`
- `GET /api/system`
- `GET /api/queue`
- `GET /api/audit`
- `POST /api/events`
- `POST /api/orchestrator/dispatch`

Protected endpoints require `x-api-key` if `ADMIN_API_KEY` is set.

## Smoke test

```bash
chmod +x scripts/smoke.sh
./scripts/smoke.sh
```

## Tests

```bash
npm test
```

## Load and Chaos

```bash
./scripts/load_test.sh http://127.0.0.1:3010 40
./scripts/chaos_test.sh
```

## PostgreSQL (optional)

```bash
docker compose up -d postgres
```

## Runner Mode

- `RUNNER_MODE=mock` (default) for safe local testing
- `RUNNER_MODE=real` to execute `openclaw agent` calls

## Operations

- Runbook: `RUNBOOK.md`
- Release checklist: `RELEASE_CHECKLIST.md`

## Documentation

- Docs index: `docs/README.md`
- Objectives and scope: `docs/OBJECTIVES_AND_SCOPE.md`
- Implementation details: `docs/IMPLEMENTATION_DETAILS.md`
- Architecture: `docs/ARCHITECTURE.md`
- Status and validation: `docs/STATUS_AND_VALIDATION.md`
