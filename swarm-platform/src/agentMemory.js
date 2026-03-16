import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";

const STRATEGIC_THRESHOLD = 3;
const SHORT_TERM_WINDOW = 10;
const MAX_STRATEGIC_PER_TEAM = 20;

export class AgentMemory {
  constructor({ dataDir }) {
    this.dataDir = dataDir;
    this.memoryFile = path.join(dataDir, "agent_memory.json");
    this.strategicFile = path.join(dataDir, "strategic_memory.json");
    this.maxMemories = 500;
    this._ensureFile();
    this._ensureStrategicFile();
  }

  _ensureFile() {
    if (!fs.existsSync(this.memoryFile)) {
      fs.writeFileSync(this.memoryFile, JSON.stringify({ memories: [] }, null, 2), "utf8");
    }
  }

  _ensureStrategicFile() {
    if (!fs.existsSync(this.strategicFile)) {
      fs.writeFileSync(this.strategicFile, JSON.stringify({ strategic: {} }, null, 2), "utf8");
    }
  }

  _readMemories() {
    this._ensureFile();
    try {
      const content = fs.readFileSync(this.memoryFile, "utf8");
      const data = JSON.parse(content);
      return data.memories || [];
    } catch (err) {
      console.warn("[agentMemory] Failed to read memories:", err?.message);
      return [];
    }
  }

  _writeMemories(memories) {
    try {
      const trimmed = memories.length > this.maxMemories
        ? memories.slice(memories.length - this.maxMemories)
        : memories;
      fs.writeFileSync(this.memoryFile, JSON.stringify({ memories: trimmed }, null, 2), "utf8");
    } catch (err) {
      console.warn("[agentMemory] Failed to write memories:", err?.message);
    }
  }

  _readStrategic() {
    this._ensureStrategicFile();
    try {
      const content = fs.readFileSync(this.strategicFile, "utf8");
      return JSON.parse(content).strategic || {};
    } catch {
      return {};
    }
  }

  _writeStrategic(strategic) {
    try {
      fs.writeFileSync(this.strategicFile, JSON.stringify({ strategic }, null, 2), "utf8");
    } catch (err) {
      console.warn("[agentMemory] Failed to write strategic memory:", err?.message);
    }
  }

  async recordMemory(teamId, round, lessons, outcome, { models = {}, score = 0, category = "general" } = {}) {
    if (!teamId || !round || !lessons || !outcome) {
      console.warn("[agentMemory] Missing required fields for recordMemory");
      return;
    }

    const lessonsArray = Array.isArray(lessons) ? lessons : [String(lessons)];

    const memory = {
      id: crypto.randomUUID(),
      teamId,
      round,
      category,
      lessons: lessonsArray,
      models,
      outcome,
      score: Number(score) || 0,
      ts: Date.now()
    };

    const all = this._readMemories();
    all.push(memory);
    this._writeMemories(all);

    this._distillStrategicLessons(teamId);

    console.log(`[agentMemory] Recorded memory for ${teamId} (${round}): ${lessonsArray.length} lessons, outcome=${outcome}, score=${score}`);
  }

  /**
   * Short-term memory: last N rounds for this team in this category.
   * Each team gets its OWN context.
   */
  getMemoryContext(teamId, category = "general") {
    const all = this._readMemories();

    const relevant = all
      .filter(m => m.teamId === teamId && m.category === category)
      .slice(-SHORT_TERM_WINDOW);

    if (relevant.length === 0) return "";

    const lines = [`SHORT-TERM MEMORY (${teamId}, last ${relevant.length} rounds):`];
    for (const mem of relevant) {
      const outcomeTag = mem.outcome === "success" ? "[WIN]" : "[LOSS]";
      lines.push(`${outcomeTag} score=${mem.score}`);
      for (const lesson of mem.lessons.slice(0, 5)) {
        lines.push(`  - ${lesson}`);
      }
    }

    return lines.join("\n");
  }

  /**
   * Long-term strategic memory: distilled patterns that recur across rounds.
   */
  getStrategicContext(teamId) {
    const strategic = this._readStrategic();
    const teamStrategies = strategic[teamId];
    if (!teamStrategies || teamStrategies.length === 0) return "";

    const lines = [`STRATEGIC MEMORY (${teamId}, proven patterns):`];
    for (const s of teamStrategies.slice(-MAX_STRATEGIC_PER_TEAM)) {
      lines.push(`- [${s.occurrences}x ${s.outcome}] ${s.pattern}`);
    }

    return lines.join("\n");
  }

  /**
   * Scan recent short-term memories and promote recurring patterns to strategic memory.
   * A pattern is promoted when the same lesson keyword appears in 3+ rounds.
   */
  _distillStrategicLessons(teamId) {
    const all = this._readMemories();
    const teamMems = all.filter(m => m.teamId === teamId).slice(-30);
    if (teamMems.length < STRATEGIC_THRESHOLD) return;

    const patternCounts = {};
    for (const mem of teamMems) {
      for (const lesson of mem.lessons) {
        const key = this._normalizeLesson(lesson);
        if (!key) continue;
        if (!patternCounts[key]) {
          patternCounts[key] = { pattern: lesson, count: 0, successCount: 0, failCount: 0 };
        }
        patternCounts[key].count++;
        if (mem.outcome === "success") patternCounts[key].successCount++;
        else patternCounts[key].failCount++;
      }
    }

    const strategic = this._readStrategic();
    const existing = strategic[teamId] || [];
    const existingKeys = new Set(existing.map(s => this._normalizeLesson(s.pattern)));

    let added = 0;
    for (const [key, info] of Object.entries(patternCounts)) {
      if (info.count >= STRATEGIC_THRESHOLD && !existingKeys.has(key)) {
        const dominantOutcome = info.successCount >= info.failCount ? "success" : "failure";
        existing.push({
          pattern: info.pattern,
          occurrences: info.count,
          outcome: dominantOutcome,
          ts: Date.now()
        });
        added++;
      }
    }

    if (added > 0) {
      strategic[teamId] = existing.slice(-MAX_STRATEGIC_PER_TEAM);
      this._writeStrategic(strategic);
      console.log(`[agentMemory] Distilled ${added} strategic lessons for ${teamId} (total: ${strategic[teamId].length})`);
    }
  }

  _normalizeLesson(lesson) {
    if (!lesson || typeof lesson !== "string") return "";
    return lesson
      .toLowerCase()
      .replace(/model\s+\S+/g, "model_X")
      .replace(/\d+/g, "N")
      .replace(/[^a-z_\s]/g, "")
      .trim()
      .slice(0, 80);
  }

  getAll() {
    return this._readMemories();
  }

  getStats() {
    const all = this._readMemories();
    const strategic = this._readStrategic();

    const teamBreakdown = {};
    const categoryBreakdown = {};
    const recentOutcomes = [];

    for (const mem of all) {
      teamBreakdown[mem.teamId] = (teamBreakdown[mem.teamId] || 0) + 1;
      categoryBreakdown[mem.category] = (categoryBreakdown[mem.category] || 0) + 1;
    }

    const recentTen = all.slice(-10);
    for (const mem of recentTen) {
      recentOutcomes.push({
        teamId: mem.teamId,
        outcome: mem.outcome,
        score: mem.score,
        ts: mem.ts
      });
    }

    const strategicCounts = {};
    for (const [teamId, entries] of Object.entries(strategic)) {
      strategicCounts[teamId] = entries.length;
    }

    return {
      totalMemories: all.length,
      teamBreakdown,
      categoryBreakdown,
      recentOutcomes,
      strategicMemory: strategicCounts
    };
  }
}
