export function registerOpsRoutes(app, deps) {
  const { getSystemState, queue, cfg, store, computeInventoryStatus, db, pausedTeams } = deps;

  app.get("/api/system", (_req, res) => {
    const state = getSystemState();
    const activeAgents = store.getActiveAgents().active.length;
    res.json({
      system: state.currentSystem,
      loadState: state.loadState,
      queueDepth: queue.depth,
      activeAgents,
      maxActiveAgents: cfg.maxActiveAgents,
      runnerMode: cfg.runnerMode,
      adminKeyRequired: Boolean(process.env.ADMIN_API_KEY),
      pausedTeams: [...pausedTeams]
    });
  });

  app.get("/api/queue", (_req, res) => {
    res.json({ depth: queue.depth, items: queue.items.slice(0, 50) });
  });

  app.get("/api/ops", (_req, res) => {
    const state = getSystemState();
    const status = computeInventoryStatus({ models: state.modelInventory.models, routing: state.modelRouting });
    const activeAgents = store.getActiveAgents(50).active;
    res.json({
      system: state.currentSystem,
      loadState: state.loadState,
      queue: { depth: queue.depth, items: queue.items.slice(0, 30) },
      runnerMode: cfg.runnerMode,
      activeAgents,
      inventoryStatus: status,
      modelLatency: state.modelLatency,
      modelCapabilities: state.modelCapabilities,
      openclaw: {
        gatewayUrl: cfg.openclawGatewayUrl,
        canvasUrl: `${cfg.openclawGatewayUrl}${cfg.openclawCanvasPath}`
      }
    });
  });

  app.get("/api/gpu-history", async (req, res) => {
    const since = req.query.since || undefined;
    const until = req.query.until || undefined;
    const limit = Math.min(500, Math.max(1, Number(req.query.limit || 200)));
    const rows = await db.getGpuHistory({ since, until, limit });
    res.json({ snapshots: rows || [] });
  });
}
