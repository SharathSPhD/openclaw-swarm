export function registerExplorationRoutes(app, deps) {
  const { explorationEngineInstance } = deps;

  app.get("/api/exploration/skills", (_req, res) => {
    if (!explorationEngineInstance) return res.json({ skills: [], tools: [] });
    res.json({
      skills: explorationEngineInstance.discoverInstalledSkills(),
      tools: explorationEngineInstance.discoverInstalledTools()
    });
  });
}
