import express from "express";
import http from "node:http";
import path from "node:path";
import fs from "node:fs";
import os from "node:os";
import { fileURLToPath } from "node:url";
import { WebSocketServer } from "ws";
import { Store } from "./store.js";
import { readSystemSnapshot, classifyLoad } from "./system.js";
import { createDispatchWithPolicy } from "./orchestrator.js";
import { normalizeEvent, validateEvent, createEvent } from "./eventSchema.js";
import { PolicyEngine } from "./policyEngine.js";
import { AdmissionController } from "./admissionController.js";
import { QueueManager } from "./queueManager.js";
import { runTask } from "./openclawRunner.js";
import { SwarmCoordinator } from "./coordinator.js";
import { DB } from "./db.js";
import { EventProcessor } from "./eventProcessor.js";
import { TelegramRelay } from "./telegramRelay.js";
import { TelegramBot } from "./telegramBot.js";
import { requireAdmin } from "./auth.js";
import { validateDispatchBody, validateEventBody } from "./validation.js";
import { discoverLocalModels, chooseModelForRole, loadModelRouting, readModelLatency, readModelCapabilities, computeInventoryStatus } from "./modelCatalog.js";
import { AutonomousLoop } from "./autonomousLoop.js";
import { CompetitiveCoordinator } from "./competitiveCoordinator.js";
import { WorktreeManager } from "./worktreeManager.js";
import { TeamLearning } from "./teamLearning.js";
import { ExplorationEngine } from "./explorationEngine.js";
import { ObjectivePerformanceTracker } from "./objectivePerformance.js";
import { SpecializationEngine } from "./specializationEngine.js";
import { AgentMemory } from "./agentMemory.js";
import { AiTechExplorer } from "./aiTechExplorer.js";
import { RagPipeline } from "./ragPipeline.js";
import { FineTuningPrep } from "./fineTuningPrep.js";
import { registerCompetitiveRoutes } from "./routes/competitive.js";
import { registerLearningRoutes } from "./routes/learning.js";
import { registerExplorationRoutes } from "./routes/exploration.js";
import { registerSpecializationRoutes } from "./routes/specialization.js";
import { registerModelRoutes } from "./routes/models.js";
import { registerOpsRoutes } from "./routes/ops.js";
import { registerAutonomyRoutes } from "./routes/autonomy.js";
import { registerAgentRoutes } from "./routes/agents.js";
import { registerRagRoutes } from "./routes/rag.js";
import { registerFineTuningRoutes } from "./routes/finetuning.js";
import { registerAiTechRoutes } from "./routes/aitech.js";
import { ResourceRequests } from "./resourceRequests.js";
import { registerRequestRoutes } from "./routes/requests.js";
import { ResourceCleaner } from "./resourceCleaner.js";

import { createMetricsRouter } from './routes/metrics.js';
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const root = path.resolve(__dirname, "..");
const openclawConfigPath = path.join(os.homedir(), ".openclaw", "openclaw.json");

function readOpenClawConfig() {
  try {
    return JSON.parse(fs.readFileSync(openclawConfigPath, "utf8"));
  } catch {
    return {};
  }
}

function resolveTelegramToken() {
  if (process.env.TELEGRAM_BOT_TOKEN) return process.env.TELEGRAM_BOT_TOKEN;
  return readOpenClawConfig()?.channels?.telegram?.botToken || "";
}

const cfg = {
  port: Number(process.env.PORT || 3010),
  pollMs: Number(process.env.SYSTEM_POLL_MS || 3000),
  queuePollMs: Number(process.env.QUEUE_POLL_MS || 2000),
  maxActiveAgents: Number(process.env.MAX_ACTIVE_AGENTS || 8),
  queueWarnDepth: Number(process.env.QUEUE_WARN_DEPTH || 15),
  gpuElevatedPct: Number(process.env.GPU_MEM_ELEVATED_PCT || 60),
  gpuWarnPct: Number(process.env.GPU_MEM_WARN_PCT || 75),
  gpuEmergencyPct: Number(process.env.GPU_MEM_EMERGENCY_PCT || 85),
  gpuCritPct: Number(process.env.GPU_MEM_CRIT_PCT || 90),
  retention: Number(process.env.EVENT_RETENTION || 5000),
  runnerMode: process.env.RUNNER_MODE || "mock",
  runnerTimeoutMs: Number(process.env.RUNNER_TIMEOUT_MS || 120000),
  dbUrl: process.env.DATABASE_URL || "",
  stateCooldownMs: Number(process.env.STATE_COOLDOWN_MS || 8000),
  telegramToken: resolveTelegramToken(),
  telegramDefaultChatId: process.env.TELEGRAM_DEFAULT_CHAT_ID || "8679892510",
  openclawGatewayUrl: process.env.OPENCLAW_GATEWAY_URL || "http://127.0.0.1:18789",
  openclawCanvasPath: process.env.OPENCLAW_CANVAS_PATH || "/__openclaw__/canvas/",
  autonomousMode: process.env.AUTONOMOUS_MODE || "on"
};

const app = express();
const server = http.createServer(app);
const wss = new WebSocketServer({ server });

const db = new DB(cfg.dbUrl);
const eventProcessor = new EventProcessor(null, db);
const store = new Store(cfg.retention, db, eventProcessor);
eventProcessor.store = store;
const agentMemory = new AgentMemory({ dataDir: path.join(root, "data") });
const ragPipeline = new RagPipeline({ dataDir: path.join(root, "data") });
const fineTuningPrep = new FineTuningPrep({ dataDir: path.join(root, "data") });
const aiTechExplorer = new AiTechExplorer({ dataDir: path.join(root, "data") });
const resourceRequests = new ResourceRequests({ dataDir: path.join(root, "data") });

const policyEngine = new PolicyEngine();
const queue = new QueueManager();
const admission = new AdmissionController({
  gpuElevatedPct: cfg.gpuElevatedPct,
  gpuWarnPct: cfg.gpuWarnPct,
  gpuEmergencyPct: cfg.gpuEmergencyPct,
  gpuCritPct: cfg.gpuCritPct,
  queueWarnDepth: cfg.queueWarnDepth,
  maxActiveAgents: cfg.maxActiveAgents,
  STATE_COOLDOWN_MS: cfg.stateCooldownMs
});

const telegramRelay = new TelegramRelay({
  botToken: cfg.telegramToken,
  defaultChatId: cfg.telegramDefaultChatId,
  maxRetries: Number(process.env.TELEGRAM_MAX_RETRIES || 3),
  retryBaseMs: Number(process.env.TELEGRAM_RETRY_MS || 1000)
});

const telegramBot = new TelegramBot({
  botToken: cfg.telegramToken,
  allowedChatIds: [cfg.telegramDefaultChatId],
  db,
  onObjective: async ({ chatId, objective }) => {
    const teamId = "team-alpha";
    const objectiveId = `tg-${Date.now()}`;

    await emitEvent(
      createEvent({
        type: "objective.created",
        teamId,
        source: "telegram",
        payload: { objectiveId, objective, actorRole: "program-lead", source: "telegram", chatId }
      })
    );

    try {
      const { SwarmCoordinator } = await import("./coordinator.js");
      const coordinator = new SwarmCoordinator({
        runTask,
        emitEvent,
        createEvent,
        store,
        db,
        modelName: process.env.COORDINATOR_MODEL || "qwen2.5:14b",
        chooseModelForRole: (opts) =>
          chooseModelForRole({ ...opts, models: modelInventory.models, routing: modelRouting, latency: modelLatency })
      });
      coordinator
        .executeObjective({
          teamId,
          objective,
          objectiveId,
          maxIterations: 3,
          onProgress: (progress) => {
            telegramBot.sendProgress(chatId, objectiveId, progress);
            broadcast("swarm.progress", progress);
          }
        })
        .catch(() => {});
    } catch {
      await telegramBot.sendMessage(chatId, "Coordinator not available. Objective queued for manual dispatch.");
    }
  },
  onCommand: async ({ chatId, command, teamId, taskId }) => {
    switch (command) {
      case "status": {
        const snap = snapshot();
        const text = [
          `*Swarm Status*`,
          `Load: ${snap.loadState}`,
          `Agents: ${snap.activeAgents}/${snap.maxActiveAgents}`,
          `Queue: ${snap.queueDepth}`,
          `Runner: ${snap.runnerMode}`,
          `GPU: ${snap.system?.gpu?.usedPct ?? "n/a"}% mem`
        ].join("\n");
        await telegramBot.sendMessage(chatId, text);
        break;
      }
      case "pause": {
        if (teamId) {
          pausedTeams.add(teamId);
          await emitEvent(
            createEvent({
              type: "control.team.pause",
              teamId,
              source: "telegram",
              payload: { action: "pause", teamId }
            })
          );
          await telegramBot.sendMessage(chatId, `Team ${teamId} paused.`);
        }
        break;
      }
      case "resume": {
        if (teamId) {
          pausedTeams.delete(teamId);
          await emitEvent(
            createEvent({
              type: "control.team.resume",
              teamId,
              source: "telegram",
              payload: { action: "resume", teamId }
            })
          );
          await telegramBot.sendMessage(chatId, `Team ${teamId} resumed.`);
        }
        break;
      }
      case "agents": {
        const agents = store.getActiveAgents();
        const active = agents.active || [];
        if (active.length === 0) {
          await telegramBot.sendMessage(chatId, "No active agents.");
        } else {
          const lines = active.map((a) => `• ${a.role} (${a.teamId}) — ${a.status} — ${a.model || "n/a"}`);
          await telegramBot.sendMessage(chatId, `*Active Agents (${active.length})*\n${lines.join("\n")}`);
        }
        break;
      }
      case "cancel":
        await telegramBot.sendMessage(chatId, `Cancel for task ${taskId || "?"} not yet implemented.`);
        break;
      default:
        await telegramBot.sendMessage(chatId, `Unknown command: ${command}`);
    }
  }
});

// Telegram bot start is deferred to server listen (see below)

function readTelegramRoutes() {
  const routesFile = path.join(root, "data", "telegram_routes.json");
  try {
    return JSON.parse(fs.readFileSync(routesFile, "utf8"));
  } catch {
    return { defaultChatId: cfg.telegramDefaultChatId, routes: {} };
  }
}

let activeAgents = 0;
let currentSystem = readSystemSnapshot();
let loadState = classifyLoad(currentSystem, cfg);
const activeTaskIds = new Set();
const pausedTeams = new Set();
let modelInventory = discoverLocalModels();
let modelRouting = loadModelRouting();
let modelLatency = readModelLatency();
let modelCapabilities = readModelCapabilities();

async function reconcileStaleTasks({ maxAgeMs = Number(process.env.STALE_TASK_MS || 600000) } = {}) {
  const now = Date.now();
  const flow = store.getTaskFlow({ limit: 2000 });
  let closed = 0;
  for (const row of flow) {
    if (!["running", "assigned", "queued"].includes(row.status)) continue;
    const started = row.startedAt ? Date.parse(row.startedAt) : Date.parse(row.lastUpdate);
    if (!Number.isFinite(started)) continue;
    if (now - started < maxAgeMs) continue;

    const durationMs = now - started;
    const teamId = row.teamId;

    await emitEvent(
      createEvent({
        type: row.status === "queued" ? "task.rejected" : "task.failed",
        teamId,
        source: "reconcile",
        payload: {
          taskId: row.taskId,
          role: row.role,
          error: "stale_task_reconciled",
          reason: "stale_task_reconciled",
          durationMs
        }
      })
    );

    if (row.status !== "queued") {
      await emitEvent(
        createEvent({
          type: "task.timeout",
          teamId,
          source: "reconcile",
          payload: { taskId: row.taskId, role: row.role, durationMs }
        })
      );
      await emitEvent(
        createEvent({
          type: "penalty.applied",
          teamId,
          source: "reconcile",
          payload: { taskId: row.taskId, role: row.role, pointsDeducted: 35, reason: "stale_task_timeout" }
        })
      );
    }

    activeTaskIds.delete(row.taskId);
    closed += 1;
  }
  if (closed > 0) activeAgents = Math.max(0, activeAgents - closed);
  return { closed, maxAgeMs };
}

app.use(express.json({ limit: "1mb" }));
const uiDistPath = path.join(root, "ui", "dist");
if (fs.existsSync(uiDistPath)) {
  app.use(express.static(uiDistPath));
}
app.use(express.static(path.join(__dirname, "..", "public")));

function broadcast(type, payload) {
  const msg = JSON.stringify({ type, payload, ts: new Date().toISOString() });
  wss.clients.forEach((client) => {
    if (client.readyState === 1) client.send(msg);
  });
}

async function emitEvent(rawEvent) {
  const event = normalizeEvent(rawEvent);
  const valid = validateEvent(event);
  if (!valid.ok) return { ok: false, reason: valid.reason };
  const result = await store.appendEvent(event);
  if (result.ok) {
    broadcast("event", event);
    maybeSendTelegramForSwarmEvent(event).catch(() => {});
  }
  return result;
}

async function emitEvents(events = []) {
  for (const e of events) await emitEvent(e);
}

function snapshot() {
  const counts = store.getActiveTeamAgentCounts();
  const agentState = store.getActiveAgents();
  const inventoryStatus = computeInventoryStatus({ models: modelInventory.models, routing: modelRouting });
  return {
    leaderboard: store.getLeaderboard(),
    teams: store.getTeams(),
    system: currentSystem,
    loadState,
    queueDepth: queue.depth,
    activeAgents,
    activeAgentDetails: agentState.active,
    recentAgentDetails: agentState.recent,
    activeTeamAgents: counts,
    maxActiveAgents: cfg.maxActiveAgents,
    runnerMode: cfg.runnerMode,
    modelInventory,
    modelRouting,
    modelLatency,
    modelCapabilities,
    modelInventoryStatus: inventoryStatus,
    adminKeyRequired: Boolean(process.env.ADMIN_API_KEY),
    events: store.getEvents(100),
    vllmStatus: vllmStatusCache,
    autonomousStatus: autonomousLoop ? {
      running: autonomousLoop.running || false,
      currentObjective: autonomousLoop.competitiveCoordinator?.currentObjective || null,
      currentPhase: autonomousLoop.competitiveCoordinator?.currentPhase || "idle",
      totalObjectives: autonomousLoop.objectivesDispatched || 0,
      intervalMs: autonomousLoop.currentInterval || autonomousLoop.baseInterval || 90000
    } : null
  };
}

app.get("/api/health", (_req, res) => {
  res.json({ ok: true, loadState, ts: new Date().toISOString() });
});

// Log tail for dashboard LogViewerPanel - reads last N lines from server log file
app.get("/api/admin/log-tail", requireAdmin, (req, res) => {
  const lines = Math.min(500, Math.max(1, Number(req.query.lines || 50)));
  const logPath = process.env.SWARM_LOG_PATH || "/tmp/swarm-server.log";
  try {
    if (!fs.existsSync(logPath)) {
      return res.json({ lines: [], logPath, note: "log file not found - set SWARM_LOG_PATH or redirect stdout to /tmp/swarm-server.log" });
    }
    const content = fs.readFileSync(logPath, "utf8");
    const all = content.split("\n").filter(Boolean);
    return res.json({ lines: all.slice(-lines), logPath });
  } catch (err) {
    return res.json({ lines: [], logPath, error: err?.message });
  }
});

// vLLM / backend status - checks if fast inference backend is available
// Backend: NVIDIA official Docker container (nvcr.io/nvidia/vllm:26.02-py3)
// Start: scripts/start-vllm.sh  |  Stop: docker rm -f vllm-server
let vllmStatusCache = { available: false, checkedAt: 0, model: null };
async function checkVllmHealth() {
  const vllmUrl = process.env.VLLM_BASE_URL || "http://127.0.0.1:8000/v1";
  try {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), 2000);
    const res = await fetch(`${vllmUrl}/models`, { signal: ctrl.signal });
    clearTimeout(timer);
    if (res.ok) {
      const data = await res.json();
      const models = data?.data?.map(m => m.id) || [];
      vllmStatusCache = { available: true, checkedAt: Date.now(), url: vllmUrl, models, provider: "dgx-vllm" };
    } else {
      vllmStatusCache = { available: false, checkedAt: Date.now(), url: vllmUrl, error: `HTTP ${res.status}` };
    }
  } catch (err) {
    vllmStatusCache = { available: false, checkedAt: Date.now(), url: vllmUrl, error: err?.message };
  }
  return vllmStatusCache;
}
setInterval(() => checkVllmHealth().catch(() => {}), 30000);
checkVllmHealth().catch(() => {});

app.get("/api/backend-status", async (_req, res) => {
  const fresh = Date.now() - vllmStatusCache.checkedAt < 35000;
  const status = fresh ? vllmStatusCache : await checkVllmHealth();
  res.json({
    ollama: { available: modelInventory.available, models: modelInventory.models?.length || 0 },
    vllm: status,
    activeBackend: status.available ? "vllm+ollama" : "ollama",
    runnerTimeoutMs: cfg.runnerTimeoutMs
  });
});

app.get("/api/snapshot", (_req, res) => {
  res.json(snapshot());
});

app.get("/api/leaderboard", (_req, res) => {
  res.json({ leaderboard: store.getLeaderboard() });
});


app.get("/api/agents", (_req, res) => {
  res.json(store.getActiveAgents());
});

app.get("/api/chats", (req, res) => {
  const teamId = req.query.teamId ? String(req.query.teamId) : undefined;
  res.json({ chats: store.getTeamChats(teamId, 400) });
});

app.get("/api/telegram", (_req, res) => {
  res.json({
    enabled: Boolean(cfg.telegramToken),
    defaultChatId: cfg.telegramDefaultChatId,
    proof: store.getTelegramProof(300)
  });
});


app.get("/api/tasks", (_req, res) => {
  res.json({ tasks: store.getTaskSessions() });
});

app.get("/api/openclaw", (_req, res) => {
  const ocfg = readOpenClawConfig();
  const webSearch = ocfg?.tools?.web?.search || {};
  const sandbox = ocfg?.agents?.defaults?.sandbox || {};
  const braveKeyFromEnv = process.env.BRAVE_API_KEY || "";
  const braveKeyFromConfig = webSearch.apiKey || "";
  const webSearchConfigured = Boolean(webSearch.enabled && webSearch.provider && (braveKeyFromEnv || braveKeyFromConfig));
  const sandboxConfigured = Boolean(sandbox.mode && sandbox.scope);
  const canvasUrl = `${cfg.openclawGatewayUrl}${cfg.openclawCanvasPath}`;
  res.json({
    gatewayUrl: cfg.openclawGatewayUrl,
    canvasUrl,
    sshTunnelHint: "ssh -L 18789:127.0.0.1:18789 <user>@<dgx-host>",
    websocketUrl: cfg.openclawGatewayUrl.replace("http://", "ws://").replace("https://", "wss://"),
    webSearch: {
      enabled: Boolean(webSearch.enabled),
      provider: webSearch.provider || null,
      configured: webSearchConfigured
    },
    sandbox: {
      mode: sandbox.mode || null,
      scope: sandbox.scope || null,
      browserEnabled: Boolean(sandbox?.browser?.enabled),
      configured: sandboxConfigured
    },
    telegram: {
      configured: Boolean(cfg.telegramToken),
      channelEnabled: Boolean(ocfg?.channels?.telegram?.enabled)
    }
  });
});


app.get("/api/audit", (_req, res) => {
  const events = store.getEvents(1000);
  const audit = events.map((e) => ({
    id: e.id,
    ts: e.ts,
    teamId: e.teamId,
    type: e.type,
    taskId: e.payload?.taskId || null,
    source: e.source,
    detail: e.payload?.text || e.payload?.reason || e.payload?.rationale || e.payload?.task || null
  }));
  res.json({ audit: audit.slice(-300) });
});

app.get("/api/flow", (req, res) => {
  const teamId = req.query.teamId ? String(req.query.teamId) : undefined;
  res.json({ flow: store.getTaskFlow({ teamId, limit: 300 }) });
});

app.get("/api/objectives", (req, res) => {
  const teamId = req.query.teamId ? String(req.query.teamId) : undefined;
  const rows = store.getObjectiveBoard(200);
  res.json({ objectives: teamId ? rows.filter((r) => r.teamId === teamId) : rows });
});


app.get("/api/agent-output/:taskId", async (req, res) => {
  const taskId = req.params.taskId;
  const row = await db.getAgentOutput(taskId);
  if (!row) return res.status(404).json({ ok: false, error: "TASK_NOT_FOUND" });
  res.json({
    taskId: row.task_id,
    teamId: row.team_id,
    role: row.role,
    model: row.model,
    outputText: row.output_text,
    toolCalls: row.tool_calls,
    reasoningTrace: row.reasoning_trace,
    metrics: row.metrics,
    rawOutput: row.raw_output,
    createdAt: row.created_at
  });
});

app.get("/api/agent-traces/:objectiveId", async (req, res) => {
  const objectiveId = req.params.objectiveId;
  const events = store.getEvents(5000);
  const traces = events
    .filter((e) => {
      const oid = e.payload?.objectiveId;
      const tid = e.payload?.taskId || "";
      return oid === objectiveId || tid.startsWith(objectiveId);
    })
    .map((e) => ({
      id: e.id,
      ts: e.ts,
      type: e.type,
      teamId: e.teamId,
      source: e.source,
      role: e.payload?.role || null,
      model: e.payload?.model || null,
      taskId: e.payload?.taskId || null,
      output: e.payload?.output ? e.payload.output.slice(0, 2000) : null,
      toolCalls: e.payload?.toolCalls || null,
      reasoningTrace: e.payload?.reasoningTrace ? e.payload.reasoningTrace.slice(0, 2000) : null,
      durationMs: e.payload?.durationMs || null,
      correctness: e.payload?.correctness || null,
      error: e.payload?.error || null,
      feedback: e.payload?.feedback || null,
      pointsAdded: e.payload?.pointsAdded || null,
      pointsDeducted: e.payload?.pointsDeducted || null,
      reason: e.payload?.reason || null
    }));
  res.json({ objectiveId, traces });
});

app.get("/api/swarm-session/:objectiveId", async (req, res) => {
  const objectiveId = req.params.objectiveId;
  const row = await db.getSwarmSession(objectiveId);
  if (!row) return res.status(404).json({ ok: false, error: "SESSION_NOT_FOUND" });
  res.json({
    id: row.id,
    objectiveId: row.objective_id,
    teamId: row.team_id,
    objective: row.objective_text,
    plan: row.coordinator_plan,
    subTasks: row.sub_tasks,
    status: row.status,
    finalOutput: row.final_output,
    iterations: row.iteration_count,
    createdAt: row.created_at,
    updatedAt: row.updated_at
  });
});

app.get("/api/swarm-sessions", async (req, res) => {
  const teamId = req.query.teamId || undefined;
  const status = req.query.status || undefined;
  const limit = Math.min(200, Math.max(1, Number(req.query.limit || 50)));
  const rows = await db.listSwarmSessions({ teamId, status, limit });
  res.json({
    sessions: (rows || []).map((r) => ({
      id: r.id,
      objectiveId: r.objective_id,
      teamId: r.team_id,
      objective: r.objective_text,
      status: r.status,
      iterations: r.iteration_count,
      createdAt: r.created_at,
      updatedAt: r.updated_at
    }))
  });
});



app.get("/api/telegram-messages", (req, res) => {
  const chatId = req.query.chatId || cfg.telegramDefaultChatId;
  const limit = Math.min(200, Math.max(1, Number(req.query.limit || 100)));
  const proof = store.getTelegramProof(limit);
  res.json({ messages: proof || [] });
});

app.post("/api/events", requireAdmin, async (req, res) => {
  const body = req.body || {};
  const check = validateEventBody(body);
  if (!check.ok) return res.status(400).json({ ok: false, error: check.error });

  const event = normalizeEvent({
    id: body.id,
    ts: body.ts,
    type: body.type || "task.checkpoint",
    teamId: body.teamId || "team-alpha",
    source: "api",
    payload: body.payload || {}
  });

  await emitEvent(event);
  res.status(201).json({ ok: true, event });
});

app.post("/api/control/team", requireAdmin, async (req, res) => {
  const teamId = String(req.body?.teamId || "").trim();
  const action = String(req.body?.action || "").trim();
  if (!teamId || !["pause", "resume"].includes(action)) {
    return res.status(400).json({ ok: false, error: "teamId and action(pause|resume) required" });
  }

  if (action === "pause") pausedTeams.add(teamId);
  if (action === "resume") pausedTeams.delete(teamId);

  await emitEvent(
    createEvent({
      type: action === "pause" ? "control.team.pause" : "control.team.resume",
      teamId,
      source: "program-lead",
      payload: { action, teamId }
    })
  );

  return res.json({ ok: true, pausedTeams: [...pausedTeams] });
});

app.post("/api/control/reconcile", requireAdmin, async (req, res) => {
  const maxAgeMs = Number(req.body?.maxAgeMs || process.env.STALE_TASK_MS || 900000);
  const result = await reconcileStaleTasks({ maxAgeMs });
  broadcast("state", snapshot());
  return res.json({ ok: true, ...result });
});

app.post("/api/orchestrator/autonomous-run", requireAdmin, async (req, res) => {
  const teamId = String(req.body?.teamId || "").trim();
  const objective = String(req.body?.objective || "").trim();
  const objectiveId = `obj-${Date.now()}`;
  const rounds = Math.max(1, Math.min(6, Number(req.body?.rounds || 3)));
  if (!teamId || !objective) {
    return res.status(400).json({ ok: false, error: "teamId and objective required" });
  }

  await emitEvent(
    createEvent({
      type: "orchestrator.autonomous.start",
      teamId,
      source: "program-lead",
      payload: { objectiveId, objective, rounds }
    })
  );

  await emitEvent(
    createEvent({
      type: "objective.created",
      teamId,
      source: "program-lead",
      payload: { objectiveId, objective, actorRole: "program-lead" }
    })
  );

  const stages = ["Research objective", "Build implementation", "Critic review", "Integrate final output"];
  const launched = [];

  for (let i = 0; i < rounds; i += 1) {
    const stage = stages[i % stages.length];
    const task = `${stage}: ${objective} [round ${i + 1}]`;
    const check = validateDispatchBody({ teamId, task });
    if (!check.ok) continue;

    policyEngine.refresh();
    const predictedRole = policyEngine.inferRole(task);
    const teamCounts = store.getActiveTeamAgentCounts();
    const activeTeamAgents = teamCounts[teamId] || 0;
    const admissionDecision = admission.decide({
      rolePriority: Number(policyEngine.policies?.roles?.[predictedRole]?.priority || 2),
      role: predictedRole
    });

    const plan = createDispatchWithPolicy({
      teamId,
      task,
      actorRole: "program-lead",
      policyEngine,
      admissionDecision,
      activeAgents,
      maxAgents: cfg.maxActiveAgents,
      activeTeamAgents
    });

    await emitEvents(plan.events);
    if (plan.accepted) {
      await startExecution({
        teamId,
        task,
        taskId: plan.taskId,
        role: plan.role,
        policy: plan.policy,
        actorRole: "program-lead",
        objectiveId,
        objective
      });
    } else if (plan.queued) {
      queue.enqueue({
        teamId,
        task,
        taskId: plan.taskId,
        role: plan.role,
        priority: Number(plan.policy?.priority || 2),
        policy: plan.policy
      });
    }
    launched.push({ taskId: plan.taskId, role: plan.role, accepted: plan.accepted, queued: Boolean(plan.queued), reason: plan.reason || null });
  }

  await emitEvent(
    createEvent({
      type: "orchestrator.autonomous.end",
      teamId,
      source: "program-lead",
      payload: { objectiveId, objective, rounds, launched: launched.length }
    })
  );

  broadcast("state", snapshot());
  return res.json({ ok: true, launched });
});

app.post("/api/orchestrator/swarm-run", requireAdmin, async (req, res) => {
  const teamId = String(req.body?.teamId || "").trim();
  const objective = String(req.body?.objective || "").trim();
  const maxIterations = Math.min(5, Math.max(1, Number(req.body?.maxIterations || 3)));

  if (!teamId || !objective) {
    return res.status(400).json({ ok: false, error: "teamId and objective required" });
  }

  const objectiveId = `swarm-${Date.now()}`;
  const coordinator = new SwarmCoordinator({
    runTask,
    emitEvent,
    createEvent,
    store,
    db,
    modelName: process.env.COORDINATOR_MODEL || "qwen2.5:14b",
    chooseModelForRole: (opts) =>
      chooseModelForRole({
        ...opts,
        models: modelInventory.models,
        routing: modelRouting,
        latency: modelLatency
      }),
    timeoutMs: cfg.runnerTimeoutMs
  });

  coordinator
    .executeObjective({
      teamId,
      objective,
      objectiveId,
      maxIterations,
      onProgress: (progress) => broadcast("swarm.progress", progress)
    })
    .catch((err) => {
      emitEvent(
        createEvent({
          type: "swarm.session.failed",
          teamId,
          source: "coordinator",
          payload: { objectiveId, error: err?.message || String(err) }
        })
      );
    });

  return res.json({ ok: true, objectiveId, teamId });
});

async function maybeSendTelegramForTerminalEvent(event) {
  if (event.type !== "task.completed" && event.type !== "task.failed") return;
  const taskId = event.payload?.taskId;
  const session = store.getTaskSession(taskId);
  if (session?.actorRole !== "program-lead") return;
  const routes = readTelegramRoutes();
  const route = routes.routes?.[event.teamId] || {};
  const chatId = route.default || routes.defaultChatId;

  const text = [
    "PROGRAM LEAD UPDATE",
    `team=${event.teamId}`,
    `objective=${session?.objective || session?.task || "n/a"}`,
    `worker_role=${event.payload?.role || "unknown"}`,
    `task=${taskId || "n/a"}`,
    `status=${event.type === "task.completed" ? "completed" : "failed"}`
  ].join("\n");
  const delivery = await telegramRelay.send({ text, chatId });

  if (delivery.ok) {
    await emitEvent(
      createEvent({
        type: "telegram.sent",
        teamId: event.teamId,
        source: "telegram-relay",
        payload: {
          eventId: event.id,
          taskId,
          deliveryId: delivery.deliveryId,
          chatId: delivery.chatId,
          messageId: delivery.messageId
        }
      })
    );
  } else {
    await emitEvent(
      createEvent({
        type: "telegram.failed",
        teamId: event.teamId,
        source: "telegram-relay",
        payload: { eventId: event.id, taskId, reason: delivery.reason }
      })
    );
  }
}

const _swarmTelegramLastSent = new Map();
async function maybeSendTelegramForSwarmEvent(event) {
  // Only send Telegram for high-signal events. Competitive round summaries
  // are handled by competitiveCoordinator._sendRoundSummary().
  const importantTypes = new Set([
    "competitive.feedback",
    "competitive.restarting"
  ]);
  if (!importantTypes.has(event.type)) return;

  const chatId = cfg.telegramDefaultChatId;
  if (!chatId || !cfg.telegramToken) return;

  const key = `${event.type}:${event.payload?.objectiveId || ""}`;
  const now = Date.now();
  if (_swarmTelegramLastSent.has(key) && now - _swarmTelegramLastSent.get(key) < 10000) return;
  _swarmTelegramLastSent.set(key, now);

  let text = "";
  if (event.type === "competitive.restarting") {
    text = `*Self-update detected.* Graceful restart scheduled...`;
  }
  if (!text) return;

  try {
    await telegramBot.sendMessage(chatId, text);
  } catch { /* best-effort */ }
}

async function startExecution({ teamId, task, taskId, role, policy, actorRole = "team-lead", objectiveId = null, objective = null }) {
  if (activeTaskIds.has(taskId)) return;
  if (pausedTeams.has(teamId)) {
    await emitEvent(
      createEvent({
        type: "task.queued",
        teamId,
        source: "control",
        payload: { taskId, task, role, reason: "team_paused" }
      })
    );
    queue.enqueue({ teamId, task, taskId, role, priority: Number(policy?.priority || 2), policy });
    return;
  }

  activeTaskIds.add(taskId);
  activeAgents += 1;

  modelInventory = discoverLocalModels();
  modelRouting = loadModelRouting();
  modelLatency = readModelLatency();
  const chosen = learningAwareChooseModel({
    role,
    teamId,
    modelTier: policy?.modelTier || "standard",
  });

  await emitEvent(
    createEvent({
      type: "teamlead.objective.received",
      teamId,
      source: "program-lead",
      payload: {
        taskId,
        role,
        objectiveId: objectiveId || taskId,
        objective: objective || task,
        actorRole
      }
    })
  );

  await emitEvent(
    createEvent({
      type: "model.selected",
      teamId,
      source: "orchestrator",
      payload: {
        taskId,
        role,
        model: chosen.selectedModel,
        modelTier: chosen.tier || policy?.modelTier || "standard",
        rationale: chosen.rationale,
        alternatives: chosen.alternatives || [],
        estimatedLatencyMs: chosen.estimatedLatencyMs
      }
    })
  );

  await emitEvent(
    createEvent({
      type: "team.chat",
      teamId,
      source: "orchestrator",
      payload: {
        taskId,
        from: "program-lead",
        to: `${teamId}-lead`,
        channel: "internal-team",
        text: `Objective received and assigned: ${objective || task}`
      }
    })
  );

  await emitEvent(
    createEvent({
      type: "team.chat",
      teamId,
      source: "team-lead",
      payload: {
        taskId,
        from: `${teamId}-lead`,
        to: `${teamId}-${role}`,
        channel: "internal-team",
        text: `Subagent ${role} spawned for objective using model ${chosen.selectedModel}`
      }
    })
  );

  await emitEvent(
    createEvent({
      type: "subagent.spawned",
      teamId,
      source: "team-lead",
      payload: {
        taskId,
        role,
        objectiveId: objectiveId || taskId,
        objective: objective || task,
        model: chosen.selectedModel,
        modelTier: chosen.tier || policy?.modelTier || "standard"
      }
    })
  );

  store.mapTaskSession(taskId, {
    role,
    teamId,
    task,
    model: chosen.selectedModel,
    startedAt: new Date().toISOString(),
    modelTier: chosen.tier || policy?.modelTier || "standard",
    estimatedLatencyMs: chosen.estimatedLatencyMs || null,
    actorRole,
    objectiveId: objectiveId || taskId,
    objective: objective || task
  });

  runTask({
    teamId,
    role,
    taskId,
    taskText: task,
    modelName: chosen.selectedModel,
    timeoutMs: Number(policy?.timeoutMs || cfg.runnerTimeoutMs),
    telegramTo: cfg.telegramDefaultChatId,
    mode: cfg.runnerMode,
    onEvent: async (runnerEvent) => {
      const event = normalizeEvent({
        ...runnerEvent,
        source: "runner"
      });
      await emitEvent(event);

      if (event.type === "task.started") {
        await emitEvent(
          createEvent({
            type: "subagent.progress",
            teamId,
            source: "runner",
            payload: {
              taskId,
              role,
              status: "started",
              model: chosen.selectedModel
            }
          })
        );
        await emitEvent(
          createEvent({
            type: "team.chat",
            teamId,
            source: "runner",
            payload: {
              taskId,
              from: `${teamId}-${role}`,
              to: `${teamId}-lead`,
              channel: "internal-team",
              text: `Started task ${taskId} with model ${chosen.selectedModel}`
            }
          })
        );
      }

      if (event.type === "task.checkpoint") {
        await emitEvent(
          createEvent({
            type: "subagent.progress",
            teamId,
            source: "runner",
            payload: {
              taskId,
              role,
              status: "checkpoint",
              bytes: event.payload?.bytes || 0
            }
          })
        );
      }

      if (event.type === "task.completed" || event.type === "task.failed") {
        activeTaskIds.delete(taskId);
        activeAgents = Math.max(0, activeAgents - 1);
        await emitEvent(
          createEvent({
            type: event.type === "task.completed" ? "subagent.completed" : "subagent.failed",
            teamId,
            source: "runner",
            payload: {
              taskId,
              role,
              objectiveId: objectiveId || taskId,
              objective: objective || task,
              durationMs: event.payload?.durationMs || 0,
              model: chosen.selectedModel,
              status: event.type === "task.completed" ? "completed" : "failed"
            }
          })
        );
        await emitEvent(
          createEvent({
            type: "team.chat",
            teamId,
            source: "runner",
            payload: {
              taskId,
              from: `${teamId}-${role}`,
              to: `${teamId}-lead`,
              channel: "internal-team",
              text:
                event.type === "task.completed"
                  ? `Completed task ${taskId} in ${event.payload?.durationMs || 0}ms`
                  : `Failed task ${taskId}: ${event.payload?.error || "unknown"}`
            }
          })
        );
        await maybeSendTelegramForTerminalEvent(event);
        broadcast("state", snapshot());
      }
    }
  });
}

app.post("/api/orchestrator/dispatch", requireAdmin, async (req, res) => {
  const check = validateDispatchBody(req.body || {});
  if (!check.ok) return res.status(400).json({ ok: false, error: check.error });

  policyEngine.refresh();
  const teamId = req.body.teamId;
  const task = req.body.task;
  const actorRole = req.body.actorRole || "team-lead";
  const objectiveId = req.body.objectiveId || null;
  if (pausedTeams.has(teamId)) {
    return res.status(409).json({ ok: false, error: "team_paused" });
  }
  const predictedRole = policyEngine.inferRole(task);
  const teamCounts = store.getActiveTeamAgentCounts();
  const activeTeamAgents = teamCounts[teamId] || 0;

  const admissionDecision = admission.decide({
    rolePriority: Number(policyEngine.policies?.roles?.[predictedRole]?.priority || 2),
    role: predictedRole
  });

  const plan = createDispatchWithPolicy({
    teamId,
    task,
    actorRole,
    policyEngine,
    admissionDecision,
    activeAgents,
    maxAgents: cfg.maxActiveAgents,
    activeTeamAgents
  });

  await emitEvents(plan.events);
  await emitEvent(
    createEvent({
      type: "objective.created",
      teamId,
      source: actorRole,
      payload: {
        objectiveId: objectiveId || plan.taskId,
        objective: task,
        actorRole,
        taskId: plan.taskId
      }
    })
  );

  if (plan.queued) {
    queue.enqueue({
      teamId,
      task,
      taskId: plan.taskId,
      role: plan.role,
      priority: Number(plan.policy?.priority || 2),
      policy: plan.policy
    });
    broadcast("state", snapshot());
    return res.status(202).json({ accepted: false, queued: true, taskId: plan.taskId, reason: plan.reason, loadState });
  }

  if (!plan.accepted) {
    broadcast("state", snapshot());
    return res.status(202).json({ accepted: false, reason: plan.reason, taskId: plan.taskId, loadState });
  }

  await startExecution({
    teamId,
    task,
    taskId: plan.taskId,
    role: plan.role,
    policy: plan.policy,
    actorRole,
    objectiveId: objectiveId || plan.taskId,
    objective: task
  });

  broadcast("state", snapshot());
  return res.json({ accepted: true, taskId: plan.taskId, role: plan.role, loadState });
});

// Create global state accessor for ops routes
const globalState = {
  modelInventory,
  modelRouting,
  modelLatency,
  modelCapabilities,
  currentSystem,
  loadState
};

function getSystemState() {
  return {
    modelInventory: globalState.modelInventory,
    modelRouting: globalState.modelRouting,
    modelLatency: globalState.modelLatency,
    modelCapabilities: globalState.modelCapabilities,
    currentSystem: globalState.currentSystem,
    loadState: globalState.loadState
  };
}

// Register route modules for models and ops (non-dependent on autonomy)
registerModelRoutes(app, {
  discoverLocalModels,
  loadModelRouting,
  readModelLatency,
  readModelCapabilities,
  computeInventoryStatus,
  policyEngine,
  db,
  globalState
});

registerOpsRoutes(app, {
  getSystemState,
  queue,
  cfg,
  store,
  computeInventoryStatus,
  db,
  pausedTeams
});


// Register metrics endpoints (GPU, latency, throughput)
app.use("/api/metrics", createMetricsRouter({ store, queueManager: queue, modelCatalog: { discoverLocalModels, loadModelRouting, readModelLatency } }));

// Declare late-initialized instances here (before route registration) to avoid TDZ errors.
// These are set by startAutonomousLoop() after server.listen(). Routes use getter-based lazy refs.
let worktreeManager = null;
let competitiveCoord = null;
let autonomousLoop = null;
let teamLearningInstance = null;
let explorationEngineInstance = null;
let objectivePerformanceTrackerInstance = null;
let specializationEngineInstance = null;

// Register autonomy/competitive/learning routes here (before catch-all) using lazy module-level refs.
// These instances are set by startAutonomousLoop() after server.listen(), but the routes must be
// registered before app.get("*") to avoid being caught by the catch-all.
registerAutonomyRoutes(app, {
  get autonomousLoop() { return autonomousLoop; },
  get teamLearningInstance() { return teamLearningInstance; },
  get objectivePerformanceTrackerInstance() { return objectivePerformanceTrackerInstance; },
  get competitiveCoord() { return competitiveCoord; },
  store,
  db
});

registerCompetitiveRoutes(app, {
  requireAdmin,
  store,
  get worktreeManager() { return worktreeManager; },
  get competitiveCoord() { return competitiveCoord; }
});

registerRequestRoutes(app, {
  requireAdmin,
  resourceRequests
});

// Resource cleaner: Docker pruning, disk/GPU monitoring
const resourceCleaner = new ResourceCleaner();
resourceCleaner.start();

app.get("/api/system/resources", (_req, res) => {
  res.json(resourceCleaner.getStatus());
});

registerLearningRoutes(app, {
  get teamLearningInstance() { return teamLearningInstance; }
});

registerExplorationRoutes(app, {
  get explorationEngineInstance() { return explorationEngineInstance; }
});

registerSpecializationRoutes(app, {
  requireAdmin,
  get specializationEngine() { return specializationEngineInstance; }
});

registerAgentRoutes(app, {
  agentMemory
});

registerAiTechRoutes(app, {
  aiTechExplorer,
  requireAdmin
});

registerRagRoutes(app, {
  ragPipeline
});

registerFineTuningRoutes(app, {
  fineTuningPrep
});

app.get("*", (req, res) => {
  if (req.path.startsWith("/api/")) return res.status(404).json({ error: "not_found" });
  const indexPath = path.join(root, "ui", "dist", "index.html");
  if (fs.existsSync(indexPath)) {
    return res.sendFile(indexPath);
  }
  res.sendFile(path.join(root, "public", "index.html"));
});

wss.on("connection", (socket) => {
  socket.send(JSON.stringify({ type: "state", payload: snapshot(), ts: new Date().toISOString() }));
});

setInterval(() => {
  currentSystem = readSystemSnapshot();
  loadState = classifyLoad(currentSystem, cfg);
  loadState = admission.update({ systemSnapshot: currentSystem, queueDepth: queue.depth, activeAgents });
  queue.clearExpired(Number(process.env.QUEUE_MAX_AGE_MS || 300000));

  // Update global state
  globalState.currentSystem = currentSystem;
  globalState.loadState = loadState;

  if (currentSystem?.gpu?.available) {
    db.insertGpuSnapshot({
      ts: new Date().toISOString(),
      devices: currentSystem.gpu.devices || [],
      totalMemoryPct: currentSystem.gpu.usedPct ?? null,
      totalUtilPct: currentSystem.gpu.utilPct ?? null,
      activeAgents
    }).catch(() => {});
    broadcast("gpu.telemetry", {
      devices: currentSystem.gpu.devices || [],
      totalMemoryPct: currentSystem.gpu.usedPct,
      totalUtilPct: currentSystem.gpu.utilPct,
      ollamaRuntime: currentSystem.gpu.ollamaRuntime || [],
      processes: currentSystem.gpu.processes || []
    });
  }

  if (queue.depth > 0 && activeAgents < cfg.maxActiveAgents && loadState !== "critical") {
    const next = queue.dequeue();
    if (next) {
      startExecution({
        teamId: next.teamId,
        task: next.task,
        taskId: next.taskId,
        role: next.role,
        policy: next.policy
      });
    }
  }

  reconcileStaleTasks({ maxAgeMs: Number(process.env.STALE_TASK_MS || 900000) }).catch(() => {});

  broadcast("state", snapshot());
}, cfg.pollMs);

// Check for newly detected env tokens every 60 seconds
setInterval(() => {
  resourceRequests.checkEnvDetection();
}, 60000);

try {
  worktreeManager = new WorktreeManager({
    telegramBot,
    chatId: cfg.telegramDefaultChatId
  });
} catch (err) {
  console.warn("[server] WorktreeManager init failed:", err?.message);
}

function learningAwareChooseModel(opts) {
  const base = chooseModelForRole({
    ...opts,
    models: modelInventory.models,
    routing: modelRouting,
    latency: modelLatency
  });

  if (!teamLearningInstance || !opts.teamId) return base;

  const adaptive = teamLearningInstance.getAdaptiveModelChoice(
    opts.teamId,
    opts.role,
    base.selectedModel,
    modelRouting
  );

  if (adaptive.reason !== "default") {
    console.log(`[model-select] Learning override for ${opts.teamId}/${opts.role}: ${base.selectedModel} -> ${adaptive.model} (${adaptive.reason})`);
    return {
      ...base,
      selectedModel: adaptive.model,
      rationale: `${base.rationale} | Learning: ${adaptive.reason}`
    };
  }

  // Also check tool_capability lessons — if current model has been flagged as lacking tool support,
  // prefer a tool-capable model (qwen2.5-coder or deepseek-coder)
  if (opts.role === "build" || opts.role === "research") {
    const recentHistory = teamLearningInstance.roundHistory?.slice(-3) ?? [];
    const toolLessons = recentHistory
      .flatMap(r => r.lessons ?? [])
      .filter(l => l.teamId === opts.teamId && l.role === opts.role && l.category === "tool_capability" && l.model === base.selectedModel);
    if (toolLessons.length > 0) {
      const route = modelRouting?.roleRoutes?.[opts.role];
      const fallback = route?.fallback?.find(m => m.includes("coder") || m.includes("qwen"));
      if (fallback && fallback !== base.selectedModel) {
        console.log(`[model-select] Tool capability override for ${opts.teamId}/${opts.role}: ${base.selectedModel} -> ${fallback} (tool_capability lesson)`);
        return { ...base, selectedModel: fallback, rationale: `${base.rationale} | ToolCapability: switched to ${fallback}` };
      }
    }
  }

  return base;
}

async function startAutonomousLoop() {
  if (cfg.autonomousMode === "off") {
    console.log("[server] Autonomous mode is OFF.");
    return;
  }

  // Initialize RAG Pipeline
  try {
    await ragPipeline.init();
    console.log("[server] RAG Pipeline initialized");
  } catch (err) {
    console.warn("[server] RAG Pipeline init failed:", err.message);
  }

  // Initialize AI Tech Explorer
  try {
    await aiTechExplorer.init();
    console.log("[server] AI Tech Explorer initialized");
  } catch (err) {
    console.warn("[server] AI Tech Explorer init failed:", err.message);
  }

  // Initialize Fine-Tuning Data Preparation
  try {
    await fineTuningPrep.init();
    console.log("[server] Fine-Tuning Prep initialized");
  } catch (err) {
    console.warn("[server] Fine-Tuning Prep init failed:", err.message);
  }

  teamLearningInstance = new TeamLearning({ db, store });
  await teamLearningInstance.init();
  await teamLearningInstance.rebuildFromDb();

  objectivePerformanceTrackerInstance = new ObjectivePerformanceTracker({ db });
  await objectivePerformanceTrackerInstance.init();

  specializationEngineInstance = new SpecializationEngine({
    dataDir: path.join(root, "data"),
    teamLearning: teamLearningInstance,
    objectivePerformanceTracker: objectivePerformanceTrackerInstance
  });
  await specializationEngineInstance.init();

  explorationEngineInstance = new ExplorationEngine({ db, store, teamLearning: teamLearningInstance, specializationEngine: specializationEngineInstance, aiTechExplorer });

  const runTaskWithTools = (opts) => runTask({ ...opts, explorationEngine: explorationEngineInstance });

  const coordinatorOpts = {
    runTask: runTaskWithTools,
    emitEvent,
    createEvent,
    store,
    db,
    modelName: process.env.COORDINATOR_MODEL || "qwen2.5:14b",
    chooseModelForRole: learningAwareChooseModel,
    timeoutMs: cfg.runnerTimeoutMs,
    explorationEngine: explorationEngineInstance,
    teamLearning: teamLearningInstance
  };

  const coordinator = new SwarmCoordinator(coordinatorOpts);

  competitiveCoord = new CompetitiveCoordinator({
    ...coordinatorOpts,
    worktreeManager,
    telegramBot,
    chatId: cfg.telegramDefaultChatId,
    teamLearning: teamLearningInstance,
    objectivePerformanceTracker: objectivePerformanceTrackerInstance,
    agentMemory,
    ragPipeline,
    fineTuningPrep,
    specializationEngine: specializationEngineInstance
  });

  autonomousLoop = new AutonomousLoop({
    competitiveCoordinator: competitiveCoord,
    coordinator,
    telegramBot,
    telegramRelay,
    store,
    db,
    chatId: cfg.telegramDefaultChatId,
    interval: 90000,
    emitEvent,
    createEvent,
    teamLearning: teamLearningInstance,
    explorationEngine: explorationEngineInstance,
    admissionController: admission,
    objectivePerformanceTracker: objectivePerformanceTrackerInstance,
    specializationEngine: specializationEngineInstance,
    projectRoot: path.resolve(__dirname, '..', '..')
  });

  // Routes were pre-registered with lazy refs before app.get("*"); just start the loop.
  setTimeout(() => autonomousLoop.start(), 5000);
  console.log("[server] Competitive autonomous loop will start in 5 seconds.");

  // Periodic 30-minute health report to Telegram
  setInterval(async () => {
    if (!autonomousLoop?.running || !cfg.telegramToken) return;
    try {
      const stats = autonomousLoop._gatherStats();
      const text = [
        `*30-min Health Report*`,
        `Scores: α=${stats.alphaScore} β=${stats.betaScore} γ=${stats.gammaScore}`,
        `Completed: ${stats.completed} · Latency: ${Math.round(stats.avgLatency / 1000)}s`,
        `Critic: ${Math.round(stats.criticApprovalRate * 100)}%`,
        `Dispatched: ${autonomousLoop.objectivesDispatched} · Load: ${loadState}`,
        `vLLM: ${vllmStatusCache.available ? "Online" : "Offline"}`
      ].join("\n");
      await telegramBot.sendMessage(cfg.telegramDefaultChatId, text).catch(() => {});
    } catch { /* best-effort */ }
  }, 30 * 60 * 1000);
}

async function gracefulShutdown(signal) {
  console.log(`[server] ${signal} received. Shutting down gracefully...`);

  if (autonomousLoop) {
    autonomousLoop.stop();
  }

  // Close all open connections immediately so the port is released quickly.
  // This prevents EADDRINUSE when PM2 restarts before the old process fully exits.
  wss.close();
  if (typeof server.closeAllConnections === "function") {
    server.closeAllConnections(); // Node 18.2+
  }
  server.close(() => {
    console.log("[server] HTTP server closed.");
  });

  try {
    await db.close?.();
  } catch { /* best-effort */ }

  // Short timeout — port must be free before PM2 starts the new process
  setTimeout(() => {
    console.log("[server] Force exit after timeout.");
    process.exit(0);
  }, 2000);
}

process.on("SIGTERM", () => gracefulShutdown("SIGTERM"));
process.on("SIGINT", () => gracefulShutdown("SIGINT"));

const checkOnly = process.argv.includes("--check");
if (!checkOnly) {
  db.init()
    .then(() => {
      server.listen(cfg.port, "0.0.0.0", () => {
        console.log(`swarm-platform running at http://0.0.0.0:${cfg.port}`);
        if (cfg.telegramToken) telegramBot.start();
        startAutonomousLoop();
      });
    })
    .catch((error) => {
      console.error("db init failed, continuing in fallback mode", error.message);
      server.listen(cfg.port, "0.0.0.0", () => {
        console.log(`swarm-platform running at http://0.0.0.0:${cfg.port}`);
        if (cfg.telegramToken) telegramBot.start();
        startAutonomousLoop();
      });
    });
} else {
  console.log("configuration check ok");
}
