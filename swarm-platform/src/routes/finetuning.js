import fs from "node:fs";
import path from "node:path";

export function registerFineTuningRoutes(app, deps) {
  // GET /api/fine-tuning/stats
  app.get("/api/fine-tuning/stats", (req, res) => {
    if (!deps.fineTuningPrep) {
      return res.json({
        stats: null,
        message: "fine-tuning not initialized"
      });
    }

    const stats = deps.fineTuningPrep.getStats();
    res.json({ stats });
  });

  // GET /api/fine-tuning/sample?n=5
  app.get("/api/fine-tuning/sample", (req, res) => {
    if (!deps.fineTuningPrep) {
      return res.json({
        samples: [],
        count: 0,
        message: "fine-tuning not initialized"
      });
    }

    const n = Math.min(Math.max(parseInt(req.query.n) || 5, 1), 100);
    const samples = deps.fineTuningPrep.getSample(n);
    res.json({
      samples,
      count: samples.length,
      requested: n
    });
  });

  // GET /api/fine-tuning/download
  app.get("/api/fine-tuning/download", (req, res) => {
    if (!deps.fineTuningPrep) {
      return res.status(404).json({
        error: "fine-tuning not initialized"
      });
    }

    const roundsFile = path.join(deps.fineTuningPrep.trainingDir, "rounds.jsonl");

    if (!fs.existsSync(roundsFile)) {
      return res.status(404).json({
        error: "training data not found"
      });
    }

    res.download(roundsFile, "rounds.jsonl", (err) => {
      if (err) {
        console.error("[finetuning-routes] Download error:", err?.message);
      }
    });
  });
}
