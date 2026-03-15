# OpenClaw Swarm Platform — Product Requirements Document

**Version:** 1.0  
**Last Updated:** 2026-03-15  
**Status:** Draft

---

## 1. Product Vision

The OpenClaw Swarm Platform is a **local-first multi-agent AI orchestration system** designed to run entirely on an NVIDIA DGX Spark workstation. All AI inference executes locally via Ollama models—no cloud LLM calls, no data leaving the premises. The platform coordinates multiple specialized agents (research, build, critic, integrator) through a coordinator-specialist pattern to accomplish complex objectives that would exceed the capability of a single model.

Privacy and control are core tenets: sensitive tasks, proprietary code, and internal workflows stay on the DGX. The system provides **full observability** of agent operations—streaming output, reasoning traces, GPU utilization, and team performance—through a React dashboard and bidirectional Telegram integration. Remote collaborators can dispatch objectives and control teams via Telegram without requiring direct access to the workstation.

The platform bridges the gap between local model execution and production-grade orchestration: agents receive real tools (web search via Brave API, Docker sandbox, browser automation) through the OpenClaw gateway, enabling research, code generation, and integration tasks that go beyond raw LLM completion. Multi-agent collaboration—with inter-agent communication, critic feedback loops, and iterative refinement—transforms local models into a coordinated swarm capable of tackling objectives that demand decomposition, specialization, and quality assurance.

---

## 2. User Personas

### 2.1 DGX Operator

**Profile:** Power user with direct access to the DGX Spark workstation. Manages the swarm platform, dispatches objectives via the web UI, monitors execution in real time, and configures teams and model assignments.

**Goals:** Maximize swarm throughput and quality; ensure GPU resources are used efficiently; debug failures quickly; manage team composition and role assignments.

**Context:** Uses the React dashboard as the primary interface. Needs streaming agent output, Gantt timelines, GPU charts, and reasoning traces to diagnose issues and validate results.

---

### 2.2 Remote Collaborator

**Profile:** Stakeholder who interacts exclusively via Telegram. Cannot or prefers not to use the web dashboard. Sends objectives as messages, receives progress updates, and can issue commands (pause, resume, status) from a mobile or desktop Telegram client.

**Goals:** Stay informed on swarm progress; dispatch new objectives without workstation access; control team execution (pause/resume) when needed.

**Context:** Relies entirely on Telegram for bidirectional communication. Must receive timely updates and have commands acknowledged within seconds.

---

### 2.3 Observer

**Profile:** Read-only user who monitors swarm health, GPU utilization, agent performance, and team leaderboards. May be a manager, auditor, or external stakeholder.

**Goals:** Understand swarm capacity and utilization; compare team performance; verify that objectives are being processed; ensure system health.

**Context:** Uses the dashboard in view-only mode. No write access; no API key. Needs clear visualizations: GPU utilization over time, agent throughput, team leaderboard, and event traces.

---

## 3. User Stories

### 3.1 Runner Subsystem

| ID | Story | Acceptance Criteria |
|----|-------|---------------------|
| US-R1 | As a **DGX Operator**, I want the runner to invoke `openclaw agent` instead of `ollama run`, so that agents receive web search, sandbox, and browser tools. | Runner spawns `openclaw agent` CLI with gateway URL; agents can use Brave API, Docker sandbox, and browser automation. |
| US-R2 | As a **DGX Operator**, I want real mode to be the default, so that tasks execute with actual LLM inference. | Default mode is `real`; mock mode is opt-in via config or query param. |
| US-R3 | As a **DGX Operator**, I want agent output parsed and streamed to the dashboard, so that I can see reasoning and progress in real time. | Output visible in UI within 2s of generation; streaming via WebSocket or SSE. |
| US-R4 | As a **DGX Operator**, I want runner errors (timeout, OOM, gateway down) to produce deterministic terminal events, so that orchestration does not hang. | `task.failed` emitted with error code; no orphan processes. |

### 3.2 Coordinator / Swarm Subsystem

| ID | Story | Acceptance Criteria |
|----|-------|---------------------|
| US-C1 | As a **DGX Operator**, I want the coordinator to decompose objectives into 3–6 sub-tasks with role assignment, so that complex work is distributed across specialists. | Decomposition produces structured sub-tasks; each has role (research/build/critic/integrator). |
| US-C2 | As a **DGX Operator**, I want sub-tasks dispatched to specialists with inter-agent communication, so that agents can share context and build on each other's work. | Agents receive prior outputs; critic can provide feedback; integrator receives research/build artifacts. |
| US-C3 | As a **DGX Operator**, I want a critic feedback loop with a configurable max iteration count, so that quality improves without infinite loops. | Critic reviews output; loop terminates after N iterations or approval. |
| US-C4 | As a **DGX Operator**, I want result aggregation to combine specialist outputs into a final deliverable, so that objectives produce coherent outcomes. | Coordinator aggregates; final output stored and surfaced in UI. |

### 3.3 Telegram Subsystem

| ID | Story | Acceptance Criteria |
|----|-------|---------------------|
| US-T1 | As a **Remote Collaborator**, I want to send objectives via Telegram, so that I can dispatch work without using the web UI. | Incoming messages parsed; valid objectives forwarded to coordinator. |
| US-T2 | As a **Remote Collaborator**, I want to receive progress updates in Telegram, so that I stay informed on swarm execution. | Terminal events and checkpoints relayed; message includes task/objective IDs. |
| US-T3 | As a **Remote Collaborator**, I want to send commands (e.g., pause, resume, status) via Telegram, so that I can control teams remotely. | Commands parsed; actions executed; acknowledgment sent within 5s. |
| US-T4 | As a **Remote Collaborator**, I want streaming progress in Telegram for long-running objectives, so that I see incremental updates. | Periodic summaries or checkpoints sent; rate-limited to avoid Telegram limits. |

### 3.4 Dashboard Subsystem

| ID | Story | Acceptance Criteria |
|----|-------|---------------------|
| US-U1 | As a **DGX Operator**, I want a React + Vite dashboard with real-time streaming, so that I see agent output as it is generated. | React app; agent output streams; no full-page refresh. |
| US-U2 | As a **DGX Operator**, I want GPU utilization charts, so that I can monitor resource usage. | Chart shows GPU memory/utilization; refresh under 3s. |
| US-U3 | As a **DGX Operator**, I want a Gantt-style timeline of objectives and tasks, so that I understand execution order and overlap. | Timeline view; tasks shown with start/end; dependencies visible. |
| US-U4 | As an **Observer**, I want to view swarm topology (teams, roles, active agents), so that I understand the current execution state. | Topology diagram or table; read-only. |
| US-U5 | As a **DGX Operator**, I want agent reasoning traces visible in the UI, so that I can debug and validate outputs. | Traces expandable; show tool calls, inputs, outputs. |

### 3.5 Team Management Subsystem

| ID | Story | Acceptance Criteria |
|----|-------|---------------------|
| US-M1 | As a **DGX Operator**, I want to manage teams (alpha, beta) with configurable roles and limits, so that I can scale and tune the swarm. | CRUD for teams; max 4 parallel agents per team, 8 global. |
| US-M2 | As a **DGX Operator**, I want to assign models to roles with primary/fallback chains, so that I can optimize for latency and quality. | Model routing configurable; fallback on failure. |

### 3.6 Model Management Subsystem

| ID | Story | Acceptance Criteria |
|----|-------|---------------------|
| US-M3 | As a **DGX Operator**, I want quality scores computed from actual outputs (not hardcoded), so that leaderboards reflect real performance. | Scores derived from task completion; correctness, speed, efficiency from execution. |
| US-M4 | As a **DGX Operator**, I want the Brave API key used for web search when agents run via OpenClaw, so that research tasks have real search capability. | Brave API invoked by OpenClaw gateway; no key in UI. |

---

## 4. Functional Requirements

### 4.1 FR-RUN: Runner Requirements

| ID | Requirement | Details |
|----|-------------|---------|
| FR-RUN-1 | OpenClaw agent CLI | Runner MUST invoke `openclaw agent` (or equivalent) with gateway URL (port 18789) instead of `ollama run`. |
| FR-RUN-2 | Real mode default | Default execution mode MUST be `real`; mock mode only when explicitly configured. |
| FR-RUN-3 | Output parsing | Runner MUST parse OpenClaw agent output (JSON/text) and extract tool calls, reasoning, and final results. |
| FR-RUN-4 | Streaming | Runner MUST stream output chunks to the event pipeline for dashboard consumption. |
| FR-RUN-5 | Error handling | Runner MUST emit `task.failed` on timeout, OOM, gateway unreachable, or process crash. |
| FR-RUN-6 | Timeout | Configurable timeout (default 120s); MUST kill process and emit terminal event. |

### 4.2 FR-COORD: Coordinator Requirements

| ID | Requirement | Details |
|----|-------------|---------|
| FR-COORD-1 | Objective decomposition | Coordinator MUST decompose objectives into 3–6 sub-tasks with role assignment. |
| FR-COORD-2 | Sub-task dispatch | Sub-tasks MUST be dispatched to specialists via runner; admission controller enforces limits. |
| FR-COORD-3 | Result aggregation | Coordinator MUST aggregate specialist outputs into a final deliverable. |
| FR-COORD-4 | Critic feedback loop | Critic MUST review outputs; loop MUST terminate after configurable max iterations (e.g., 3). |
| FR-COORD-5 | Inter-agent communication | Agents MUST receive prior agent outputs as context when applicable. |
| FR-COORD-6 | Max iterations | Configurable cap on refinement iterations to prevent infinite loops. |

### 4.3 FR-TG: Telegram Requirements

| ID | Requirement | Details |
|----|-------------|---------|
| FR-TG-1 | Bidirectional | Telegram bot MUST accept incoming messages and commands, not just send. |
| FR-TG-2 | Command parsing | Incoming messages MUST be parsed for objectives and commands (pause, resume, status). |
| FR-TG-3 | Progress streaming | Terminal events and checkpoints MUST be relayed to configured chat (ID 8679892510). |
| FR-TG-4 | Objective forwarding | Valid objective text MUST be forwarded to coordinator API. |
| FR-TG-5 | Allowlist | Only allowlisted chat IDs (8679892510) MAY send commands. |
| FR-TG-6 | Rate limiting | Outbound messages MUST respect Telegram rate limits (30 msg/s to same chat). |

### 4.4 FR-UI: Dashboard Requirements

| ID | Requirement | Details |
|----|-------------|---------|
| FR-UI-1 | React + Vite | Dashboard MUST be built with React and Vite. |
| FR-UI-2 | Real-time streaming | Agent output MUST stream to UI via WebSocket or SSE. |
| FR-UI-3 | GPU charts | GPU utilization and memory MUST be displayed with refresh under 3s. |
| FR-UI-4 | Gantt timeline | Objectives and tasks MUST be shown in a Gantt-style timeline. |
| FR-UI-5 | Swarm topology | Teams, roles, and active agents MUST be visualized. |
| FR-UI-6 | Agent traces | Reasoning traces (tool calls, inputs, outputs) MUST be viewable. |
| FR-UI-7 | No secrets in UI | API keys and tokens MUST NOT be rendered in the UI. |

### 4.5 FR-DATA: Data Requirements

| ID | Requirement | Details |
|----|-------------|---------|
| FR-DATA-1 | PostgreSQL primary | PostgreSQL 16 MUST be the primary store for events, scores, audit, Telegram deliveries. |
| FR-DATA-2 | Schema | Schema MUST support events, score_snapshots, audit_logs, telegram_deliveries (per existing schema). |
| FR-DATA-3 | Migrations | Schema changes MUST be versioned and applied via migrations. |
| FR-DATA-4 | Analytics queries | Support queries for leaderboard, throughput, GPU utilization over time. |
| FR-DATA-5 | Fallback | When PostgreSQL is unavailable, MUST fall back to JSONL for event persistence. |

### 4.6 FR-API: API Requirements

| ID | Requirement | Details |
|----|-------------|---------|
| FR-API-1 | New endpoints | Endpoints for: objective submission, team control, model routing, reconciliation. |
| FR-API-2 | WebSocket channels | WebSocket for: agent output streaming, GPU telemetry, event stream. |
| FR-API-3 | Error codes | Structured error responses with codes (e.g., RATE_LIMITED, GATEWAY_UNAVAILABLE, ADMISSION_REJECTED). |
| FR-API-4 | Admin auth | Write endpoints MUST require `x-api-key` when `ADMIN_API_KEY` is set. |

---

## 5. Non-Functional Requirements

### 5.1 NFR-PERF: Performance

| ID | Requirement | Target |
|----|-------------|--------|
| NFR-PERF-1 | Agent output visibility | Agent output visible in dashboard within **2 seconds** of generation. |
| NFR-PERF-2 | Telegram command response | Telegram command-to-first-response under **5 seconds**. |
| NFR-PERF-3 | GPU telemetry refresh | GPU telemetry refresh in dashboard under **3 seconds**. |

### 5.2 NFR-SCALE: Scalability

| ID | Requirement | Limit |
|----|-------------|-------|
| NFR-SCALE-1 | Global concurrent agents | Maximum **8** agents running concurrently. |
| NFR-SCALE-2 | Per-team concurrent agents | Maximum **4** agents per team. |
| NFR-SCALE-3 | GPU memory budget | Stay below **90%** GPU memory utilization to avoid OOM. |

### 5.3 NFR-RELY: Reliability

| ID | Requirement | Behavior |
|----|-------------|----------|
| NFR-RELY-1 | Ollama down | Graceful degradation; queue tasks; surface status in UI. |
| NFR-RELY-2 | PostgreSQL down | Fall back to JSONL; log warning; continue operation. |
| NFR-RELY-3 | OpenClaw gateway down | Reject new dispatches; emit clear error; do not orphan runners. |

### 5.4 NFR-SEC: Security

| ID | Requirement | Behavior |
|----|-------------|----------|
| NFR-SEC-1 | Admin API key | Write endpoints require `x-api-key` when configured. |
| NFR-SEC-2 | No secrets in UI | API keys, tokens, and credentials MUST NOT be displayed in the UI. |
| NFR-SEC-3 | Telegram allowlist | Only allowlisted chat IDs may send commands. |

### 5.5 NFR-DATA: Data Retention

| ID | Requirement | Limit |
|----|-------------|-------|
| NFR-DATA-1 | In-memory events | Maximum **5000** events in memory buffer. |
| NFR-DATA-2 | PostgreSQL retention | Minimum **30 days** of event data retained. |

---

## 6. Success Metrics

| # | Metric | Target | Measurement |
|---|--------|--------|-------------|
| 1 | Agent output latency | Output visible in dashboard within 2s of generation | P95 of time from first chunk to UI render |
| 2 | Telegram command latency | Command-to-first-response under 5s | P95 of time from message received to acknowledgment |
| 3 | Objective decomposition | 3–6 sub-tasks per objective with role assignment | Audit of coordinator output |
| 4 | Task completion rate | 95% of tasks complete without timeout | Completed / (Completed + Failed) |
| 5 | GPU memory safety | Stay below 90% during concurrent execution | Max GPU memory % during load test |
| 6 | Dashboard streaming | Real-time agent output in UI | Manual verification; no >2s lag |
| 7 | PostgreSQL primary | All events persisted to PostgreSQL when available | Event count in DB vs emitted |
| 8 | Quality scores | Scores derived from execution, not hardcoded | Correctness/speed/efficiency from task payload |
| 9 | OpenClaw integration | Agents receive tools (web search, sandbox, browser) | Tool call evidence in traces |
| 10 | Inter-agent communication | Specialist outputs passed to dependent agents | Trace shows prior outputs in context |

---

## 7. Constraints

| Constraint | Description |
|------------|--------------|
| **Hardware** | DGX Spark with 128GB GPU memory shared across all models. |
| **Model concurrency** | Ollama can run only 2–3 large models (e.g., gpt-oss:120b) concurrently due to memory. |
| **OpenClaw dependency** | OpenClaw gateway MUST be running on port 18789 for agent execution with tools. |
| **Telegram rate limits** | 30 messages/second to the same chat; must batch or throttle updates. |
| **Local-first** | No cloud LLM calls; all inference via local Ollama. |
| **Single-node** | Swarm runs on one DGX; no distributed multi-node orchestration. |

---

## 8. Risks and Mitigations

| # | Risk | Impact | Mitigation |
|---|------|--------|------------|
| 1 | **GPU OOM** | Crash, lost work, queue blockage | Admission controller limits concurrent agents; GPU memory monitoring; pre-dispatch memory check; avoid loading 3+ large models simultaneously. |
| 2 | **OpenClaw gateway crashes** | Agents lose tools; tasks fail | Health check before dispatch; reject new tasks when gateway down; clear error messages; automatic retry with backoff. |
| 3 | **Telegram rate limits** | Messages dropped; user confusion | Batch updates; throttle to <30 msg/s; queue and coalesce progress messages. |
| 4 | **Model quality issues** | Poor outputs; failed objectives | Fallback chains; critic feedback loop; quality scoring; model routing tuning. |
| 5 | **Concurrent agent resource contention** | Slowdown, timeouts | Max 8 global, 4 per team; admission controller; queue aging. |
| 6 | **PostgreSQL unavailability** | Event loss if no fallback | JSONL fallback; async write; retry; alert on fallback mode. |
| 7 | **Network issues for web search** | Research tasks fail | Brave API timeout; retry; surface error in trace; optional offline mode. |
| 8 | **Long-running tasks blocking queue** | Starvation; delayed objectives | Timeout enforcement; task cancellation; priority or fairness policy. |

---

## 9. Release Criteria

### Phase 1: Runner Migration
- [ ] Runner invokes `openclaw agent` CLI with gateway URL
- [ ] Real mode is default; mock opt-in only
- [ ] Output parsing extracts text and tool calls
- [ ] Terminal events emitted on timeout and errors

### Phase 2: Coordinator Enhancement
- [ ] Objective decomposition produces 3–6 sub-tasks with roles
- [ ] Inter-agent communication (prior outputs as context)
- [ ] Critic feedback loop with max iterations
- [ ] Result aggregation to final deliverable

### Phase 3: Telegram Bidirectional
- [ ] Incoming messages parsed for objectives and commands
- [ ] Objectives forwarded to coordinator
- [ ] Commands (pause, resume, status) executed
- [ ] Allowlist enforced; rate limiting applied

### Phase 4: Dashboard Overhaul
- [ ] React + Vite app replaces vanilla JS
- [ ] Agent output streaming via WebSocket/SSE
- [ ] GPU charts with <3s refresh
- [ ] Gantt timeline for objectives/tasks
- [ ] Agent reasoning traces visible

### Phase 5: Data Migration
- [ ] PostgreSQL primary for events, scores, audit, Telegram
- [ ] JSONL fallback when PostgreSQL unavailable
- [ ] Migrations applied; schema versioned

### Phase 6: Quality & Integration
- [ ] Quality scores from execution (not hardcoded)
- [ ] Brave API used via OpenClaw for web search
- [ ] All 13 models available; routing by role/tier

### Phase 7: Production Readiness
- [ ] All NFR targets met (latency, scale, reliability)
- [ ] Security gates passed (no secrets in UI, allowlist)
- [ ] Runbook and smoke tests pass
- [ ] Chaos and load tests complete without crash

---

## 10. Out of Scope

The following are **explicitly not** being built in this release:

| Item | Rationale |
|------|------------|
| Cloud deployment | Local-first; no cloud hosting. |
| Multi-node swarm | Single DGX only; no distributed orchestration. |
| Model fine-tuning | Use pre-trained Ollama models as-is. |
| Custom GPU exporter | Use nvidia-smi and existing telemetry. |
| User authentication system | Admin API key only; no user accounts. |
| Mobile app | Telegram + web dashboard suffice. |
| Model training / MLOps | No training pipeline or autoscaling. |
| Automatic Telegram account creation | Manual bot setup. |
| Multi-tenant isolation | Single-tenant DGX environment. |
| External IDE agent integration | Out of scope for this PRD. |

---

## 11. Glossary

| Term | Definition |
|------|------------|
| **OpenClaw** | Gateway service (port 18789) that provides agents with tools: web search (Brave API), Docker sandbox, browser automation, Telegram channel. Agents run via `openclaw agent` CLI. |
| **Ollama** | Local LLM runtime. Runs models (e.g., qwen2.5:7b, gpt-oss:120b) on the DGX. Accessed via `ollama run` or through OpenClaw. |
| **DGX Spark** | NVIDIA workstation with 128GB GPU memory. Host for Ollama, OpenClaw, and the swarm platform. |
| **Coordinator** | Central agent (program-lead) that decomposes objectives, dispatches sub-tasks, aggregates results, and manages the critic feedback loop. Uses quality-tier models (e.g., gpt-oss:120b). |
| **Specialist** | Role-specific agent (research, build, critic, integrator) that executes sub-tasks. Assigned models by tier (fast, standard, quality). |
| **Program-lead** | Top-level coordinator role. Receives objectives, orchestrates teams, relays updates to Telegram. |
| **Team-lead** | Per-team coordinator. Receives objectives from program-lead, spawns subagents, manages team execution. |
| **Swarm session** | A single objective execution: from decomposition through specialist dispatch to final aggregation. |
| **Objective** | User-stated goal (e.g., "Research X and build a prototype"). Decomposed into sub-tasks by the coordinator. |
| **Dispatch** | Act of sending a sub-task to a specialist via the runner. Gated by admission controller. |
| **Admission controller** | Component that enforces concurrent agent limits (8 global, 4 per team) and GPU memory budget before dispatch. |
| **Fast tier** | Model tier for latency-sensitive roles (e.g., research). Primary: qwen2.5:7b; fallbacks: llama3.2:3b, phi3:mini. |
| **Standard tier** | Model tier for balanced roles (build, critic). Primary: qwen2.5-coder:7b, llama3.1:8b; fallbacks: deepseek-coder:6.7b, mistral:7b. |
| **Quality tier** | Model tier for complex reasoning (integrator, program-lead). Primary: deepseek-r1:8b, gpt-oss:120b. |
| **Telegram proof** | Event-backed record of Telegram delivery (message ID, chat ID, status) for audit. |
| **Event stream** | Ordered sequence of platform events (task.started, task.completed, task.failed, team.chat, etc.) stored in PostgreSQL or JSONL. |

---

*End of PRD*
