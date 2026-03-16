/**
 * Objective Performance Tracker
 *
 * Records the ROI of each completed objective by comparing leaderboard
 * scores before and after the round. Enables the autonomous loop to
 * prioritize categories that historically improve the platform most.
 */

export class ObjectivePerformanceTracker {
  constructor({ db }) {
    this.db = db;
    // In-memory cache for file-based mode (no DB)
    this.inMemoryRows = [];
  }

  async init() {
    if (!this.db?.pool) return;
    try {
      await this.db.pool.query(`
        CREATE TABLE IF NOT EXISTS objective_performance (
          id SERIAL PRIMARY KEY,
          objective_id TEXT NOT NULL,
          category TEXT NOT NULL,
          pre_score INT NOT NULL DEFAULT 0,
          post_score INT NOT NULL DEFAULT 0,
          delta_score INT NOT NULL DEFAULT 0,
          lessons_count INT NOT NULL DEFAULT 0,
          critical_lessons_count INT NOT NULL DEFAULT 0,
          roi REAL NOT NULL DEFAULT 0,
          created_at TIMESTAMPTZ DEFAULT NOW()
        )
      `);
    } catch (err) {
      console.warn("[objectivePerformance] Schema creation failed:", err?.message);
    }
  }

  async recordObjectiveImpact({ objectiveId, category, before, after, lessons }) {
    const preScore = before?.totalScore ?? 0;
    const postScore = after?.totalScore ?? 0;
    const deltaScore = postScore - preScore;
    const lessonsCount = Array.isArray(lessons) ? lessons.length : 0;
    const criticalCount = Array.isArray(lessons) ? lessons.filter(l => l.severity === "critical").length : 0;
    // ROI: normalize delta by (lessons+1) to penalize noisy rounds
    const roi = lessonsCount > 0 ? deltaScore / (lessonsCount + 1) : deltaScore;

    if (this.db?.pool) {
      try {
        await this.db.pool.query(
          `INSERT INTO objective_performance (objective_id, category, pre_score, post_score, delta_score, lessons_count, critical_lessons_count, roi)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
          [objectiveId, category, preScore, postScore, deltaScore, lessonsCount, criticalCount, roi]
        );
      } catch (err) {
        console.warn("[objectivePerformance] recordObjectiveImpact:", err?.message);
      }
    } else {
      // File-based mode: keep last 100 rows in memory
      this.inMemoryRows.push({ objectiveId, category, preScore, postScore, deltaScore, lessonsCount, criticalCount, roi, createdAt: new Date().toISOString() });
      if (this.inMemoryRows.length > 100) this.inMemoryRows.shift();
    }
  }

  async getObjectiveROI(category, windowDays = 7) {
    if (this.db?.pool) {
      try {
        const res = await this.db.pool.query(
          `SELECT AVG(roi) as avg_roi, COUNT(*) as count
           FROM objective_performance
           WHERE category = $1 AND created_at > NOW() - INTERVAL '${Math.floor(windowDays)} days'`,
          [category]
        );
        const row = res.rows[0];
        return { avgRoi: parseFloat(row?.avg_roi ?? 0) || 0, count: parseInt(row?.count ?? 0) || 0 };
      } catch (err) {
        console.warn("[objectivePerformance] getObjectiveROI:", err?.message);
        return { avgRoi: 0, count: 0 };
      }
    }
    // File-based mode
    const cutoff = new Date(Date.now() - windowDays * 24 * 60 * 60 * 1000).toISOString();
    const rows = this.inMemoryRows.filter(r => r.category === category && r.createdAt >= cutoff);
    if (rows.length === 0) return { avgRoi: 0, count: 0 };
    const avgRoi = rows.reduce((sum, r) => sum + r.roi, 0) / rows.length;
    return { avgRoi, count: rows.length };
  }

  async suggestNextCategory(stats) {
    const categories = ["performance", "quality", "coverage", "documentation", "system_health", "testing",
      "security_audit", "api_design", "code_quality", "resilience", "monitoring", "scalability"];

    const roiResults = await Promise.all(
      categories.map(async (cat) => {
        const { avgRoi, count } = await this.getObjectiveROI(cat);
        return { category: cat, avgRoi, count };
      })
    );

    // Sort: prefer high ROI with enough data; prefer unexplored categories
    roiResults.sort((a, b) => {
      if (a.count < 2 && b.count >= 2) return -1; // prefer unexplored
      if (b.count < 2 && a.count >= 2) return 1;
      return b.avgRoi - a.avgRoi;
    });

    return roiResults[0]?.category || "coverage";
  }
}
