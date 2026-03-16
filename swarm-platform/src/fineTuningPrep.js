import fs from "node:fs";
import path from "node:path";
import { randomUUID } from "node:crypto";

export class FineTuningPrep {
  constructor({ dataDir }) {
    this.dataDir = dataDir;
    this.trainingDir = path.join(dataDir, "training-data");
    this.roundsFile = path.join(this.trainingDir, "rounds.jsonl");
    this.statsFile = path.join(this.trainingDir, "stats.json");
    this.stats = {
      totalExamples: 0,
      highQuality: 0,
      mediumQuality: 0,
      lowQuality: 0,
      byCategory: {},
      winners: {},
      lastRecordedAt: null
    };
  }

  async init() {
    try {
      if (!fs.existsSync(this.trainingDir)) {
        fs.mkdirSync(this.trainingDir, { recursive: true });
      }

      if (fs.existsSync(this.statsFile)) {
        const content = fs.readFileSync(this.statsFile, "utf8");
        this.stats = JSON.parse(content);
      } else {
        await this._saveStats();
      }

      console.log("[fineTuning] Initialized. Stats:", this.stats);
    } catch (err) {
      console.error("[fineTuning] Init failed:", err?.message);
      throw err;
    }
  }

  async recordRound({
    objective,
    alphaOutput,
    betaOutput,
    alphaScore,
    betaScore,
    winner,
    category,
    roundId
  }) {
    try {
      const now = Date.now();
      const timestamp = Math.floor(now / 1000);

      // Create entry for alpha
      const alphaEntry = {
        id: `ex-${randomUUID()}`,
        prompt: objective || "",
        completion: alphaOutput || "",
        score: alphaScore || 0,
        was_winner: winner === "team-alpha",
        team: "team-alpha",
        category: category || "unknown",
        round: roundId || "",
        ts: timestamp,
        quality: this._getQualityTier(alphaScore)
      };

      // Create entry for beta
      const betaEntry = {
        id: `ex-${randomUUID()}`,
        prompt: objective || "",
        completion: betaOutput || "",
        score: betaScore || 0,
        was_winner: winner === "team-beta",
        team: "team-beta",
        category: category || "unknown",
        round: roundId || "",
        ts: timestamp,
        quality: this._getQualityTier(betaScore)
      };

      // Append both entries to rounds.jsonl
      const line1 = JSON.stringify(alphaEntry);
      const line2 = JSON.stringify(betaEntry);

      fs.appendFileSync(this.roundsFile, line1 + "\n");
      fs.appendFileSync(this.roundsFile, line2 + "\n");

      // Update stats for alpha
      this._updateStats(alphaEntry);
      // Update stats for beta
      this._updateStats(betaEntry);

      console.log(`[fineTuning] Recorded round ${roundId}: α(${alphaScore}) vs β(${betaScore}), winner=${winner}`);
    } catch (err) {
      console.error("[fineTuning] recordRound failed:", err?.message);
      throw err;
    }
  }

  _getQualityTier(score) {
    score = score || 0;
    if (score >= 80) return "high";
    if (score >= 60) return "medium";
    return "low";
  }

  _updateStats(entry) {
    this.stats.totalExamples++;

    // Update quality counts
    if (entry.quality === "high") {
      this.stats.highQuality++;
    } else if (entry.quality === "medium") {
      this.stats.mediumQuality++;
    } else {
      this.stats.lowQuality++;
    }

    // Update by category
    if (!this.stats.byCategory[entry.category]) {
      this.stats.byCategory[entry.category] = 0;
    }
    this.stats.byCategory[entry.category]++;

    // Update winners
    if (entry.was_winner) {
      if (!this.stats.winners[entry.team]) {
        this.stats.winners[entry.team] = 0;
      }
      this.stats.winners[entry.team]++;
    }

    this.stats.lastRecordedAt = new Date().toISOString();

    this._saveStats();
  }

  _saveStats() {
    try {
      fs.writeFileSync(this.statsFile, JSON.stringify(this.stats, null, 2));
    } catch (err) {
      console.error("[fineTuning] Failed to save stats:", err?.message);
    }
  }

  getStats() {
    return JSON.parse(JSON.stringify(this.stats));
  }

  getSample(n = 5) {
    try {
      if (!fs.existsSync(this.roundsFile)) {
        return [];
      }

      const content = fs.readFileSync(this.roundsFile, "utf8");
      const lines = content.split("\n").filter((l) => l.trim());

      // Get last n lines
      const sampleLines = lines.slice(Math.max(0, lines.length - n));
      return sampleLines.map((line) => JSON.parse(line));
    } catch (err) {
      console.error("[fineTuning] getSample failed:", err?.message);
      return [];
    }
  }
}
