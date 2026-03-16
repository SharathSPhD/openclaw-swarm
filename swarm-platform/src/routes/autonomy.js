import { requireAdmin } from "../auth.js";

export function registerAutonomyRoutes(app, deps) {
  app.get("/api/dashboard/autonomy-status", (_req, res) => {
    const { autonomousLoop } = deps;
    const status = {
      running: autonomousLoop?.running || false,
      currentObjective: autonomousLoop?.competitiveCoordinator?.currentObjective || null,
      currentPhase: autonomousLoop?.competitiveCoordinator?.currentPhase || "idle",
      dynamicInterval: autonomousLoop?.currentInterval || 90000,
      baseInterval: autonomousLoop?.baseInterval || 90000,
      objectivesDispatched: autonomousLoop?.objectivesDispatched || 0
    };
    res.json(status);
  });

  // GET /api/autonomy/objectives — recent completed objectives for ObjectivePipeline component
  app.get("/api/autonomy/objectives", async (_req, res) => {
    try {
      const rows = deps.db ? await deps.db.listSwarmSessions({ status: "completed", limit: 20 }) : [];
      const completed = (rows || []).map(r => ({
        objectiveId: r.objective_id || r.id,
        objective: r.objective_text || "(no description)",
        status: r.status || "completed",
        createdAt: r.created_at,
        updatedAt: r.updated_at
      }));
      res.json({ completed });
    } catch (err) {
      res.json({ completed: [] });
    }
  });

  app.get("/api/dashboard/learning-pulse", async (_req, res) => {
    try {
      const { teamLearningInstance } = deps;
      const recentLessons = teamLearningInstance
        ? await teamLearningInstance.getGlobalLessons(null, 3)
        : [];

      // Group by category
      const byCategory = {};
      for (const l of recentLessons) {
        if (!byCategory[l.category]) byCategory[l.category] = [];
        byCategory[l.category].push(l);
      }

      res.json({
        recentLessons: recentLessons.slice(0, 20),
        byCategory,
        roundHistoryLength: teamLearningInstance?.roundHistory?.length || 0
      });
    } catch (err) {
      res.status(500).json({ error: err?.message || "unknown" });
    }
  });

  // GET /api/autonomy/agent-trace — returns recent agent handoff and message events (unified trace)
  app.get("/api/autonomy/agent-trace", (_req, res) => {
    try {
      const events = deps.store.getEvents(500);
      const traces = events
        .filter(e => e.type === "agent.handoff" || e.type === "agent.message")
        .slice(-50)
        .map(e => {
          if (e.type === "agent.message") {
            return {
              ts: e.ts,
              teamId: e.teamId,
              eventType: "message",
              fromRole: e.payload?.fromRole || "unknown",
              toRole: e.payload?.toRole || "pending",
              objectiveId: e.payload?.objectiveId || "",
              outputPreview: (e.payload?.message || "").slice(0, 200),
              status: e.payload?.direction === "from_agent" ? "completed" : "dispatched",
              subTaskId: e.payload?.subTaskId || "",
              durationMs: e.payload?.durationMs || null
            };
          }
          return {
            ts: e.ts,
            teamId: e.teamId,
            eventType: "handoff",
            fromRole: e.payload?.fromRole || "unknown",
            toRole: e.payload?.toRole || "pending",
            objectiveId: e.payload?.objectiveId || "",
            outputPreview: e.payload?.outputPreview || "",
            status: e.payload?.status || "unknown",
            subTaskId: e.payload?.subTaskId || "",
            durationMs: e.payload?.durationMs || null
          };
        });

      res.json({ traces });
    } catch (err) {
      res.status(500).json({ error: err?.message || "unknown" });
    }
  });

  // GET /api/autonomy/agent-messages — returns recent agent.message events (full content)
  app.get("/api/autonomy/agent-messages", (req, res) => {
    try {
      const limit = Math.min(100, Math.max(1, Number(req.query?.limit || 50)));
      const teamFilter = req.query?.team || null;
      const roleFilter = req.query?.role || null;

      const events = deps.store.getEvents(1000);
      const messages = events
        .filter(e => e.type === "agent.message")
        .filter(e => !teamFilter || e.teamId === teamFilter)
        .filter(e => !roleFilter || e.payload?.fromRole === roleFilter || e.payload?.toRole === roleFilter)
        .slice(-limit)
        .map(e => ({
          ts: e.ts,
          teamId: e.teamId,
          direction: e.payload?.direction || "unknown",
          fromRole: e.payload?.fromRole || "?",
          toRole: e.payload?.toRole || "?",
          subTaskId: e.payload?.subTaskId || "",
          objectiveId: e.payload?.objectiveId || "",
          message: e.payload?.message || "",
          model: e.payload?.model || null,
          durationMs: e.payload?.durationMs || null,
          wave: e.payload?.wave || null
        }));

      res.json({ messages, total: messages.length });
    } catch (err) {
      res.status(500).json({ error: err?.message || "unknown" });
    }
  });

  // GET /api/autonomy/status — comprehensive autonomy health and metrics dashboard
  app.get("/api/autonomy/status", (_req, res) => {
    try {
      const { autonomousLoop, store, teamLearningInstance } = deps;
      const loop = autonomousLoop;

      // Quality gate stats from events
      const recentEvents = store ? store.getEvents(2000) : [];
      const qgPassed = recentEvents.filter(e => e.type === "competitive.merged").length;
      const qgFailed = recentEvents.filter(e => e.type === "competitive.quality-gate-failed").length;
      const qgReverted = recentEvents.filter(e => e.type === "competitive.quality-gate-failed" && e.payload?.reverted).length;

      // Model swap count from teamLearning round history
      let modelSwapCount = 0;
      const roundHistory = teamLearningInstance?.roundHistory || [];
      for (const round of roundHistory) {
        const hasCrossRoleLesson = (round.lessons || []).some(l => l.category === "model_swap" || l.category === "model_failure");
        if (hasCrossRoleLesson) modelSwapCount++;
      }

      // Self-healing stats
      const failureHistory = loop?.failureHistory || [];
      const failuresByType = {};
      for (const f of failureHistory) {
        failuresByType[f.type] = (failuresByType[f.type] || 0) + 1;
      }

      // Category progress
      const categoryHistory = loop?.categoryHistory || [];
      const categoryCounts = {};
      for (const c of categoryHistory) {
        categoryCounts[c.category] = (categoryCounts[c.category] || 0) + 1;
      }

      // Next scheduled objective
      const nextEta = loop?.nextRoundEta || null;
      const nextEtaMs = nextEta ? Math.max(0, nextEta - Date.now()) : null;

      // Current phase from competitiveCoordinator
      const currentPhase = loop?.competitiveCoordinator?.currentPhase || "idle";
      const currentObjective = loop?.competitiveCoordinator?.currentObjective || null;

      res.json({
        running: loop?.running || false,
        currentPhase,
        currentObjective,
        rounds: {
          dispatched: loop?.objectivesDispatched || 0,
          completed: loop?.roundsCompleted || 0,
          failed: loop?.roundsFailed || 0,
          consecutiveFailures: loop?.consecutiveFailures || 0
        },
        categories: {
          history: categoryHistory.slice(-10),
          counts: categoryCounts,
          totalCycled: categoryHistory.length
        },
        selfHealing: {
          totalFailures: failureHistory.length,
          recentFailureTypes: failuresByType,
          failureLog: failureHistory.slice(-5).map(f => ({
            ts: new Date(f.ts).toISOString(),
            type: f.type,
            objectiveId: f.objectiveId,
            msg: f.msg.slice(0, 100)
          }))
        },
        qualityGate: {
          passed: qgPassed,
          failed: qgFailed,
          reverted: qgReverted,
          passRate: (qgPassed + qgFailed) > 0 ? (qgPassed / (qgPassed + qgFailed)).toFixed(2) : "n/a"
        },
        modelAdaptation: {
          swapCount: modelSwapCount,
          roleOverrides: teamLearningInstance
            ? (teamLearningInstance.getModelRecommendations("team-alpha")?.roleOverrides || {})
            : {}
        },
        schedule: {
          intervalMs: loop?.currentInterval || 90000,
          nextRoundEtaMs: nextEtaMs,
          nextRoundEtaHuman: nextEtaMs != null ? `${Math.round(nextEtaMs / 1000)}s` : null
        },
        lastRoundTs: loop?.lastRoundTs ? new Date(loop.lastRoundTs).toISOString() : null
      });
    } catch (err) {
      res.status(500).json({ error: err?.message || "unknown" });
    }
  });

  // GET /api/autonomy/categories — list available objective categories
  app.get("/api/autonomy/categories", (_req, res) => {
    const CATEGORY_ORDER = [
      "test_coverage", "security_audit", "error_handling", "api_design",
      "performance_profiling", "documentation", "code_deduplication",
      "dependency_audit", "edge_cases", "observability"
    ];
    res.json({
      categories: CATEGORY_ORDER,
      totalCategories: CATEGORY_ORDER.length,
      currentCategoryIndex: deps.autonomousLoop?.categoryIndex || 0,
      templatesPerCategory: 10
    });
  });

  // POST /api/autonomy/force-objective — manually trigger objective generation for a specific category
  app.post("/api/autonomy/force-objective", requireAdmin, async (req, res) => {
    try {
      const { category, template } = req.body || {};
      
      const validCategories = [
        "test_coverage", "security_audit", "error_handling", "api_design",
        "performance_profiling", "documentation", "code_deduplication",
        "dependency_audit", "edge_cases", "observability"
      ];
      
      if (category && !validCategories.includes(category)) {
        return res.status(400).json({ 
          ok: false, 
          reason: "invalid_category",
          message: `Category must be one of: ${validCategories.join(", ")}`
        });
      }
      
      const loop = deps.autonomousLoop;
      if (!loop) {
        return res.status(503).json({ 
          ok: false, 
          reason: "autonomous_loop_not_running",
          message: "Autonomous loop not initialized"
        });
      }
      
      // Generate objective
      let objective;
      if (template && typeof template === "string") {
        objective = template;
      } else {
        objective = loop.generateObjectiveForCategory?.(category || "test_coverage");
      }
      
      if (!objective) {
        return res.status(500).json({ 
          ok: false, 
          reason: "objective_generation_failed",
          message: "Could not generate objective for category"
        });
      }
      
      // Dispatch it
      const result = await loop.dispatchObjective?.(objective, category || "test_coverage");
      
      if (result?.ok) {
        return res.json({ 
          ok: true, 
          objectiveId: result.objectiveId,
          objective, 
          category: category || "test_coverage", 
          dispatched: true,
          status: result.status
        });
      } else {
        return res.status(500).json({
          ok: false,
          reason: result?.reason || "dispatch_failed",
          message: result?.message || "Objective dispatch failed"
        });
      }
    } catch (err) {
      res.status(500).json({ 
        ok: false, 
        reason: "internal_error",
        message: err?.message || "Unknown error"
      });
    }
  });
}
