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

  // GET /api/models/latency — chart-ready format for ModelLatencyChart component
  app.get("/api/models/latency", (_req, res) => {
    const modelLatency = readModelLatency();
    const routing = loadModelRouting();
    // Build array of { name, p50, p95, provider } for chart rendering
    const models = [];
    // From pre-computed latency file (scripts/benchmark_models.sh output)
    const latencyData = modelLatency?.models || modelLatency || {};
    for (const [id, data] of Object.entries(latencyData)) {
      if (typeof data === "object" && (data.avgMs || data.p50Ms)) {
        models.push({
          name: id,
          p50: data.p50Ms || data.avgMs || 0,
          p95: data.p95Ms || null,
          provider: routing?.modelCapabilities?.[id]?.provider || "ollama"
        });
      } else if (typeof data === "number") {
        models.push({ name: id, p50: data, p95: null, provider: "ollama" });
      }
    }
    // Sort by p50 latency ascending
    models.sort((a, b) => a.p50 - b.p50);
    res.json({ models });
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
