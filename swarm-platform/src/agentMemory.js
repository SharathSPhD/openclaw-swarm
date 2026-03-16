import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";

export class AgentMemory {
  constructor({ dataDir }) {
    this.dataDir = dataDir;
    this.memoryFile = path.join(dataDir, "agent_memory.json");
    this.maxMemories = 500;
    this._ensureFile();
  }

  _ensureFile() {
    if (!fs.existsSync(this.memoryFile)) {
      const initial = { memories: [] };
      fs.writeFileSync(this.memoryFile, JSON.stringify(initial, null, 2), "utf8");
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
      // Cap at maxMemories by dropping oldest
      const trimmed = memories.length > this.maxMemories
        ? memories.slice(memories.length - this.maxMemories)
        : memories;
      
      const data = { memories: trimmed };
      fs.writeFileSync(this.memoryFile, JSON.stringify(data, null, 2), "utf8");
    } catch (err) {
      console.warn("[agentMemory] Failed to write memories:", err?.message);
    }
  }

  async recordMemory(teamId, round, lessons, outcome, { models = {}, score = 0, category = "general" } = {}) {
    if (!teamId || !round || !lessons || !outcome) {
      console.warn("[agentMemory] Missing required fields for recordMemory");
      return;
    }

    // Normalize lessons to array of strings
    const lessonsArray = Array.isArray(lessons) ? lessons : [String(lessons)];

    const memory = {
      id: crypto.randomUUID(),
      teamId,
      round,
      category,
      lessons: lessonsArray,
      models,
      outcome, // "success" or "failure"
      score: Number(score) || 0,
      ts: Date.now()
    };

    const all = this._readMemories();
    all.push(memory);
    this._writeMemories(all);

    console.log(`[agentMemory] Recorded memory for ${teamId} (${round}): ${lessonsArray.length} lessons, outcome=${outcome}, score=${score}`);
  }

  getMemoryContext(teamId, category = "general") {
    const all = this._readMemories();
    
    // Filter by teamId and category, then get the 5 most recent
    const relevant = all
      .filter(m => m.teamId === teamId && m.category === category)
      .slice(-5);

    if (relevant.length === 0) {
      return "";
    }

    // Format as a prompt context string
    const lines = ["PAST LESSONS FOR THIS TEAM:"];
    for (const mem of relevant) {
      for (const lesson of mem.lessons) {
        lines.push(`- ${lesson}`);
      }
    }

    return lines.join("\n");
  }

  getAll() {
    return this._readMemories();
  }

  getStats() {
    const all = this._readMemories();
    
    const teamBreakdown = {};
    const categoryBreakdown = {};
    const recentOutcomes = [];

    for (const mem of all) {
      teamBreakdown[mem.teamId] = (teamBreakdown[mem.teamId] || 0) + 1;
      categoryBreakdown[mem.category] = (categoryBreakdown[mem.category] || 0) + 1;
    }

    // Get last 10 outcomes with team and result
    const recentTen = all.slice(-10);
    for (const mem of recentTen) {
      recentOutcomes.push({
        teamId: mem.teamId,
        outcome: mem.outcome,
        score: mem.score,
        ts: mem.ts
      });
    }

    return {
      totalMemories: all.length,
      teamBreakdown,
      categoryBreakdown,
      recentOutcomes
    };
  }
}
