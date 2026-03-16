export function registerCompetitiveRoutes(app, deps) {
  const { requireAdmin } = deps;

  app.get("/api/worktrees", (_req, res) => {
    const trees = deps.worktreeManager ? deps.worktreeManager.listWorktrees() : [];
    res.json({ worktrees: trees });
  });

  app.get("/api/competitive/status", (_req, res) => {
    const status = deps.competitiveCoord ? deps.competitiveCoord.getStatus() : { phase: "not_initialized" };
    res.json(status);
  });

  app.post("/api/competitive-run", requireAdmin, async (req, res) => {
    const objective = String(req.body?.objective || "").trim();
    if (!objective) return res.status(400).json({ ok: false, error: "objective required" });
    if (!deps.competitiveCoord) return res.status(503).json({ ok: false, error: "competitive coordinator not initialized" });

    const objectiveId = `comp-${Date.now()}`;
    deps.competitiveCoord
      .executeCompetitiveObjective({ objective, objectiveId })
      .catch((err) => console.error("[competitive-run] Error:", err?.message));

    return res.json({ ok: true, objectiveId });
  });

  // GET /api/competitive/rounds — returns recent competitive round summaries
  app.get("/api/competitive/rounds", (_req, res) => {
    const events = deps.store.getEvents(2000);
    const rounds = [];

    // Group events by objectiveId to build round summaries
    const roundMap = new Map();

    for (const e of events) {
      const objId = e.payload?.objectiveId;
      if (!objId) continue;

      if (e.type === "competitive.started") {
        roundMap.set(objId, {
          objectiveId: objId,
          objective: e.payload?.objective || "",
          startedAt: e.ts,
          status: "running",
          winner: null,
          alphaScore: null,
          betaScore: null,
          category: null,
          durationMs: null
        });
      } else if (e.type === "competitive.evaluated" && roundMap.has(objId)) {
        const r = roundMap.get(objId);
        r.winner = e.payload?.winner || null;
        r.alphaScore = e.payload?.alphaScore ?? null;
        r.betaScore = e.payload?.betaScore ?? null;
        r.reasoning = e.payload?.reasoning || "";
      } else if (e.type === "competitive.merged" && roundMap.has(objId)) {
        const r = roundMap.get(objId);
        r.status = "completed";
        r.changedFiles = e.payload?.changedFiles?.length || 0;
        r.durationMs = e.ts ? (new Date(e.ts) - new Date(r.startedAt)) : null;
      }
    }

    // Add category from objective.created events
    for (const e of events) {
      if (e.type === "objective.created" && e.payload?.objectiveId) {
        const r = roundMap.get(e.payload.objectiveId);
        if (r) r.category = e.payload?.category || null;
      }
    }

    const roundList = [...roundMap.values()]
      .sort((a, b) => new Date(b.startedAt) - new Date(a.startedAt))
      .slice(0, 20);

    res.json({ rounds: roundList });
  });

  // GET /api/competitive/gamma-insights — returns recent gamma discoveries
  app.get("/api/competitive/gamma-insights", (_req, res) => {
    const insights = deps.competitiveCoord ? deps.competitiveCoord.getGammaInsights() : [];
    // Also get full history if available
    const fullHistory = deps.competitiveCoord?.gammaDiscoveries || [];
    res.json({
      insights: fullHistory.slice(-10).map(d => ({
        ts: d.ts,
        discoveries: d.discoveries || "",
        recommendations: d.recommendations || ""
      }))
    });
  });

  // GET /api/competitive/implementation-log — returns per-round implementation results
  app.get("/api/competitive/implementation-log", (_req, res) => {
    try {
      const events = deps.store.getEvents(2000);
      
      // Build log by grouping competitive.merged events with their context
      const mergeEvents = events.filter(e => e.type === "competitive.merged");
      const startEvents = events.filter(e => e.type === "competitive.started");
      const evalEvents = events.filter(e => e.type === "competitive.evaluated");
      const restartEvents = events.filter(e => e.type === "competitive.restarting");
      
      const log = mergeEvents.map(mergeEvt => {
        const objId = mergeEvt.payload?.objectiveId;
        const startEvt = startEvents.findLast(e => e.payload?.objectiveId === objId);
        const evalEvt = evalEvents.findLast(e => e.payload?.objectiveId === objId);
        const restartEvt = restartEvents.findLast(e => e.payload?.objectiveId === objId);
        
        return {
          objectiveId: objId,
          ts: mergeEvt.ts,
          objective: startEvt?.payload?.objective || "(unknown)",
          winner: evalEvt?.payload?.winner || "(unknown)",
          changedFiles: mergeEvt.payload?.changedFiles || [],
          fileCount: (mergeEvt.payload?.changedFiles || []).length,
          needsRestart: mergeEvt.payload?.needsRestart || false,
          restarted: !!restartEvt,
          alphaScore: evalEvt?.payload?.alphaScore ?? null,
          betaScore: evalEvt?.payload?.betaScore ?? null
        };
      }).reverse(); // Most recent first
      
      const stats = {
        totalImplementations: log.length,
        totalFilesChanged: log.reduce((sum, r) => sum + r.fileCount, 0),
        totalRestarts: log.filter(r => r.restarted).length,
        roundsWithChanges: log.filter(r => r.fileCount > 0).length
      };
      
      res.json({ log, stats });
    } catch (err) {
      res.status(500).json({ error: err?.message || "unknown" });
    }
  });

  app.get("/api/competitive/agent-messages", (req, res) => {
    const { teamId, limit = 100 } = req.query;
    const events = deps.store.getEvents(deps.store.maxEvents || 2000)
      .filter(e => e.type === "agent.message" && e.payload?.phase === "competitive")
      .filter(e => !teamId || e.teamId === teamId)
      .slice(-Number(limit));
    res.json({
      messages: events.map(e => ({
        id: e.id,
        ts: e.ts,
        teamId: e.teamId,
        role: e.payload?.role,
        content: e.payload?.content,
        taskId: e.payload?.taskId,
        objectiveId: e.payload?.objectiveId
      }))
    });
  });
}
