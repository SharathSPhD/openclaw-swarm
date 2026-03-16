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
}
