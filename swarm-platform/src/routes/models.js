export function registerModelRoutes(app, deps) {
  const { discoverLocalModels, loadModelRouting, readModelLatency, readModelCapabilities, computeInventoryStatus, policyEngine, db, globalState } = deps;

  app.get("/api/models", (_req, res) => {
    const modelInventory = discoverLocalModels();
    const modelRouting = loadModelRouting();
    const modelLatency = readModelLatency();
    const modelCapabilities = readModelCapabilities();
    // Update global state so /api/ops can access current values
    if (globalState) {
      globalState.modelInventory = modelInventory;
      globalState.modelRouting = modelRouting;
      globalState.modelLatency = modelLatency;
      globalState.modelCapabilities = modelCapabilities;
    }
    const status = computeInventoryStatus({ models: modelInventory.models, routing: modelRouting });
    res.json({
      inventory: modelInventory,
      policyRoles: policyEngine.policies?.roles || {},
      routing: modelRouting,
      latency: modelLatency,
      capabilities: modelCapabilities,
      inventoryStatus: status
    });
  });

  app.get("/api/model-metrics", async (req, res) => {
    const model = req.query.model || undefined;
    const role = req.query.role || undefined;
    const since = req.query.since || undefined;
    const until = req.query.until || undefined;
    const limit = Math.min(500, Math.max(1, Number(req.query.limit || 200)));
    const rows = await db.getModelMetrics({ model, role, since, until, limit });
    res.json({ metrics: rows || [] });
  });
}
