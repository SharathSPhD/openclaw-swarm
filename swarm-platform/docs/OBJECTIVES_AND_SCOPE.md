# Objectives and Scope

Last updated: 2026-03-15

## Objective Summary

This document defines the delivery objectives for the OpenClaw swarm platform and maps them to implemented outcomes.

Primary goals:

1. Run a local multi-agent swarm on DGX using OpenClaw and local Ollama models.
2. Expand model coverage beyond a single heavy model and assign models by role with latency-aware defaults.
3. Keep program-lead communication on Telegram while preserving internal team-only communication for worker orchestration.
4. Enforce admin-protected write actions without exposing secrets in the UI.
5. Provide reliable runtime visibility proving local model execution and GPU/runtime telemetry.
6. Provide full workflow visibility from objective creation to team lead orchestration to subagent execution and completion/failure.
7. Upgrade timeline, audit, and ops pages from placeholders to operational surfaces.

## In-Scope Delivery

### A. Model and role orchestration

- Multi-family model inventory support (gpt-oss, nemotron, deepseek, qwen, llama, mistral, gemma, phi).
- Role-to-tier-to-model assignment policy with fallback chains.
- Capability-aware latency priors sourced from model metadata and web references when runtime benchmark data is not available.

### B. Execution behavior

- Real mode runs selected models through local `ollama run` execution path.
- Timeout behavior emits deterministic terminal events (`task.failed`) so orchestration does not hang indefinitely.
- Stale task reconciliation path to recover from historical queue/running artifacts.

### C. Communication policy

- Program-lead objective lifecycle updates are eligible for Telegram relay.
- Internal worker and team-lead communication remains in platform event/chat channels.
- UI reflects both Telegram proof and internal team communication.

### D. Security and control UX

- Write endpoints remain API-key protected (`x-api-key`) when configured.
- UI no longer exposes admin key fields directly; session unlock uses prompt-based entry and lock controls.

### E. Observability and UI

- Command center shows objective board, flow board, active subagents, role-model matrix, internal comms, Telegram proof, and runtime diagnostics.
- Timeline shows objective progression and task flow.
- Audit shows event-level traceability with context fields.
- Ops shows runtime telemetry, queue pressure, and model latency/capability status.

## Non-Goals

1. Creating Telegram accounts or bot identities automatically.
2. Building a custom GPU exporter outside current process and `nvidia-smi`/runtime signals.
3. Full MLOps lifecycle (model fine-tuning, serving autoscaling, or distributed scheduler control plane).

## Acceptance Criteria

1. Role dispatch chooses low-latency models for fast-tier roles by default and records rationale.
2. Real dispatch emits objective and subagent lifecycle events visible in flow and audit pages.
3. Program-lead tasks produce Telegram proof events with message IDs when configured.
4. Write endpoints reject missing/invalid API key when admin key is enabled.
5. UI does not display plain admin API key fields.
6. Runtime diagnostics show local model execution evidence and GPU/runtime state.
7. Timeline, audit, and ops pages expose meaningful live data and are no longer placeholders.
