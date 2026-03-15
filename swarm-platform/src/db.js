import { Pool } from "pg";

export class DB {
  constructor(connectionString) {
    this.enabled = Boolean(connectionString);
    this.pool = this.enabled ? new Pool({ connectionString }) : null;
  }

  async init() {
    if (!this.enabled) return;
    const { readFileSync } = await import("fs");
    const { fileURLToPath } = await import("url");
    const { dirname, join } = await import("path");
    const __dirname = dirname(fileURLToPath(import.meta.url));
    const schemaPath = join(__dirname, "..", "db", "schema.sql");
    const schema = readFileSync(schemaPath, "utf8");
    await this.pool.query(schema);
  }

  async insertEvent(event) {
    if (!this.enabled) return { ok: false, reason: "db_disabled" };
    try {
      await this.pool.query(
        `INSERT INTO events (id, ts, type, team_id, source, payload) VALUES ($1, $2, $3, $4, $5, $6) ON CONFLICT (id) DO NOTHING`,
        [event.id, event.ts, event.type, event.teamId, event.source, JSON.stringify(event.payload)]
      );
      return { ok: true };
    } catch (error) {
      return { ok: false, reason: error.message };
    }
  }

  async close() {
    if (this.pool) await this.pool.end();
  }

  async insertAgentOutput({ taskId, teamId, role, model, outputText, toolCalls, reasoningTrace, metrics, rawOutput }) {
    if (!this.pool) return null;
    try {
      const res = await this.pool.query(
        `INSERT INTO agent_outputs (task_id, team_id, role, model, output_text, tool_calls, reasoning_trace, metrics, raw_output)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9) RETURNING id`,
        [
          taskId,
          teamId,
          role,
          model ?? "unknown",
          outputText ?? null,
          toolCalls ? JSON.stringify(toolCalls) : "[]",
          reasoningTrace ?? null,
          metrics ? JSON.stringify(metrics) : "{}",
          rawOutput ?? null,
        ]
      );
      return res.rows[0]?.id ?? null;
    } catch (err) {
      console.warn("[db] insertAgentOutput:", err.message);
      return null;
    }
  }

  async getAgentOutput(taskId) {
    if (!this.pool) return null;
    try {
      const res = await this.pool.query(
        `SELECT * FROM agent_outputs WHERE task_id = $1 ORDER BY created_at DESC LIMIT 1`,
        [taskId]
      );
      return res.rows[0] ?? null;
    } catch (err) {
      console.warn("[db] getAgentOutput:", err.message);
      return null;
    }
  }

  async insertSwarmSession({ id, objectiveId, teamId, objectiveText, status }) {
    if (!this.pool) return null;
    try {
      await this.pool.query(
        `INSERT INTO swarm_sessions (id, objective_id, team_id, objective_text, status)
         VALUES ($1, $2, $3, $4, $5)`,
        [id, objectiveId, teamId, objectiveText, status ?? "created"]
      );
      return true;
    } catch (err) {
      console.warn("[db] insertSwarmSession:", err.message);
      return null;
    }
  }

  async updateSwarmSession(objectiveId, updates) {
    if (!this.pool) return null;
    try {
      const allowed = ["coordinator_plan", "sub_tasks", "status", "final_output", "iteration_count"];
      const set = [];
      const vals = [];
      let i = 1;
      for (const [k, v] of Object.entries(updates)) {
        const col = k.replace(/([A-Z])/g, (_, c) => `_${c.toLowerCase()}`);
        if (allowed.includes(col) || allowed.includes(k)) {
          const key = col in { coordinator_plan: 1, sub_tasks: 1, status: 1, final_output: 1, iteration_count: 1 } ? col : k;
          set.push(`${key} = $${i++}`);
          vals.push(typeof v === "object" && v !== null ? JSON.stringify(v) : v);
        }
      }
      if (set.length === 0) return null;
      set.push(`updated_at = NOW()`);
      vals.push(objectiveId);
      await this.pool.query(
        `UPDATE swarm_sessions SET ${set.join(", ")} WHERE objective_id = $${i}`,
        vals
      );
      return true;
    } catch (err) {
      console.warn("[db] updateSwarmSession:", err.message);
      return null;
    }
  }

  async getSwarmSession(objectiveId) {
    if (!this.pool) return null;
    try {
      const res = await this.pool.query(
        `SELECT * FROM swarm_sessions WHERE objective_id = $1`,
        [objectiveId]
      );
      return res.rows[0] ?? null;
    } catch (err) {
      console.warn("[db] getSwarmSession:", err.message);
      return null;
    }
  }

  async listSwarmSessions({ teamId, status, limit = 50 }) {
    if (!this.pool) return [];
    try {
      const conditions = [];
      const vals = [];
      let i = 1;
      if (teamId) {
        conditions.push(`team_id = $${i++}`);
        vals.push(teamId);
      }
      if (status) {
        conditions.push(`status = $${i++}`);
        vals.push(status);
      }
      vals.push(limit);
      const where = conditions.length ? `WHERE ${conditions.join(" AND ")}` : "";
      const res = await this.pool.query(
        `SELECT * FROM swarm_sessions ${where} ORDER BY created_at DESC LIMIT $${i}`,
        vals
      );
      return res.rows ?? [];
    } catch (err) {
      console.warn("[db] listSwarmSessions:", err.message);
      return [];
    }
  }

  async insertModelMetric({ modelId, role, latencyMs, success, tokensIn, tokensOut, gpuMemoryMb }) {
    if (!this.pool) return null;
    try {
      const res = await this.pool.query(
        `INSERT INTO model_metrics (model_id, role, latency_ms, success, tokens_in, tokens_out, gpu_memory_mb)
         VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING id`,
        [
          modelId ?? "unknown",
          role,
          latencyMs ?? 0,
          success !== false,
          tokensIn ?? null,
          tokensOut ?? null,
          gpuMemoryMb ?? null,
        ]
      );
      return res.rows[0]?.id ?? null;
    } catch (err) {
      console.warn("[db] insertModelMetric:", err.message);
      return null;
    }
  }

  async getModelMetrics({ model, role, since, until, limit = 200 }) {
    if (!this.pool) return [];
    try {
      const conditions = [];
      const vals = [];
      let i = 1;
      if (model) {
        conditions.push(`model_id = $${i++}`);
        vals.push(model);
      }
      if (role) {
        conditions.push(`role = $${i++}`);
        vals.push(role);
      }
      if (since) {
        conditions.push(`created_at >= $${i++}`);
        vals.push(since);
      }
      if (until) {
        conditions.push(`created_at <= $${i++}`);
        vals.push(until);
      }
      vals.push(limit);
      const where = conditions.length ? `WHERE ${conditions.join(" AND ")}` : "";
      const res = await this.pool.query(
        `SELECT * FROM model_metrics ${where} ORDER BY created_at DESC LIMIT $${i}`,
        vals
      );
      return res.rows ?? [];
    } catch (err) {
      console.warn("[db] getModelMetrics:", err.message);
      return [];
    }
  }

  async insertTelegramMessage({ direction, chatId, messageText, command, objectiveId }) {
    if (!this.pool) return null;
    try {
      const res = await this.pool.query(
        `INSERT INTO telegram_messages (direction, chat_id, message_text, command, objective_id)
         VALUES ($1, $2, $3, $4, $5) RETURNING id`,
        [direction, chatId, messageText ?? null, command ?? null, objectiveId ?? null]
      );
      return res.rows[0]?.id ?? null;
    } catch (err) {
      console.warn("[db] insertTelegramMessage:", err.message);
      return null;
    }
  }

  async insertGpuSnapshot({ ts, devices, totalMemoryPct, totalUtilPct, activeAgents }) {
    if (!this.pool) return null;
    try {
      const res = await this.pool.query(
        `INSERT INTO gpu_snapshots (ts, devices, total_memory_pct, total_util_pct, active_agents)
         VALUES ($1, $2, $3, $4, $5) RETURNING id`,
        [
          ts ?? new Date().toISOString(),
          devices ? JSON.stringify(devices) : "[]",
          totalMemoryPct ?? null,
          totalUtilPct ?? null,
          activeAgents ?? 0,
        ]
      );
      return res.rows[0]?.id ?? null;
    } catch (err) {
      console.warn("[db] insertGpuSnapshot:", err.message);
      return null;
    }
  }

  async getGpuHistory({ since, until, limit = 200 }) {
    if (!this.pool) return [];
    try {
      const conditions = [];
      const vals = [];
      let i = 1;
      if (since) {
        conditions.push(`ts >= $${i++}`);
        vals.push(since);
      }
      if (until) {
        conditions.push(`ts <= $${i++}`);
        vals.push(until);
      }
      vals.push(limit);
      const where = conditions.length ? `WHERE ${conditions.join(" AND ")}` : "";
      const res = await this.pool.query(
        `SELECT * FROM gpu_snapshots ${where} ORDER BY ts DESC LIMIT $${i}`,
        vals
      );
      return res.rows ?? [];
    } catch (err) {
      console.warn("[db] getGpuHistory:", err.message);
      return [];
    }
  }
}
