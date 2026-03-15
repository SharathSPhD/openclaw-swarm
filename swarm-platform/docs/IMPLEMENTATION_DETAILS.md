# Implementation Details

Last updated: 2026-03-15

## Overview

This document records concrete implementation work for model routing, runtime behavior, communication policy, security UX, observability APIs, and UI overhaul.

## 1) Model expansion and role assignment

### Data artifacts

- `data/model_routing.json`
  - Defines required model list.
  - Defines tier pools (`fast`, `standard`, `quality`).
  - Defines role routes with primary/fallback model chains.
- `data/model_capabilities.json`
  - Stores capability metadata and estimated latency priors from model-family references.
- `data/model_latency.json`
  - Supports measured data when available; now merged with capability priors if measured data is missing or unusable.

### Selector logic

- `src/modelCatalog.js`
  - Loads routing, measured latency, and capability priors.
  - Merges measured and estimated latency values.
  - Ranks candidate models by latency and role/tier policy.
  - Returns `selectedModel`, `modelTier`, `alternatives`, and `estimatedLatencyMs` rationale metadata.

### API exposure

- `GET /api/models` in `src/server.js`
  - Returns inventory, policy roles, routing, latency, capability metadata, and inventory completeness status.

## 2) Real execution path and runtime control

### Local execution enforcement

- `src/openclawRunner.js`
  - Real mode now executes `ollama run <selectedModel> ...` locally.
  - Selected model is provided from orchestration path (`modelName` argument).
  - Emits `task.checkpoint`, `task.completed`, `task.failed` events with model context.

### Timeout robustness

- Real-mode timeout now emits deterministic terminal failure (`runner_timeout`) and avoids duplicate terminal events.

### Stale task reconciliation

- `src/server.js`
  - Added `reconcileStaleTasks` routine.
  - Added `POST /api/control/reconcile` (admin-protected) for manual cleanup.
  - Periodic background reconciliation to prevent old stuck tasks from blocking new dispatches.

## 3) Communication policy implementation

### Telegram policy

- `src/server.js` `maybeSendTelegramForTerminalEvent`
  - Sends relay updates only for program-lead-originated sessions.
  - Uses route default target for team channels and records `telegram.sent` or `telegram.failed` proof events.

### Team internal communication

- `src/server.js` emits explicit internal events:
  - `teamlead.objective.received`
  - `subagent.spawned`
  - `subagent.progress`
  - `subagent.completed` / `subagent.failed`
  - `team.chat` transitions for objective assignment, spawn, start, and finish/failure notes.

## 4) Security and controls UX

### Backend

- `src/auth.js` retains key enforcement via `x-api-key` when `ADMIN_API_KEY` is present.

### Frontend

- `public/index.html` and `public/app.js`
  - Removed visible admin key input field.
  - Added Unlock/Lock controls with prompt-based session key capture (`sessionStorage`).
  - Control state surfaced as `controls: locked|unlocked`.

## 5) GPU/runtime telemetry and proof of local execution

### System telemetry

- `src/system.js`
  - Parses device-level GPU telemetry from `nvidia-smi`.
  - Parses compute process list.
  - Parses `ollama ps` runtime list.
  - Parses OS process table for `ollama run` command fallback.
  - Computes `localGpuBacked` true when runtime evidence indicates active local model execution.

### UI runtime visibility

- `public/app.js`
  - Renders GPU summary with `local-gpu active|idle` indicator.
  - Renders detailed runtime panel with:
    - device stats
    - compute process list
    - ollama runtime rows
    - `ollama run` process command evidence

## 6) Flow, audit, ops, and timeline enhancements

### Store aggregation

- `src/store.js`
  - Added objective board aggregator.
  - Added task flow aggregator with status/model/internal-message/telegram counts and timeline entries.
  - Kept existing leaderboard and chat proof accessors.

### Server endpoints

- `src/server.js`
  - Added `GET /api/objectives`
  - Added `GET /api/flow`
  - Added `GET /api/ops`
  - Enriched `GET /api/audit` details.

### UI pages

- `public/index.html`
  - Full command center with objective board, flow table, role-model matrix, and runtime detail.
- `public/pages/timeline.html`
  - Live objective + flow timeline view.
- `public/pages/audit.html`
  - Event trace table with source and detail.
- `public/pages/ops.html`
  - Runtime diagnostics, queue snapshot, and model latency health.
- `public/app.js`
  - Shared page-aware refresh orchestration for all views.

## 7) Operational scripts

- `scripts/pull_required_models.sh`
  - Pulls required model set from routing file.
- `scripts/benchmark_models.sh`
  - Retained for optional measurement, but no longer a hard dependency for assignment decisions.

## 8) Documentation and env updates

- `.env.example` updated with routing/runtime expectations.
- `USAGE.md` updated with model-prep and runtime verification steps.
