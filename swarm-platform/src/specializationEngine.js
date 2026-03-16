/**
 * Specialization Engine
 *
 * Tracks ROI per objective category and recommends specialization.
 * Over time, identifies which domains the platform excels at and biases
 * future objective generation toward those domains.
 */

import fs from "node:fs";
import path from "node:path";

const DOMAIN_CATEGORIES = [
  "content_generation",
  "data_science",
  "marketing",
  "engineering",
  "security_audit",
  "api_design",
  "code_quality",
  "resilience",
  "monitoring",
  "user_experience",
  "scalability",
  "performance_optimization"
];

export class SpecializationEngine {
  constructor({ dataDir, teamLearning, objectivePerformanceTracker }) {
    this.dataDir = dataDir;
    this.teamLearning = teamLearning;
    this.objectivePerformanceTracker = objectivePerformanceTracker;
    this.specPath = path.join(dataDir, "specialization.json");

    // In-memory state
    this.domainStats = new Map();
    this.recommendation = null;
    this.confidence = 0;
    this.specializedSince = null;
    this.totalRounds = 0;
  }

  async init() {
    try {
      if (fs.existsSync(this.specPath)) {
        const data = JSON.parse(fs.readFileSync(this.specPath, "utf8"));
        this.domainStats = new Map(Object.entries(data.domainStats || {}));
        this.recommendation = data.recommendation || null;
        this.confidence = data.confidence || 0;
        this.specializedSince = data.specializedSince || null;
        this.totalRounds = data.totalRounds || 0;
        console.log(`[specializationEngine] Loaded state: totalRounds=${this.totalRounds}, recommendation=${this.recommendation}, confidence=${this.confidence.toFixed(2)}`);
      }
    } catch (err) {
      console.warn("[specializationEngine] init failed:", err?.message);
    }
  }

  recordRoundOutcome({ category, success, score, teamId }) {
    if (!category) return;

    const key = String(category);
    const existing = this.domainStats.get(key) || {
      attempts: 0,
      successes: 0,
      avgScore: 0,
      totalScore: 0,
      roi: 0
    };

    existing.attempts += 1;
    existing.successes += success ? 1 : 0;
    existing.totalScore += score || 0;
    existing.avgScore = existing.totalScore / existing.attempts;
    existing.roi = existing.successes / existing.attempts;

    this.domainStats.set(key, existing);
    this.totalRounds += 1;

    // Recompute recommendation
    this._computeRecommendation();
    this._save();

    const stats = this.domainStats.get(key);
    console.log(
      `[specializationEngine] Recorded: category=${category} success=${success} score=${score} roi=${stats.roi.toFixed(2)} avgScore=${stats.avgScore.toFixed(2)} totalRounds=${this.totalRounds}`
    );
  }

  _computeRecommendation() {
    // Need at least 20 rounds to form a recommendation
    if (this.totalRounds < 20) {
      this.recommendation = null;
      this.confidence = 0;
      return;
    }

    let topCategory = null;
    let topScore = 0;

    for (const [category, stats] of this.domainStats.entries()) {
      if (stats.attempts === 0) continue;

      // Composite score: (roi * avgScore) / 100
      // Prioritizes both success rate and score magnitude
      const compositeScore = (stats.roi * stats.avgScore) / 100;

      if (compositeScore > topScore) {
        topScore = compositeScore;
        topCategory = category;
      }
    }

    if (topCategory) {
      const stats = this.domainStats.get(topCategory);
      // Confidence: how much better is the top category vs average?
      // Higher roi + higher avg score = higher confidence
      const avgRoi = Array.from(this.domainStats.values()).reduce((sum, s) => sum + s.roi, 0) / Math.max(1, this.domainStats.size);
      this.confidence = Math.min(1.0, stats.roi - avgRoi + 0.3); // Base 0.3 confidence + delta from average

      if (this.confidence > 0.6) {
        this.recommendation = topCategory;
        if (!this.specializedSince) {
          this.specializedSince = new Date().toISOString();
          console.log(`[specializationEngine] NEW SPECIALIZATION: ${this.recommendation} (confidence ${this.confidence.toFixed(2)})`);
        }
      } else {
        this.recommendation = null;
        this.specializedSince = null;
      }
    }
  }

  getAnalysis() {
    const domainStats = {};
    for (const [category, stats] of this.domainStats.entries()) {
      domainStats[category] = {
        attempts: stats.attempts,
        successes: stats.successes,
        avgScore: Math.round(stats.avgScore * 100) / 100,
        totalScore: stats.totalScore,
        roi: Math.round(stats.roi * 100) / 100
      };
    }

    return {
      domainStats,
      recommendation: this.recommendation,
      confidence: Math.round(this.confidence * 100) / 100,
      totalRounds: this.totalRounds,
      isSpecialized: this.recommendation !== null && this.confidence > 0.6,
      specializedSince: this.specializedSince
    };
  }

  getBiasedCategory(categories) {
    if (!Array.isArray(categories) || categories.length === 0) {
      return DOMAIN_CATEGORIES[Math.floor(Math.random() * DOMAIN_CATEGORIES.length)];
    }

    // If specialized and recommendation is in the available categories
    if (
      this.totalRounds >= 20 &&
      this.recommendation &&
      this.confidence > 0.6 &&
      categories.includes(this.recommendation)
    ) {
      // Return recommendation 60% of the time, random otherwise
      if (Math.random() < 0.6) {
        return this.recommendation;
      }
    }

    // Random selection from available categories
    return categories[Math.floor(Math.random() * categories.length)];
  }

  _save() {
    try {
      const data = {
        domainStats: Object.fromEntries(this.domainStats),
        recommendation: this.recommendation,
        confidence: this.confidence,
        specializedSince: this.specializedSince,
        totalRounds: this.totalRounds
      };
      fs.writeFileSync(this.specPath, JSON.stringify(data, null, 2), "utf8");
    } catch (err) {
      console.warn("[specializationEngine] _save failed:", err?.message);
    }
  }
}
