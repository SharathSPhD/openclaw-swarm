const META_OBJECTIVE_CATEGORIES = [
  {
    category: "performance",
    generator: (stats) => {
      if (stats.avgLatency > 30000) {
        return "Analyze the latency of the last 10 completed tasks in our swarm platform. Identify the slowest model-role pair and recommend a faster alternative model from our available Ollama models. Provide specific latency data and expected improvement.";
      }
      return "Review the current task execution performance metrics. Report average completion times by role (research, build, critic, integrator). Identify any bottlenecks and suggest optimizations for our multi-agent orchestration pipeline.";
    }
  },
  {
    category: "quality",
    generator: (stats) => {
      if (stats.criticApprovalRate < 0.7) {
        return "The critic rejection rate is high. Analyze the most common reasons for rejection in our swarm tasks. Propose specific prompt improvements for the most-rejected specialist role to improve first-pass approval rates.";
      }
      return "Review the quality of completed objectives. Assess correctness scores, efficiency ratings, and output completeness. Identify patterns in high-quality vs low-quality outputs and recommend improvements.";
    }
  },
  {
    category: "coverage",
    generator: () => {
      return "Research what capabilities the swarm platform is currently missing compared to a full multi-agent AI system. Consider: error recovery strategies, inter-agent communication patterns, context sharing between sub-tasks, and progressive refinement. List the top 3 most impactful gaps with implementation suggestions.";
    }
  },
  {
    category: "documentation",
    generator: (stats) => {
      return `Generate a comprehensive status report of the swarm platform. Include: total completed objectives (${stats.completed}), team scores (Alpha: ${stats.alphaScore}, Beta: ${stats.betaScore}), average task latency, model utilization breakdown, and recommendations for the next 24 hours of autonomous operation.`;
    }
  },
  {
    category: "system_health",
    generator: () => {
      return "Analyze the system health of our swarm platform running on DGX Spark. Check GPU memory usage patterns, model loading/unloading frequency, and identify any models that consistently cause OOM errors. Report current resource utilization and recommend optimal model concurrency limits.";
    }
  },
  {
    category: "testing",
    generator: () => {
      return "Design a comprehensive test plan for the swarm platform's coordinator-specialist pattern. Include tests for: task decomposition quality, dependency graph correctness, critic review accuracy, aggregation completeness, and error recovery. Provide specific test scenarios with expected outcomes.";
    }
  }
];

export class AutonomousLoop {
  constructor({ coordinator, telegramBot, store, db, chatId, interval = 60000, emitEvent, createEvent }) {
    this.coordinator = coordinator;
    this.telegramBot = telegramBot;
    this.store = store;
    this.db = db;
    this.chatId = chatId;
    this.interval = interval;
    this.emitEvent = emitEvent;
    this.createEvent = createEvent;
    this.running = false;
    this.currentTeam = "team-alpha";
    this.categoryIndex = 0;
    this.objectivesDispatched = 0;
    this.maxConcurrentObjectives = 2;
  }

  async start() {
    this.running = true;
    console.log("[autonomousLoop] Started. Will dispatch one objective at a time, alternating teams.");

    if (this.telegramBot && this.chatId) {
      await this.telegramBot.sendMessage(this.chatId,
        "*Autonomous Mode Activated*\nThe program lead will now generate and dispatch self-improvement objectives, alternating between teams."
      ).catch(() => {});
    }

    while (this.running) {
      try {
        const board = this.store.getObjectiveBoard(200);
        const activeCount = board.filter((o) => o.status === "active").length;
        if (activeCount >= this.maxConcurrentObjectives) {
          console.log(`[autonomousLoop] ${activeCount} active objectives (max ${this.maxConcurrentObjectives}). Waiting...`);
          await new Promise((r) => setTimeout(r, this.interval));
          continue;
        }

        const stats = this._gatherStats();
        const objective = this._generateNextObjective(stats);
        const objectiveId = `auto-${Date.now()}`;

        console.log(`[autonomousLoop] Dispatching objective #${this.objectivesDispatched + 1} to ${this.currentTeam}: ${objective.slice(0, 100)}...`);

        if (this.telegramBot && this.chatId) {
          await this.telegramBot.sendMessage(this.chatId,
            `*Program Lead* dispatching to ${this.currentTeam}:\n_${objective.slice(0, 300)}_`
          ).catch(() => {});
        }

        await this.emitEvent(
          this.createEvent({
            type: "objective.created",
            teamId: this.currentTeam,
            source: "autonomous-loop",
            payload: { objectiveId, objective, actorRole: "program-lead", source: "autonomous" }
          })
        );

        const result = await this.coordinator.executeObjective({
          teamId: this.currentTeam,
          objective,
          objectiveId,
          maxIterations: 2
        });

        this.objectivesDispatched += 1;

        if (this.telegramBot && this.chatId) {
          const statusEmoji = result.status === "completed" ? "COMPLETED" : "FAILED";
          const output = (result.finalOutput || "").slice(0, 500);
          await this.telegramBot.sendMessage(this.chatId,
            `*${statusEmoji}* [${this.currentTeam}] Objective #${this.objectivesDispatched}\n\n${output || result.error || "No output"}`
          ).catch(() => {});
        }

        this.currentTeam = this.currentTeam === "team-alpha" ? "team-beta" : "team-alpha";
        this.categoryIndex = (this.categoryIndex + 1) % META_OBJECTIVE_CATEGORIES.length;

      } catch (err) {
        console.warn("[autonomousLoop] Error:", err?.message || err);
        if (this.telegramBot && this.chatId) {
          await this.telegramBot.sendMessage(this.chatId,
            `*Autonomous Loop Error*: ${err?.message || "unknown"}\nRetrying in ${this.interval / 1000}s...`
          ).catch(() => {});
        }
      }

      if (this.running) {
        await new Promise((r) => setTimeout(r, this.interval));
      }
    }
  }

  stop() {
    this.running = false;
    console.log("[autonomousLoop] Stopped.");
  }

  _gatherStats() {
    const leaderboard = this.store.getLeaderboard();
    const alpha = leaderboard.find((r) => r.teamName === "Team Alpha" || r.teamId === "team-alpha") || {};
    const beta = leaderboard.find((r) => r.teamName === "Team Beta" || r.teamId === "team-beta") || {};

    const events = this.store.getEvents(2000);
    const completedEvents = events.filter((e) => e.type === "task.completed");
    const durations = completedEvents.map((e) => e.payload?.durationMs).filter(Boolean);
    const avgLatency = durations.length > 0 ? durations.reduce((a, b) => a + b, 0) / durations.length : 0;

    const firstPassApprovals = events.filter((e) => e.type === "reward.applied" && e.payload?.reason === "first_pass_approval").length;
    const criticRejections = events.filter((e) => e.type === "penalty.applied" && e.payload?.reason === "critic_rejection").length;
    const totalReviews = firstPassApprovals + criticRejections;
    const criticApprovalRate = totalReviews > 0 ? firstPassApprovals / totalReviews : 1;

    return {
      completed: (alpha.completed || 0) + (beta.completed || 0),
      alphaScore: alpha.score || 0,
      betaScore: beta.score || 0,
      avgLatency,
      criticApprovalRate
    };
  }

  _generateNextObjective(stats) {
    const category = META_OBJECTIVE_CATEGORIES[this.categoryIndex];
    return category.generator(stats);
  }
}
