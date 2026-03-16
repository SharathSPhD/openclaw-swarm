export function registerAutonomyRoutes(app, deps) {
  const { autonomousLoop, teamLearningInstance, objectivePerformanceTrackerInstance, competitiveCoord } = deps;

  app.get("/api/dashboard/autonomy-status", (_req, res) => {
    const status = {
      running: autonomousLoop?.running || false,
      currentObjective: autonomousLoop?.competitiveCoordinator?.currentObjective || null,
      currentPhase: autonomousLoop?.competitiveCoordinator?.currentPhase || "idle",
      dynamicInterval: autonomousLoop?.currentInterval || 90000,
      baseInterval: autonomousLoop?.baseInterval || 90000,
      objectivesDispatched: autonomousLoop?.objectivesDispatched || 0
    };
    res.json(status);
  });

  app.get("/api/dashboard/learning-pulse", async (_req, res) => {
    try {
      const recentLessons = teamLearningInstance
        ? await teamLearningInstance.getGlobalLessons(null, 3)
        : [];

      // Group by category
      const byCategory = {};
      for (const l of recentLessons) {
        if (!byCategory[l.category]) byCategory[l.category] = [];
        byCategory[l.category].push(l);
      }

      res.json({
        recentLessons: recentLessons.slice(0, 20),
        byCategory,
        roundHistoryLength: teamLearningInstance?.roundHistory?.length || 0
      });
    } catch (err) {
      res.status(500).json({ error: err?.message || "unknown" });
    }
  });
}
