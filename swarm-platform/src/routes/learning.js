export function registerLearningRoutes(app, deps) {
  app.get("/api/learning/recommendations/:teamId", async (req, res) => {
    if (!deps.teamLearningInstance) return res.json({ avoidModels: [], preferModels: [], roleOverrides: {} });
    const recs = await deps.teamLearningInstance.getModelRecommendations(req.params.teamId);
    res.json(recs);
  });

  app.get("/api/learning/lessons/:teamId", async (req, res) => {
    if (!deps.teamLearningInstance) return res.json([]);
    const lessons = await deps.teamLearningInstance.getRecentLessons(req.params.teamId, 30);
    res.json(lessons);
  });

  app.get("/api/learning/team-stats", async (_req, res) => {
    try {
      const { teamLearningInstance } = deps;
      if (!teamLearningInstance) {
        return res.json({ teams: {}, rounds: 0, performanceRecords: 0, message: "learning not initialized" });
      }

      const records = teamLearningInstance.performanceRecords || [];
      const roundHistory = teamLearningInstance.roundHistory || [];

      // Aggregate per-team stats
      const teamStats = {};
      for (const r of records) {
        const t = r.teamId || "unknown";
        if (!teamStats[t]) {
          teamStats[t] = {
            totalTasks: 0, successCount: 0, failCount: 0,
            avgLatencyMs: 0, latencySum: 0, latencyCount: 0,
            avgCorrectness: 0, correctnessSum: 0, correctnessCount: 0,
            modelUsage: {}, roleUsage: {}, recentErrors: []
          };
        }
        const s = teamStats[t];
        s.totalTasks++;
        if (r.success) s.successCount++; else s.failCount++;
        if (r.latencyMs) { s.latencySum += r.latencyMs; s.latencyCount++; }
        if (r.correctness) { s.correctnessSum += r.correctness; s.correctnessCount++; }
        if (r.model) s.modelUsage[r.model] = (s.modelUsage[r.model] || 0) + 1;
        if (r.role) s.roleUsage[r.role] = (s.roleUsage[r.role] || 0) + 1;
        if (!r.success && r.errorType) s.recentErrors.push(r.errorType);
      }

      // Compute averages
      for (const t of Object.keys(teamStats)) {
        const s = teamStats[t];
        s.avgLatencyMs = s.latencyCount > 0 ? Math.round(s.latencySum / s.latencyCount) : 0;
        s.avgCorrectness = s.correctnessCount > 0 ? (s.correctnessSum / s.correctnessCount).toFixed(3) : 0;
        s.successRate = s.totalTasks > 0 ? (s.successCount / s.totalTasks).toFixed(3) : 0;
        s.recentErrors = s.recentErrors.slice(-5);
        delete s.latencySum; delete s.latencyCount;
        delete s.correctnessSum; delete s.correctnessCount;
      }

      // Per-team round win rates
      const winCounts = {};
      for (const round of roundHistory) {
        // roundHistory contains { roundId, lessons, ts } but we need to extract winner
        // The winner is embedded in lessons with category: "evaluation"
        const evalLesson = (round.lessons || []).find(l => l.category === "evaluation");
        if (evalLesson) {
          // Extract team name from lesson text (e.g., "team-alpha won this round")
          const match = evalLesson.lesson.match(/(team-\w+) won this round/);
          if (match) {
            const winner = match[1];
            winCounts[winner] = (winCounts[winner] || 0) + 1;
          }
        }
      }

      res.json({
        teams: teamStats,
        rounds: roundHistory.length,
        performanceRecords: records.length,
        winCounts,
        recentRounds: roundHistory.slice(-5).map(r => ({
          roundId: r.roundId,
          lessonsCount: (r.lessons || []).length,
          ts: r.ts || null
        }))
      });
    } catch (err) {
      res.status(500).json({ error: err?.message || "unknown" });
    }
  });

  app.get("/api/learning/model-performance", async (_req, res) => {
    try {
      const { teamLearningInstance } = deps;
      if (!teamLearningInstance) {
        return res.json({ models: {}, message: "learning not initialized" });
      }

      const records = teamLearningInstance.performanceRecords || [];

      // Aggregate per-model stats
      const modelStats = {};
      for (const r of records) {
        const key = `${r.model || "unknown"}:${r.role || "unknown"}`;
        if (!modelStats[key]) {
          modelStats[key] = {
            model: r.model || "unknown",
            role: r.role || "unknown",
            count: 0, successCount: 0,
            latencySum: 0, latencyCount: 0,
            correctnessSum: 0, correctnessCount: 0
          };
        }
        const s = modelStats[key];
        s.count++;
        if (r.success) s.successCount++;
        if (r.latencyMs) { s.latencySum += r.latencyMs; s.latencyCount++; }
        if (r.correctness) { s.correctnessSum += r.correctness; s.correctnessCount++; }
      }

      // Compute averages and format
      const result = Object.values(modelStats).map(s => ({
        model: s.model,
        role: s.role,
        count: s.count,
        successRate: s.count > 0 ? (s.successCount / s.count).toFixed(3) : "0",
        avgLatencyMs: s.latencyCount > 0 ? Math.round(s.latencySum / s.latencyCount) : 0,
        avgCorrectness: s.correctnessCount > 0 ? (s.correctnessSum / s.correctnessCount).toFixed(3) : "0"
      })).sort((a, b) => b.count - a.count);

      res.json({ models: result, total: result.length });
    } catch (err) {
      res.status(500).json({ error: err?.message || "unknown" });
    }
  });
}
