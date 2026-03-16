export function registerSpecializationRoutes(app, deps) {
  const { requireAdmin } = deps;

  // GET /api/specialization/analysis
  // Returns current specialization state, ROI stats, and recommendation
  app.get("/api/specialization/analysis", (_req, res) => {
    const specializationEngine = deps.specializationEngine;
    if (!specializationEngine) {
      return res.json({
        domainStats: {},
        recommendation: null,
        confidence: 0,
        totalRounds: 0,
        isSpecialized: false,
        specializedSince: null
      });
    }
    res.json(specializationEngine.getAnalysis());
  });

  // GET /api/specialization/bias-test
  // Testing endpoint: returns getBiasedCategory result for all domain categories
  // Useful for debugging and testing the specialization bias logic
  app.get("/api/specialization/bias-test", (_req, res) => {
    const specializationEngine = deps.specializationEngine;
    if (!specializationEngine) {
      return res.json({ error: "specialization engine not initialized", result: null });
    }

    const DOMAIN_CATEGORIES = [
      "content_generation",
      "data_science",
      "marketing",
      "engineering",
      "security_audit",
      "api_design",
      "code_quality",
      "resilience",
      "monitoring",
      "user_experience",
      "scalability",
      "performance_optimization"
    ];

    const result = specializationEngine.getBiasedCategory(DOMAIN_CATEGORIES);
    res.json({ result, availableCategories: DOMAIN_CATEGORIES });
  });

  // POST /api/specialization/reset
  // Admin-only: reset all specialization stats
  app.post("/api/specialization/reset", requireAdmin, (_req, res) => {
    const specializationEngine = deps.specializationEngine;
    if (!specializationEngine) {
      return res.json({ error: "specialization engine not initialized" });
    }

    // Reset state
    specializationEngine.domainStats = new Map();
    specializationEngine.recommendation = null;
    specializationEngine.confidence = 0;
    specializationEngine.specializedSince = null;
    specializationEngine.totalRounds = 0;
    specializationEngine._save();

    res.json({ ok: true, message: "Specialization stats reset", state: specializationEngine.getAnalysis() });
  });
}
