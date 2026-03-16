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
    generator: () => "Research what capabilities the swarm platform is currently missing compared to a full multi-agent AI system. Consider: error recovery strategies, inter-agent communication patterns, context sharing between sub-tasks, and progressive refinement. List the top 3 most impactful gaps with implementation suggestions."
  },
  {
    category: "documentation",
    generator: (stats) => `Generate a comprehensive status report of the swarm platform. Include: total completed objectives (${stats.completed}), team scores (Alpha: ${stats.alphaScore}, Beta: ${stats.betaScore}, Gamma: ${stats.gammaScore}), average task latency, model utilization breakdown, and recommendations for the next 24 hours of autonomous operation.`
  },
  {
    category: "system_health",
    generator: () => "Analyze the system health of our swarm platform running on DGX Spark. Check GPU memory usage patterns, model loading/unloading frequency, and identify any models that consistently cause OOM errors. Report current resource utilization and recommend optimal model concurrency limits."
  },
  {
    category: "testing",
    generator: () => "Design a comprehensive test plan for the swarm platform's coordinator-specialist pattern. Include tests for: task decomposition quality, dependency graph correctness, critic review accuracy, aggregation completeness, and error recovery. Provide specific test scenarios with expected outcomes."
  }
];

export class AutonomousLoop {
  constructor({ competitiveCoordinator, coordinator, telegramBot, store, db, chatId, interval = 90000, emitEvent, createEvent, teamLearning, explorationEngine, admissionController }) {
    this.competitiveCoordinator = competitiveCoordinator;
    this.coordinator = coordinator;
    this.telegramBot = telegramBot;
    this.store = store;
    this.db = db;
    this.chatId = chatId;
    this.interval = interval;
    this.emitEvent = emitEvent;
    this.createEvent = createEvent;
    this.teamLearning = teamLearning;
    this.explorationEngine = explorationEngine;
    this.admissionController = admissionController || null;
    this.baseInterval = interval;
    this.currentInterval = interval;
    this.running = false;
    this.categoryIndex = 0;
    this.objectivesDispatched = 0;
    this.maxConcurrentObjectives = 1;
  }

  async start() {
    this.running = true;
    const mode = this.competitiveCoordinator ? "competitive (3-team)" : "single-team";
    console.log(`[autonomousLoop] Started in ${mode} mode.`);

    // Reconcile stale objectives from previous crashes
    const board = this.store.getObjectiveBoard(500);
    const staleActive = board.filter(o => o.status === "active");
    if (staleActive.length > 0) {
      console.log(`[autonomousLoop] Reconciling ${staleActive.length} stale active objectives...`);
      for (const obj of staleActive) {
        await this.emitEvent(
          this.createEvent({
            type: "swarm.session.failed",
            teamId: obj.teamId || "program-lead",
            source: "autonomous-loop",
            payload: { objectiveId: obj.objectiveId, error: "stale_reconciliation", reason: "Server restarted; objective was active during previous session" }
          })
        );
      }
    }

    if (this.telegramBot && this.chatId) {
      const stats = this._gatherStats();
      await this.telegramBot.sendMessage(this.chatId,
        `*Swarm Platform Online*\n` +
        `Mode: ${mode}\n` +
        `Objectives completed: ${stats.completed}\n` +
        `Scores: A=${stats.alphaScore} B=${stats.betaScore} G=${stats.gammaScore}\n` +
        `Avg latency: ${Math.round(stats.avgLatency / 1000)}s\n` +
        `Teams Alpha+Beta compete, Gamma implements, Delta explores.` +
        (staleActive.length > 0 ? `\n${staleActive.length} stale objectives cleaned up.` : "")
      ).catch(() => {});
    }

    while (this.running) {
      let objectiveId = `auto-${Date.now()}`;
      try {
        const board = this.store.getObjectiveBoard(200);
        const activeCount = board.filter((o) => o.status === "active").length;
        if (activeCount >= this.maxConcurrentObjectives) {
          await new Promise((r) => setTimeout(r, this.currentInterval || this.interval));
          continue;
        }

        const stats = this._gatherStats();
        const selected = this._selectNextObjective(stats);
        objectiveId = selected.objectiveId;
        const { objective, isExternal, category } = selected;

        console.log(`[autonomousLoop] #${this.objectivesDispatched + 1} [${category}${isExternal ? " EXPLORE" : ""}]: ${objective.slice(0, 80)}...`);

        await this.emitEvent(
          this.createEvent({
            type: "objective.created",
            teamId: "program-lead",
            source: "autonomous-loop",
            payload: { objectiveId, objective, actorRole: "program-lead", source: "autonomous", category, isExternal }
          })
        );

        let result;
        if (isExternal && this.coordinator) {
          console.log(`[autonomousLoop] Exploration objective routed to team-delta`);
          // #region agent log
          fetch('http://localhost:7454/ingest/1e0718d6-c2bf-4928-9fab-1ef1d6f587b4',{method:'POST',headers:{'Content-Type':'application/json','X-Debug-Session-Id':'a5b4ff'},body:JSON.stringify({sessionId:'a5b4ff',location:'autonomousLoop.js:delta-dispatch',message:'Delta dispatch',data:{objectiveId,category,isExternal:true,objectivePreview:objective.slice(0,150)},hypothesisId:'H3-delta-dispatch',timestamp:Date.now()})}).catch(()=>{});
          // #endregion
          result = await this.coordinator.executeObjective({ teamId: "team-delta", objective, objectiveId, maxIterations: 2 });
        } else if (this.competitiveCoordinator) {
          result = await this.competitiveCoordinator.executeCompetitiveObjective({ objective, objectiveId, category });
        } else {
          result = await this.coordinator.executeObjective({ teamId: "team-alpha", objective, objectiveId, maxIterations: 2 });
        }

        this.objectivesDispatched += 1;

      } catch (err) {
        const errMsg = err?.stack || err?.message || String(err);
        console.error(`[autonomousLoop] Round ${objectiveId} FAILED:`, errMsg);
        if (this.telegramBot && this.chatId) {
          try {
            await this.telegramBot.sendMessage(
              this.chatId,
              `⚠️ Round ${objectiveId} failed: ${(err?.message || "unknown error").slice(0, 200)}`
            );
          } catch { /* best-effort */ }
        }
      }

      if (this.running) {
        // Calculate dynamic interval based on queue depth and load state
        let queueDepth = 0;
        let loadState = "green";
        try {
          if (this.admissionController) {
            const decision = this.admissionController.decide({ role: "program-lead" });
            loadState = decision?.state || "green";
          }
          // Count active objectives as a proxy for queue depth
          const board = this.store.getObjectiveBoard(200);
          queueDepth = board.filter((o) => o.status === "active").length;
        } catch { /* best-effort */ }

        this.currentInterval = this._calculateDynamicInterval(queueDepth, loadState);
        if (this.currentInterval !== this.baseInterval) {
          console.log(`[autonomousLoop] Interval adjusted to ${this.currentInterval}ms (queue=${queueDepth}, load=${loadState})`);
        }

        await new Promise((r) => setTimeout(r, this.currentInterval));
      }
    }
  }

  stop() {
    this.running = false;
    console.log("[autonomousLoop] Stopped.");
  }

  _calculateDynamicInterval(queueDepth, loadState) {
    // Backoff on large queues
    if (queueDepth > 30) return 15000;
    if (queueDepth > 20) return 30000;
    if (queueDepth > 10) return 60000;

    // Aggressive backoff on critical load with empty queue
    if (queueDepth === 0 && loadState === "critical") return 180000;
    if (loadState === "critical") return 180000;
    if (loadState === "high") return 120000;

    return this.baseInterval; // default (90s or configured)
  }

  _selectNextObjective(stats) {
    const objectiveId = `auto-${Date.now()}`;

    // Calculate lesson-based weights
    const recentLessons = this.teamLearning?.roundHistory?.slice(-2) ?? [];
    const criticalCount = recentLessons.flatMap(r => r.lessons ?? []).filter(l => l.severity === "critical").length;
    const selfWeight = criticalCount > 3 ? 0.35 : 0.6;
    const exploreWeight = 1 - selfWeight;
    if (criticalCount > 3) {
      console.log(`[autonomousLoop] selfWeight=${selfWeight} (${criticalCount} critical lessons → boosting exploration)`);
    }

    // Always generate both objective types so weighObjectives can compare
    const category = META_OBJECTIVE_CATEGORIES[this.categoryIndex];
    this.categoryIndex = (this.categoryIndex + 1) % META_OBJECTIVE_CATEGORIES.length;
    let selfObjectiveText = category.generator(stats);

    // Inject learning context into self-improvement objective
    if (this.teamLearning && this.teamLearning.roundHistory.length > 0) {
      const criticalLessons = this.teamLearning.roundHistory.slice(-3)
        .flatMap(r => r.lessons)
        .filter(l => l.severity === "critical")
        .slice(0, 3)
        .map(l => l.lesson)
        .join("; ");
      if (criticalLessons) {
        selfObjectiveText += `\n\nRecent critical lessons from past rounds: ${criticalLessons}. Factor these into your analysis.`;
      }
    }

    const selfObj = { objective: selfObjectiveText, objectiveId, isExternal: false, category: category.category };

    // Use weighObjectives if explorationEngine is available
    if (this.explorationEngine && this.objectivesDispatched > 0) {
      const explorationData = this.objectivesDispatched % 6 === 0
        ? this.explorationEngine.generateSkillDiscoveryObjective()
        : this.explorationEngine.generateExplorationObjective(stats);
      const exploreObj = { objective: explorationData.objective, objectiveId, isExternal: true, category: explorationData.category };

      const weighted = this.explorationEngine.weighObjectives(selfObj, exploreObj, { ...stats, selfWeight, exploreWeight });

      // Use global lesson tie-breaker: if weights are close (within 0.1), defer to lesson-suggested category
      if (this.teamLearning && Math.abs(selfWeight - exploreWeight) < 0.1) {
        this.teamLearning.getSuggestedObjective(stats).then(suggestedCategory => {
          if (suggestedCategory) {
            console.log(`[autonomousLoop] Cross-team lesson tie-breaker suggests category: ${suggestedCategory}`);
          }
        }).catch(() => {});
      }

      return weighted.selected;
    }

    return selfObj;
  }

  _gatherStats() {
    const leaderboard = this.store.getLeaderboard();
    const alpha = leaderboard.find((r) => r.teamName === "Team Alpha" || r.teamId === "team-alpha") || {};
    const beta = leaderboard.find((r) => r.teamName === "Team Beta" || r.teamId === "team-beta") || {};
    const gamma = leaderboard.find((r) => r.teamName === "Team Gamma" || r.teamId === "team-gamma") || {};

    const events = this.store.getEvents(2000);
    const completedEvents = events.filter((e) => e.type === "task.completed");
    const durations = completedEvents.map((e) => e.payload?.durationMs).filter(Boolean);
    const avgLatency = durations.length > 0 ? durations.reduce((a, b) => a + b, 0) / durations.length : 0;

    const firstPassApprovals = events.filter((e) => e.type === "reward.applied" && e.payload?.reason === "first_pass_approval").length;
    const criticRejections = events.filter((e) => e.type === "penalty.applied" && e.payload?.reason === "critic_rejection").length;
    const totalReviews = firstPassApprovals + criticRejections;
    const criticApprovalRate = totalReviews > 0 ? firstPassApprovals / totalReviews : 1;

    return {
      completed: (alpha.completed || 0) + (beta.completed || 0) + (gamma.completed || 0),
      alphaScore: alpha.score || 0,
      betaScore: beta.score || 0,
      gammaScore: gamma.score || 0,
      avgLatency,
      criticApprovalRate
    };
  }
}
