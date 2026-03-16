export function registerAgentRoutes(app, deps) {
  // GET /api/agents/memory?teamId=team-alpha (optional teamId filter)
  app.get("/api/agents/memory", (req, res) => {
    const { teamId } = req.query;
    
    if (!deps.agentMemory) {
      return res.json({ memories: [], message: "agent memory not initialized" });
    }

    const all = deps.agentMemory.getAll();
    
    // Filter by teamId if provided
    const filtered = teamId
      ? all.filter(m => m.teamId === teamId)
      : all;

    res.json({
      memories: filtered,
      count: filtered.length,
      totalCount: all.length
    });
  });

  // GET /api/agents/memory/stats
  app.get("/api/agents/memory/stats", (req, res) => {
    if (!deps.agentMemory) {
      return res.json({
        totalMemories: 0,
        teamBreakdown: {},
        categoryBreakdown: {},
        recentOutcomes: [],
        message: "agent memory not initialized"
      });
    }

    const stats = deps.agentMemory.getStats();
    res.json(stats);
  });
}
