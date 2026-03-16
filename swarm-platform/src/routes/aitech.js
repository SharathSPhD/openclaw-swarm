/**
 * AI Tech Explorer Routes
 *
 * GET /api/ai-tech/catalog - Get all catalog entries (optionally filtered by category)
 * GET /api/ai-tech/stats - Get catalog statistics
 * GET /api/ai-tech/:id - Get a single entry by ID
 * POST /api/ai-tech - Upsert an entry (requires admin)
 * PUT /api/ai-tech/:id/status - Update exploration status (requires admin)
 */

export function registerAiTechRoutes(app, deps) {
  const { aiTechExplorer, requireAdmin } = deps;

  if (!aiTechExplorer) {
    console.warn("aiTechExplorer not initialized, skipping AI Tech routes");
    return;
  }

  // GET /api/ai-tech/catalog
  app.get("/api/ai-tech/catalog", (req, res) => {
    const { category } = req.query;
    try {
      const entries = aiTechExplorer.getCatalog({ category });
      res.json({
        entries,
        count: entries.length,
        category: category || null
      });
    } catch (err) {
      res.status(400).json({ error: err.message });
    }
  });

  // GET /api/ai-tech/stats
  app.get("/api/ai-tech/stats", (req, res) => {
    try {
      const stats = aiTechExplorer.getStats();
      res.json(stats);
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  // GET /api/ai-tech/:id
  app.get("/api/ai-tech/:id", (req, res) => {
    try {
      const entry = aiTechExplorer.getEntry(req.params.id);
      if (!entry) {
        return res.status(404).json({ error: "Entry not found" });
      }
      res.json(entry);
    } catch (err) {
      res.status(400).json({ error: err.message });
    }
  });

  // POST /api/ai-tech (requireAdmin)
  app.post("/api/ai-tech", requireAdmin, (req, res) => {
    try {
      const entry = req.body;
      if (!entry || typeof entry !== "object") {
        return res.status(400).json({ error: "Invalid request body" });
      }

      const upserted = aiTechExplorer.upsertEntry(entry);
      res.status(201).json(upserted);
    } catch (err) {
      res.status(400).json({ error: err.message });
    }
  });

  // PUT /api/ai-tech/:id/status (requireAdmin)
  app.put("/api/ai-tech/:id/status", requireAdmin, (req, res) => {
    try {
      const { status } = req.body;
      if (!status) {
        return res.status(400).json({ error: "status is required" });
      }

      const entry = aiTechExplorer.getEntry(req.params.id);
      if (!entry) {
        return res.status(404).json({ error: "Entry not found" });
      }

      const updated = aiTechExplorer.upsertEntry({
        ...entry,
        explorationStatus: status
      });

      res.json(updated);
    } catch (err) {
      res.status(400).json({ error: err.message });
    }
  });
}
