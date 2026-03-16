# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Repository Layout

```
openclaw_build/
├── swarm-platform/       # Node.js backend (Express + WebSocket)
│   ├── src/              # Server modules
│   ├── data/             # File-based state (events.jsonl, teams.json, …)
│   ├── tests/            # unit / integration / e2e suites
│   ├── ui/               # React + Vite dashboard (separate dev server)
│   ├── public/           # Static legacy HTML dashboard pages
│   ├── scripts/          # smoke.sh, load_test.sh, chaos_test.sh, etc.
│   └── docs/             # Architecture, runbook, objectives
└── USAGE.md              # End-to-end operations reference
```

## Commands

### Swarm Platform (backend)

```bash
cd swarm-platform

# Install
npm install

# Run (loads .env automatically via --env-file)
npm start                         # production
npm run dev                       # nodemon-style watch mode

# Tests
npm test                          # unit + integration + e2e (sequential)
npm run test:unit                 # unit tests only

# Smoke / load / chaos
export ADMIN_API_KEY="<key>"
./scripts/smoke.sh
./scripts/load_test.sh http://127.0.0.1:3010 40
./scripts/chaos_test.sh
```

### Dashboard UI (React)

```bash
cd swarm-platform/ui
npm install
npm run dev        # Vite dev server
npm run build      # tsc + vite build → dist/
```

### Required env vars (swarm-platform/.env or shell)

| Variable | Purpose |
|---|---|
| `ADMIN_API_KEY` | Guards all write/dispatch endpoints |
| `RUNNER_MODE` | `mock` (safe default) or `real` (calls `openclaw agent`) |
| `BRAVE_API_KEY` | Web search via Brave Search API |
| `TELEGRAM_BOT_TOKEN` | Telegram notifications (falls back to openclaw.json) |
| `DATABASE_URL` | Optional PostgreSQL; omit for file-based mode |

### Gateway (OpenClaw daemon)

```bash
systemctl --user start|stop|restart|status openclaw-gateway
journalctl --user -u openclaw-gateway -f
```

## Architecture

### Request / Event Flow

```
HTTP POST /api/orchestrator/dispatch
  → auth.js (requireAdmin)
  → validation.js (validateDispatchBody)
  → policyEngine.js (role-gate, program-lead vs team-lead)
  → admissionController.js (load-state: green/yellow/red)
  → queueManager.js (slot management)
  → coordinator.js (decomposes task → subtasks with roles)
  → openclawRunner.js (spawns `openclaw agent` subprocess per subtask)
  → store.js → data/events.jsonl (JSONL append, idempotent by event.id)
  → eventProcessor.js → scoring.js (score deltas)
  → telegramRelay.js (async delivery with retries)
  → WebSocket broadcast to all dashboard clients
```

### Key Modules

| File | Responsibility |
|---|---|
| `server.js` | Wires all modules, registers Express routes, boots WebSocket server |
| `store.js` | File-based event log + team state; optionally delegates writes to `DB` |
| `coordinator.js` | Calls `openclaw agent coordinator` to decompose tasks into role-subtasks |
| `openclawRunner.js` | Spawns `openclaw agent <role>` subprocesses; parses JSONL output |
| `autonomousLoop.js` | Timed loop that dispatches meta-objectives to `competitiveCoordinator` |
| `competitiveCoordinator.js` | Runs 3-team competitive mode; wraps single-team `coordinator.js` |
| `modelCatalog.js` | Ollama model discovery, role→model routing, latency benchmarking |
| `scoring.js` | Score delta calculation from events (configurable via `data/scoring_rules.json`) |
| `policyEngine.js` | Role-based dispatch rules loaded from `data/policies.json` |
| `db.js` | Optional PostgreSQL layer; Store uses it when `DATABASE_URL` is set |
| `telegramBot.js` | Inbound Telegram command handling |
| `telegramRelay.js` | Outbound delivery with retry/backoff |
| `worktreeManager.js` | Git worktree lifecycle for parallel agent task isolation |
| `teamLearning.js` | Accumulates per-team performance data for adaptive routing |
| `explorationEngine.js` | Generates exploratory objectives from underperforming metrics |

### Agent Roles

`research` → `build` → `critic` → `integrator` (orchestrated by `coordinator`)

Each role maps to a named OpenClaw agent and an Ollama model tier (`fast` / `standard` / `quality`). Role→model routing lives in `data/model_routing.json` and is discovered at startup by `modelCatalog.js`.

### State Persistence

- **Default (file-based):** `data/events.jsonl` (append-only event log), `data/teams.json`, `data/task_sessions.json`
- **Optional (PostgreSQL):** set `DATABASE_URL`; `docker compose up -d postgres` starts the DB; schema in `db/`
- `Store.appendEvent()` is idempotent — duplicate `event.id` values are silently dropped

### Dashboard

- **Legacy static pages** in `public/pages/` (leaderboard, timeline, audit, ops) poll REST APIs
- **React SPA** in `ui/` (Vite + Tailwind + Recharts) served separately during development; built artifacts go to `ui/dist/`

## Testing

Tests use Node's built-in `node:test` runner (no Jest/Mocha). Run sequentially (`--test-concurrency=1`) to avoid port conflicts. Test files live in `tests/unit/`, `tests/integration/`, `tests/e2e/`.

## Data Files (`data/`)

| File | Purpose |
|---|---|
| `events.jsonl` | Append-only event log (source of truth for scoring) |
| `teams.json` | Team definitions and current scores |
| `scoring_rules.json` | Configurable score weights and penalties |
| `policies.json` | Role dispatch policies |
| `model_routing.json` | Role→model routing overrides |
| `model_latency.json` | Generated by `scripts/benchmark_models.sh` |

## Sandbox / Security Model

- `RUNNER_MODE=mock` — no real subprocess spawning, safe for all tests
- `RUNNER_MODE=real` — spawns `openclaw agent` with Docker sandbox (`"non-main"` mode sandboxes Telegram sessions; main session is unsandboxed)
- Workspace is mounted at `/data` inside Docker sandbox; host FS access is limited to workspace
