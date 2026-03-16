export function registerLearningRoutes(app, deps) {
  const { teamLearningInstance } = deps;

  app.get("/api/learning/recommendations/:teamId", async (req, res) => {
    if (!teamLearningInstance) return res.json({ avoidModels: [], preferModels: [], roleOverrides: {} });
    const recs = await teamLearningInstance.getModelRecommendations(req.params.teamId);
    res.json(recs);
  });

  app.get("/api/learning/lessons/:teamId", async (req, res) => {
    if (!teamLearningInstance) return res.json([]);
    const lessons = await teamLearningInstance.getRecentLessons(req.params.teamId, 30);
    res.json(lessons);
  });
}
