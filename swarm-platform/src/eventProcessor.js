export class EventProcessor {
  constructor(store, db) {
    this.store = store;
    this.db = db;
  }

  async process(event) {
    try {
      await this.db.insertEvent(event);
    } catch (err) {
      console.warn("[eventProcessor] insertEvent error:", err?.message);
    }

    const type = event?.type;
    const payload = event?.payload;
    if (!type || !payload) return;

    try {
      if (type === "task.completed") {
        await this.db.insertAgentOutput({
          taskId: payload.taskId,
          teamId: event.teamId,
          role: payload.role,
          model: payload.model || payload.modelName,
          outputText: payload.output,
          rawOutput: payload.rawOutput,
          toolCalls: payload.toolCalls,
          reasoningTrace: payload.reasoningTrace,
          metrics: {
            correctness: payload.correctness,
            speed: payload.speed,
            efficiency: payload.efficiency,
            durationMs: payload.durationMs
          }
        });
        await this.db.insertModelMetric({
          modelId: payload.model || payload.modelName,
          role: payload.role,
          latencyMs: payload.durationMs,
          success: true
        });
      }

      if (type === "task.failed") {
        await this.db.insertModelMetric({
          modelId: payload.model || payload.modelName,
          role: payload.role,
          latencyMs: payload.durationMs,
          success: false
        });
      }

      if (type === "swarm.session.created") {
        await this.db.insertSwarmSession({
          id: payload.objectiveId,
          objectiveId: payload.objectiveId,
          teamId: payload.teamId || event.teamId,
          objectiveText: payload.objective || "(no text)",
          status: "created"
        });
      }

      if (type === "swarm.session.decomposed") {
        await this.db.updateSwarmSession(payload.objectiveId, {
          status: "decomposed",
          subTasks: payload.subTasks
        });
      }

      if (type === "swarm.session.dispatching") {
        await this.db.updateSwarmSession(payload.objectiveId, { status: "dispatching" });
      }

      if (type === "swarm.session.executing") {
        await this.db.updateSwarmSession(payload.objectiveId, { status: "executing" });
      }

      if (type === "swarm.session.reviewing") {
        await this.db.updateSwarmSession(payload.objectiveId, { status: "reviewing" });
      }

      if (type === "swarm.session.aggregating") {
        await this.db.updateSwarmSession(payload.objectiveId, { status: "aggregating" });
      }

      if (type === "swarm.session.completed") {
        await this.db.updateSwarmSession(payload.objectiveId, {
          status: "completed",
          finalOutput: payload.finalOutput
        });
      }

      if (type === "swarm.session.failed") {
        await this.db.updateSwarmSession(payload.objectiveId, {
          status: "failed"
        });
      }
    } catch (err) {
      console.warn("[eventProcessor] specialized insert failed:", err?.message);
    }
  }
}
