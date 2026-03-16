export function registerExplorationRoutes(app, deps) {
  app.get("/api/exploration/skills", (_req, res) => {
    if (!deps.explorationEngineInstance) return res.json({ skills: [], tools: [] });
    res.json({
      skills: deps.explorationEngineInstance.discoverInstalledSkills(),
      tools: deps.explorationEngineInstance.discoverInstalledTools()
    });
  });
}
