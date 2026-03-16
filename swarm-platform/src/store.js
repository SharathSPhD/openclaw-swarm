import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { summarizeTeam } from "./scoring.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const root = path.resolve(__dirname, "..");
const dataDir = process.env.SWARM_DATA_DIR || path.join(root, "data");
const eventsFile = path.join(dataDir, "events.jsonl");
const teamsFile = path.join(dataDir, "teams.json");
const taskMapFile = path.join(dataDir, "task_sessions.json");

function ensureFile(filePath, seed = "") {
  if (!fs.existsSync(filePath)) fs.writeFileSync(filePath, seed, "utf8");
}

function readEvents() {
  ensureFile(eventsFile, "");
  return fs
    .readFileSync(eventsFile, "utf8")
    .split("\n")
    .filter(Boolean)
    .map((line) => { try { return JSON.parse(line); } catch { return null; } })
    .filter(Boolean);
}

function readTeams() {
  ensureFile(teamsFile, JSON.stringify({ teams: [] }, null, 2));
  return JSON.parse(fs.readFileSync(teamsFile, "utf8")).teams || [];
}

function readTaskMap() {
  ensureFile(taskMapFile, JSON.stringify({ tasks: {} }, null, 2));
  return JSON.parse(fs.readFileSync(taskMapFile, "utf8")).tasks || {};
}

export class Store {
  constructor(maxEvents = 5000, db = null, eventProcessor = null) {
    this.maxEvents = maxEvents;
    this.db = db;
    this.eventProcessor = eventProcessor;
    ensureFile(eventsFile, "");
    ensureFile(teamsFile, JSON.stringify({ teams: [] }, null, 2));
    ensureFile(taskMapFile, JSON.stringify({ tasks: {} }, null, 2));
  }

  async appendEvent(event) {
    if (!event?.id) return { ok: false, reason: "missing_event_id" };
    const existing = this.getEvents(this.maxEvents).some((e) => e.id === event.id);
    if (existing) return { ok: true, duplicate: true };

    fs.appendFileSync(eventsFile, `${JSON.stringify(event)}\n`, "utf8");
    this._trimEvents();

    if (this.eventProcessor) await this.eventProcessor.process(event);
    return { ok: true };
  }

  _trimEvents() {
    const events = readEvents();
    if (events.length <= this.maxEvents) return;
    const trimmed = events.slice(events.length - this.maxEvents);
    fs.writeFileSync(eventsFile, trimmed.map((e) => JSON.stringify(e)).join("\n") + "\n", "utf8");
  }

  getEvents(limit = 500) {
    const events = readEvents();
    return events.slice(Math.max(0, events.length - limit));
  }

  getTeams() {
    return readTeams();
  }

  getTeam(teamId) {
    return this.getTeams().find((t) => t.id === teamId) || null;
  }

  mapTaskSession(taskId, sessionMeta) {
    const tasks = readTaskMap();
    tasks[taskId] = sessionMeta;
    fs.writeFileSync(taskMapFile, JSON.stringify({ tasks }, null, 2), "utf8");
  }

  getTaskSession(taskId) {
    const tasks = readTaskMap();
    return tasks[taskId] || null;
  }

  getTaskSessions() {
    return readTaskMap();
  }

  getActiveTeamAgentCounts() {
    const events = this.getEvents(this.maxEvents);
    const counts = {};
    const open = new Set();
    // Tasks older than 10 min are considered done regardless (handles truncated logs)
    const cutoff = Date.now() - 10 * 60 * 1000;

    for (const e of events) {
      const taskId = e.payload?.taskId;
      if (!taskId) continue;
      if (e.type === "task.started" || e.type === "agent.assigned") {
        const ts = new Date(e.ts).getTime();
        if (ts >= cutoff) open.add(`${e.teamId}:${taskId}`);
      }
      if (e.type === "task.completed" || e.type === "task.failed" || e.type === "task.rejected") {
        open.delete(`${e.teamId}:${taskId}`);
      }
    }

    for (const key of open) {
      const [teamId] = key.split(":");
      counts[teamId] = (counts[teamId] || 0) + 1;
    }
    return counts;
  }

  getLeaderboard() {
    const teams = this.getTeams();
    const events = this.getEvents(this.maxEvents);
    const rows = teams.map((t) => ({ ...summarizeTeam(events, t.id), teamName: t.name }));
    // Filter out gamma and delta: only alpha and beta appear on leaderboard
    const filtered = rows.filter(r => !["team-gamma", "team-delta"].includes(r.teamId));
    filtered.sort((a, b) => b.score - a.score || b.accuracy - a.accuracy || b.completed - a.completed);
    return filtered.map((r, idx) => ({ ...r, rank: idx + 1 }));
  }

  getTeamChats(teamId, limit = 200) {
    const events = this.getEvents(this.maxEvents)
      .filter((e) => e.type === "team.chat" && (!teamId || e.teamId === teamId))
      .slice(-limit);
    return events.map((e) => ({
      id: e.id,
      ts: e.ts,
      teamId: e.teamId,
      from: e.payload?.from || "agent",
      to: e.payload?.to || "team",
      channel: e.payload?.channel || "internal",
      text: e.payload?.text || ""
    }));
  }

  getTelegramProof(limit = 200) {
    return this.getEvents(this.maxEvents)
      .filter((e) => e.type === "telegram.sent" || e.type === "telegram.failed")
      .slice(-limit)
      .map((e) => ({
        id: e.id,
        ts: e.ts,
        teamId: e.teamId,
        type: e.type,
        taskId: e.payload?.taskId || null,
        chatId: e.payload?.chatId || null,
        messageId: e.payload?.messageId || null,
        reason: e.payload?.reason || null
      }));
  }

  getObjectiveBoard(limit = 200) {
    const trackedTypes = new Set([
      "objective.created", "orchestrator.autonomous.start", "orchestrator.autonomous.end",
      "teamlead.objective.received", "swarm.session.created", "swarm.session.completed",
      "swarm.session.failed", "swarm.session.decomposed", "swarm.session.executing",
      "swarm.session.reviewing", "swarm.session.aggregating",
      "competitive.started", "competitive.forked", "competitive.evaluated",
      "competitive.implementing", "competitive.merged", "competitive.restarting",
      "competitive.quality-gate-failed", "objective.failed", "objective.completed"
    ]);
    const events = this.getEvents(this.maxEvents).filter((e) => trackedTypes.has(e.type));

    const objectives = new Map();
    for (const e of events) {
      const objectiveId = e.payload?.objectiveId || e.payload?.taskId || e.id;
      const current = objectives.get(objectiveId) || {
        objectiveId,
        teamId: e.teamId,
        objective: e.payload?.objective || e.payload?.task || "",
        status: "active",
        createdAt: e.ts,
        updatedAt: e.ts,
        actorRole: e.payload?.actorRole || "program-lead",
        rounds: e.payload?.rounds || 1,
        steps: []
      };

      current.teamId = e.teamId || current.teamId;
      current.objective = e.payload?.objective || e.payload?.task || current.objective;
      current.updatedAt = e.ts;
      current.steps.push({ ts: e.ts, type: e.type, source: e.source, summary: e.payload?.summary || e.payload?.task || "" });
      if (e.type === "orchestrator.autonomous.end" || e.type === "swarm.session.completed" || e.type === "competitive.merged") current.status = "completed";
      if (e.type === "swarm.session.failed" || e.type === "objective.failed" || e.type === "competitive.quality-gate-failed") current.status = "failed";
      if (e.type === "competitive.evaluated") current.winner = e.payload?.winner;

      objectives.set(objectiveId, current);
    }

    const now = Date.now();
    const STALE_OBJECTIVE_MS = 10 * 60 * 1000;
    for (const obj of objectives.values()) {
      if (obj.status === "active") {
        const lastUpdate = Date.parse(obj.updatedAt);
        if (Number.isFinite(lastUpdate) && now - lastUpdate > STALE_OBJECTIVE_MS) {
          obj.status = "failed";
        }
      }
    }

    return [...objectives.values()]
      .sort((a, b) => String(b.updatedAt).localeCompare(String(a.updatedAt)))
      .slice(0, limit);
  }

  getTaskFlow({ teamId, limit = 300 } = {}) {
    const tasks = readTaskMap();
    const events = this.getEvents(this.maxEvents).filter((e) => !teamId || e.teamId === teamId);
    const rows = new Map();

    for (const e of events) {
      const taskId = e.payload?.taskId;
      if (!taskId) continue;
      const session = tasks[taskId] || {};
      const current = rows.get(taskId) || {
        taskId,
        teamId: e.teamId,
        role: session.role || e.payload?.role || "unknown",
        actorRole: session.actorRole || "team-lead",
        objectiveId: session.objectiveId || null,
        objective: session.objective || session.task || e.payload?.objective || "",
        task: session.task || e.payload?.task || "",
        model: session.model || null,
        modelTier: session.modelTier || null,
        estimatedLatencyMs: session.estimatedLatencyMs || null,
        status: "created",
        startedAt: null,
        endedAt: null,
        durationMs: null,
        internalMessages: 0,
        telegramUpdates: 0,
        lastUpdate: e.ts,
        timeline: []
      };

      if (e.type === "model.selected") {
        current.model = e.payload?.model || current.model;
        current.modelTier = e.payload?.modelTier || current.modelTier;
        current.estimatedLatencyMs = e.payload?.estimatedLatencyMs || current.estimatedLatencyMs;
      }
      if (e.type === "task.started") {
        current.status = "running";
        current.startedAt = current.startedAt || e.ts;
      }
      if (e.type === "task.completed") {
        current.status = "completed";
        current.endedAt = e.ts;
        current.durationMs = e.payload?.durationMs || current.durationMs;
      }
      if (e.type === "task.failed") {
        current.status = "failed";
        current.endedAt = e.ts;
        current.durationMs = e.payload?.durationMs || current.durationMs;
      }
      if (e.type === "task.queued") current.status = "queued";
      if (e.type === "task.rejected") current.status = "rejected";
      if (e.type === "team.chat") current.internalMessages += 1;
      if (e.type === "telegram.sent" || e.type === "telegram.failed") current.telegramUpdates += 1;

      current.lastUpdate = e.ts;
      current.timeline.push({
        ts: e.ts,
        type: e.type,
        source: e.source,
        note: e.payload?.text || e.payload?.reason || e.payload?.rationale || ""
      });

      rows.set(taskId, current);
    }

    return [...rows.values()]
      .sort((a, b) => String(b.lastUpdate).localeCompare(String(a.lastUpdate)))
      .slice(0, limit);
  }

  getActiveAgents(limit = 300) {
    const events = this.getEvents(this.maxEvents);
    const registry = new Map();

    for (const e of events) {
      const taskId = e.payload?.taskId;
      if (!taskId) continue;
      const key = `${e.teamId}:${taskId}`;
      const current = registry.get(key) || {
        teamId: e.teamId,
        taskId,
        role: e.payload?.role || "unknown",
        agentId: e.payload?.agentId || `${e.teamId}-${e.payload?.role || "unknown"}`,
        model: e.payload?.model || null,
        modelTier: e.payload?.modelTier || null,
        estimatedLatencyMs: e.payload?.estimatedLatencyMs || null,
        status: "unknown",
        startedAt: null,
        updatedAt: e.ts,
        task: e.payload?.task || null
      };

      if (e.type === "agent.assigned") {
        current.status = "assigned";
        current.role = e.payload?.role || current.role;
        current.agentId = e.payload?.agentId || current.agentId;
        current.task = e.payload?.task || current.task;
      }
      if (e.type === "model.selected") {
        current.model = e.payload?.model || current.model;
        current.modelTier = e.payload?.modelTier || current.modelTier;
        current.estimatedLatencyMs = e.payload?.estimatedLatencyMs || current.estimatedLatencyMs;
      }
      if (e.type === "task.started") {
        current.status = "running";
        current.startedAt = current.startedAt || e.ts;
      }
      if (e.type === "task.completed") current.status = "completed";
      if (e.type === "task.failed") current.status = "failed";
      if (e.type === "task.queued") current.status = "queued";
      if (e.type === "task.rejected") current.status = "rejected";

      current.updatedAt = e.ts;
      registry.set(key, current);
    }

    const all = [...registry.values()].sort((a, b) => String(b.updatedAt).localeCompare(String(a.updatedAt)));
    const active = all.filter((a) => ["assigned", "running", "queued"].includes(a.status));
    return { active: active.slice(0, limit), recent: all.slice(0, limit) };
  }
}
