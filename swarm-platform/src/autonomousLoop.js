const META_OBJECTIVE_CATEGORIES = [
  {
    category: "performance",
    generator: (stats) => {
      if (stats.avgLatency > 60000) {
        return `Task latency is critically high at ${Math.round(stats.avgLatency / 1000)}s average. Investigate: which Ollama models are slowest to respond on this DGX Spark hardware, whether model loading/unloading is causing spikes, and whether role-model assignments are suboptimal. Recommend specific model swaps (e.g., replace qwen2.5:7b with phi3:mini for research tasks). Include expected latency improvement for each change.`;
      }
      if (stats.avgLatency > 30000) {
        return `Average task latency is ${Math.round(stats.avgLatency / 1000)}s. Identify the top 3 latency contributors. For each: is it model load time, inference time, or orchestration overhead? Propose targeted optimizations. Consider model pre-warming strategies for frequently used roles.`;
      }
      return `Latency is healthy at ${Math.round(stats.avgLatency / 1000)}s. Now focus on throughput: how can we safely increase concurrent objective dispatch? Analyze the queue depth patterns, GPU memory headroom, and suggest a safe maxConcurrentObjectives value above the current 1.`;
    }
  },
  {
    category: "quality",
    generator: (stats) => {
      if (stats.criticApprovalRate < 0.6) {
        return `Critic rejection rate is very high (only ${Math.round(stats.criticApprovalRate * 100)}% approval). This wastes GPU cycles on rewrites. Deep-dive on what the critic is consistently rejecting: is it incomplete answers, wrong format, hallucinations, or missing code examples? Write a concrete prompt template for the BUILD role that pre-empts the 3 most common rejection reasons.`;
      }
      if (stats.criticApprovalRate < 0.8) {
        return `Critic approval rate is ${Math.round(stats.criticApprovalRate * 100)}%. The gap between RESEARCH and BUILD agent output quality is likely the cause. Design a structured output format for BUILD agents that includes: summary, implementation code, verification steps, and known limitations. This reduces revision cycles.`;
      }
      return `Quality metrics look good (${Math.round(stats.criticApprovalRate * 100)}% critic approval). Now focus on output depth: design a self-critique checklist that BUILD and INTEGRATOR agents should run through before submitting. Include: completeness, correctness, edge cases covered, and actionability of the output.`;
    }
  },
  {
    category: "coverage",
    generator: (stats) => {
      const completionRate = stats.completed / Math.max(stats.completed + (stats.failed || 0), 1);
      if (completionRate < 0.7) {
        return `Task failure rate is high (${Math.round((1 - completionRate) * 100)}% fail rate). Categorize failure modes: timeout, model refusal, JSON parse error, tool failure, or logical errors. For each category, design a specific recovery strategy. Focus on the most common failure type first.`;
      }
      return "Design a capability expansion roadmap for the swarm. Identify 3 domains where the swarm is currently weakest based on objective history. For each domain, specify: what skills are needed, which model handles it best, and what new objective templates would exercise those skills. Make recommendations actionable within 1 week.";
    }
  },
  {
    category: "documentation",
    generator: (stats) => `Write a living architecture document for the OpenClaw Swarm Platform based on what you observe. Include: current competitive team structure (Alpha vs Beta, Gamma implements winner), the complete event flow from dispatch to score update, and the adaptive scheduling algorithm. Score snapshot: Alpha=${stats.alphaScore}, Beta=${stats.betaScore}, Gamma=${stats.gammaScore}. Identify 2 architectural risks and propose mitigations.`
  },
  {
    category: "system_health",
    generator: () => "Perform a comprehensive health assessment of the DGX Spark-hosted swarm. Investigate: (1) current GPU utilization vs available VRAM, (2) which Ollama models are loaded vs cold, (3) any recent OOM events in system logs, (4) whether the 13 available models are optimally distributed across roles. Produce a VRAM budget table showing each loaded model's footprint."
  },
  {
    category: "testing",
    generator: () => "Design and write 5 specific integration test scenarios for the competitive coordinator pipeline. Each test should: specify input objective text, expected coordinator decomposition, expected per-role outputs, and scoring assertions. Focus on edge cases: empty objectives, single-role tasks, coordinator decomposition with 5+ subtasks, and tasks requiring tool use. Provide executable test code in Node.js using node:test."
  },
  {
    category: "strategy",
    generator: (stats) => {
      const leadScore = Math.max(stats.alphaScore, stats.betaScore);
      const lagScore = Math.min(stats.alphaScore, stats.betaScore);
      const gap = leadScore - lagScore;
      if (gap > 5000) {
        return `One team has a ${gap}-point lead. Analyze: what is the leading team doing differently? Are there systematic prompt differences, model advantages, or task type biases? Design 3 specific interventions that could help the lagging team close the gap without simply copying the leader. Diversity of approach is valuable.`;
      }
      return `Teams are closely matched (gap: ${gap} pts). To break the tie, design a high-stakes "breakthrough objective" — a complex, multi-step task that requires creative synthesis across all 4 agent roles. The team with better orchestration and model utilization should win. Provide the objective text and scoring rubric.`;
    }
  },
  {
    category: "knowledge_synthesis",
    generator: (stats) => `The swarm has completed ${stats.completed} objectives. Extract the most valuable insights from this body of work. What patterns have emerged? What does the swarm know about its own capabilities? Write a "lessons learned" memo covering: (1) most effective prompt patterns discovered, (2) model-role combinations that produced best results, (3) objective types that consistently fail and why, (4) 3 concrete improvements to implement this week.`
  },
  {
    category: "innovation",
    generator: () => "Propose a novel enhancement to the OpenClaw Swarm Platform that doesn't currently exist. Consider: multi-round debate between Alpha and Beta before Gamma implements, cross-objective context sharing (results from one objective inform the next), agent specialization evolution (roles that adapt based on performance history), or meta-learning where the program lead writes new objective templates based on team feedback. Design the most impactful enhancement with full implementation details."
  }
];

export class AutonomousLoop {
  constructor({ competitiveCoordinator, coordinator, telegramBot, telegramRelay, store, db, chatId, interval = 90000, emitEvent, createEvent, teamLearning, explorationEngine, admissionController }) {
    this.competitiveCoordinator = competitiveCoordinator;
    this.coordinator = coordinator;
    this.telegramBot = telegramBot;
    this.telegramRelay = telegramRelay;
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
          // Send Telegram summary for competitive round
          if (result.status === "completed" && this.telegramRelay && this.chatId) {
            const roundResult = {
              winner: result.winner,
              scoreDelta: (result.evaluation?.alphaScore ?? 0) + (result.evaluation?.betaScore ?? 0),
              avgLatency: this._gatherStats().avgLatency,
              criticApprovalRate: this._gatherStats().criticApprovalRate
            };
            await this.telegramRelay.sendSwarmSummary({
              store: this.store,
              roundResult,
              objectiveText: objective,
              chatId: this.chatId
            }).catch((err) => {
              console.warn("[autonomousLoop] sendSwarmSummary failed:", err?.message);
            });
          }
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
