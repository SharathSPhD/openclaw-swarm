export function registerCompetitiveRoutes(app, deps) {
  const { requireAdmin, worktreeManager, competitiveCoord } = deps;

  app.get("/api/worktrees", (_req, res) => {
    const trees = worktreeManager ? worktreeManager.listWorktrees() : [];
    res.json({ worktrees: trees });
  });

  app.get("/api/competitive/status", (_req, res) => {
    const status = competitiveCoord ? competitiveCoord.getStatus() : { phase: "not_initialized" };
    res.json(status);
  });

  app.post("/api/competitive-run", requireAdmin, async (req, res) => {
    const objective = String(req.body?.objective || "").trim();
    if (!objective) return res.status(400).json({ ok: false, error: "objective required" });
    if (!competitiveCoord) return res.status(503).json({ ok: false, error: "competitive coordinator not initialized" });

    const objectiveId = `comp-${Date.now()}`;
    competitiveCoord
      .executeCompetitiveObjective({ objective, objectiveId })
      .catch((err) => console.error("[competitive-run] Error:", err?.message));

    return res.json({ ok: true, objectiveId });
  });
}
