import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";

const DISPATCHED_OBJECTIVES_FILE = path.join(
  path.dirname(new URL(import.meta.url).pathname),
  "..", "data", "dispatched_objectives.json"
);

function loadDispatchedObjectives() {
  try {
    const data = JSON.parse(fs.readFileSync(DISPATCHED_OBJECTIVES_FILE, "utf-8"));
    return new Set(data.hashes || []);
  } catch {
    return new Set();
  }
}

function saveDispatchedObjective(hashes) {
  try {
    // Keep only last 500 hashes to prevent unbounded growth
    const arr = [...hashes].slice(-500);
    fs.writeFileSync(DISPATCHED_OBJECTIVES_FILE, JSON.stringify({ hashes: arr }), "utf-8");
  } catch { /* non-critical */ }
}

function hashObjective(text) {
  return crypto.createHash("sha256").update(text.slice(0, 200)).digest("hex").slice(0, 16);
}

const META_OBJECTIVE_CATEGORIES = [
  {
    category: "code_improvement",
    generator: (stats) => {
      const focuses = [
        "error handling gaps in the event pipeline and race conditions in concurrent task execution",
        "memory leaks, inefficient loops, and synchronous operations blocking the event loop",
        "missing input validation in API endpoints and security vulnerabilities",
        "unused code, dead branches, and cleanup opportunities in the codebase"
      ];
      const focus = focuses[Math.floor(stats.completed / 2) % focuses.length];
      return `Identify and fix the single highest-impact code issue in /home/sharaths/projects/openclaw_build/swarm-platform/src/ related to: ${focus}. Analyze the code, implement the fix, and write a test case using node:test. Provide before/after comparison if applicable.`;
    }
  },
  {
    category: "test_coverage",
    generator: (stats) => {
      return `Find the 3 largest gaps in test coverage in /home/sharaths/projects/openclaw_build/swarm-platform/tests/. Focus on untested error paths and edge cases. For each gap: understand what's not covered, write specific tests using node:test framework. Target: swarm-platform/tests/unit/ for unit tests. Include tests for: coordinator failure recovery, timeout handling in competitive evaluation, store append-only semantics with concurrent writes.`;
    }
  },
  {
    category: "performance",
    generator: (stats) => {
      if (stats.avgLatency > 60000) {
        return `Task latency is critically high at ${Math.round(stats.avgLatency / 1000)}s average. Optimize model routing by using vLLM endpoint at http://127.0.0.1:8000/v1 if available. Check: which models respond fastest on DGX Spark, whether role-model assignments are suboptimal. Recommend specific model swaps. Include latency benchmarks before/after changes.`;
      }
      if (stats.avgLatency > 30000) {
        return `Average task latency is ${Math.round(stats.avgLatency / 1000)}s. Optimize model routing: use vLLM endpoint if available (http://127.0.0.1:8000/v1). Profile the coordinator task dispatch to find delays. Propose and implement one optimization: request batching, result caching, or parallel model invocation.`;
      }
      return `Latency is healthy at ${Math.round(stats.avgLatency / 1000)}s. Enable vLLM endpoint if not running (http://127.0.0.1:8000/v1) and benchmark throughput improvements. Propose a strategy to increase maxConcurrentObjectives safely based on GPU memory and queue patterns.`;
    }
  },
  {
    category: "architecture",
    generator: (stats) => {
      return `Analyze the coordinator.js → openclawRunner.js pipeline. Identify bottlenecks in task decomposition, model spawning latency, and result streaming. Propose and implement ONE specific optimization: either (1) batch request pooling to amortize model startup, (2) result caching for repeated objectives, or (3) parallel subtask dispatch instead of sequential. Provide code changes and latency benchmarks.`;
    }
  },
  {
    category: "security",
    generator: (stats) => {
      return `Run a security audit on the HTTP API endpoints in server.js and routes/. Check for: missing input validation (e.g., dispatch body bounds), auth bypass paths (ADMIN_API_KEY checks), rate limiting gaps (objective creation spam), SQL injection in database queries, command injection in OpenClaw spawning. Fix the highest-severity finding and write a test case to prevent regression.`;
    }
  },
  {
    category: "documentation",
    generator: (stats) => `Generate/update CLAUDE.md with current architecture. Write comprehensive documentation to /home/sharaths/projects/openclaw_build/swarm-platform/docs/architecture.md covering: competitive 3-team flow (Alpha vs Beta, Gamma implements), event log design (append-only idempotency), coordinator decomposition algorithm, model routing logic, tile scoring. Include sequence diagrams for objective dispatch → completion.`
  },
  {
    category: "quality",
    generator: (stats) => {
      if (stats.criticApprovalRate < 0.6) {
        return `Critic rejection rate is very high (only ${Math.round(stats.criticApprovalRate * 100)}% approval). This wastes GPU cycles on rewrites. Analyze failure patterns: is it format errors, incomplete answers, or hallucinations? Design and implement a structured output format that addresses the 3 most common rejection reasons.`;
      }
      if (stats.criticApprovalRate < 0.8) {
        return `Critic approval rate is ${Math.round(stats.criticApprovalRate * 100)}%. Design a structured output format for all agent roles that includes: summary, detailed explanation, implementation (if applicable), validation steps, and edge cases. Implement this in the prompt templates and measure approval rate improvement.`;
      }
      return `Quality metrics look good (${Math.round(stats.criticApprovalRate * 100)}% critic approval). Design a self-critique checklist that agents should follow: completeness of answer, correctness against objective, edge cases covered, actionability of output. Implement as a prompt injection and measure adoption.`;
    }
  },
  {
    category: "coverage",
    generator: (stats) => {
      const completionRate = stats.completed / Math.max(stats.completed + (stats.failed || 0), 1);
      if (completionRate < 0.7) {
        return `Task failure rate is high (${Math.round((1 - completionRate) * 100)}% fail rate). Categorize failure modes: timeout, model refusal, JSON parse error, tool failure. For each, design a specific recovery strategy. Focus on the most common type first and implement recovery logic.`;
      }
      return "Design a capability expansion roadmap. Identify 3 domains where the swarm is weakest. For each: specify needed skills, best model, new objective templates. Make recommendations actionable within 1 week.";
    }
  },
  {
    category: "strategy",
    generator: (stats) => {
      const leadScore = Math.max(stats.alphaScore, stats.betaScore);
      const lagScore = Math.min(stats.alphaScore, stats.betaScore);
      const gap = leadScore - lagScore;
      if (gap > 5000) {
        return `One team has a ${gap}-point lead. Analyze: what is the leading team doing differently? Are there systematic prompt differences, model advantages, or task type biases? Design 3 specific interventions to help the lagging team close the gap. Diversity of approach is valuable.`;
      }
      return `Teams are closely matched (gap: ${gap} pts). Design a high-stakes breakthrough objective requiring creative synthesis across all 4 agent roles. Team with better orchestration should win. Provide objective text and scoring rubric.`;
    }
  },
  {
    category: "knowledge_synthesis",
    generator: (stats) => {
      const capped = Math.min(10, stats.completed);
      return `The swarm has completed ${capped} key objectives. Extract valuable insights: (1) most effective prompt patterns, (2) best model-role combinations, (3) failure modes and recovery strategies, (4) 3 concrete improvements to implement this week. Cap analysis to top 10 objectives for focus.`;
    }
  },
  {
    category: "error_handling",
    generator: (stats) => {
      const focuses = [
        "missing try/catch in async operations in openclawRunner.js, coordinator.js",
        "unhandled Promise rejections in the event pipeline (store.js, eventProcessor.js)",
        "network error recovery in telegramRelay.js and Ollama API calls",
        "graceful degradation when vLLM (port 8000) or Ollama (port 11434) is unavailable"
      ];
      const focus = focuses[Math.floor((stats.completed || 0) / 2) % focuses.length];
      return `Audit error handling in /home/sharaths/projects/openclaw_build/swarm-platform/src/ focusing on: ${focus}. For each gap found: show the specific file and line, explain the failure mode, implement the fix. Do NOT use bare catch blocks - errors should be logged with context.`;
    }
  },
  {
    category: "performance_optimization",
    generator: (stats) => {
      const targets = [
        "store.getEvents() is called 5+ times per request cycle — implement caching with a TTL of 1000ms",
        "metrics.js /summary endpoint duplicates GPU/latency/throughput logic — refactor to share computation",
        "coordinator.js executeDAG runs subtasks in waves but doesn't parallelize within waves — check Promise.all usage",
        "autonomousLoop.js _gatherStats() reads all 2000 events every cycle — cache the result for 10s"
      ];
      const target = targets[Math.floor((stats.completed || 0) / 3) % targets.length];
      return `Optimize: ${target} in /home/sharaths/projects/openclaw_build/swarm-platform/src/. Implement the optimization, measure improvement with a benchmark (before/after timing), and ensure no functionality is broken by running npm test.`;
    }
  },
  {
    category: "api_completeness",
    generator: (stats) => {
      const checks = [
        "GET /api/snapshot is missing activeAgentDetails in its response — add it from QueueManager",
        "POST /api/competitive-run needs rate limiting — max 1 competitive run per 30 seconds",
        "GET /api/leaderboard needs pagination for large event histories",
        "WebSocket server should send an initial state snapshot on connect, not just incremental updates"
      ];
      const check = checks[Math.floor((stats.completed || 0) / 2) % checks.length];
      return `API improvement: ${check}. Implement the change in the relevant route file under /home/sharaths/projects/openclaw_build/swarm-platform/src/routes/. Include input validation, error responses, and update API documentation in docs/ if it exists.`;
    }
  },
  {
    category: "observability",
    generator: (stats) => {
      const areas = [
        "The autonomous loop has no metrics on how many objectives fail vs succeed — add a failure rate counter to _gatherStats()",
        "Model errors from Ollama are logged but not counted — add per-model error rate tracking to teamLearning.js",
        "The competitive evaluation timeout (timeoutMs) is not observable — log evaluation duration to events",
        "Worker tree operations in worktreeManager.js have no timing metrics — add duration logging"
      ];
      const area = areas[Math.floor((stats.completed || 0) / 3) % areas.length];
      return `Add observability: ${area} in /home/sharaths/projects/openclaw_build/swarm-platform/src/. Implement the metric collection, ensure it flows through the event system to the store, and verify it appears in relevant API responses.`;
    }
  }
];

export class AutonomousLoop {
  constructor({ competitiveCoordinator, coordinator, telegramBot, telegramRelay, store, db, chatId, interval = 90000, emitEvent, createEvent, teamLearning, explorationEngine, admissionController, objectivePerformanceTracker, projectRoot }) {
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
    this.objectivePerformanceTracker = objectivePerformanceTracker || null;
    this.baseInterval = interval;
    this.currentInterval = interval;
    this.running = false;
    this.categoryIndex = 0;
    this.objectivesDispatched = 0;
    this.maxConcurrentObjectives = 1;
    this.dispatchedObjectiveHashes = loadDispatchedObjectives();
    this.projectRoot = projectRoot || process.cwd().replace(/\/swarm-platform.*/, "");
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

      // Check vLLM availability and notify
      try {
        const vllmUrl = process.env.VLLM_URL || "http://127.0.0.1:8000";
        const controller = new AbortController();
        const timeout = setTimeout(() => controller.abort(), 3000);
        const response = await fetch(`${vllmUrl}/v1/models`, { signal: controller.signal });
        clearTimeout(timeout);
        if (response.ok) {
          const data = await response.json();
          const models = (data.data || []).map(m => m.id).join(", ");
          await this.telegramBot.sendMessage(this.chatId,
            `✅ *vLLM Online* — Models: ${models || "(none)"}`
          ).catch(() => {});
        }
      } catch {
        await this.telegramBot.sendMessage(this.chatId,
          `⚠️ *vLLM Offline* — http://127.0.0.1:8000 unreachable`
        ).catch(() => {});
      }
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
        const selected = await this._selectNextObjective(stats);
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

        // Log category selection outcome for ROI tracking
        if (result.status === "completed") {
          console.log(`[autonomousLoop] Round complete: category=${category} objectiveId=${objectiveId}`);
        }

        this.objectivesDispatched += 1;

        // Send periodic health summary every 10 objectives
        if (this.objectivesDispatched % 10 === 0 && this.telegramBot && this.chatId) {
          const healthStats = this._gatherStats();
          const healthMsg = [
            `*Health Check — Round ${this.objectivesDispatched}*`,
            `Scores: α=${healthStats.alphaScore} β=${healthStats.betaScore} γ=${healthStats.gammaScore}`,
            `Completed: ${healthStats.completed} · Latency: ${Math.round(healthStats.avgLatency / 1000)}s`,
            `Critic approval: ${Math.round(healthStats.criticApprovalRate * 100)}%`,
            `Category queue: ${META_OBJECTIVE_CATEGORIES[this.categoryIndex]?.category || "?"}`
          ].join("\n");
          this.telegramBot.sendMessage(this.chatId, healthMsg).catch(() => {});
        }

        // Track dispatched objective hash for deduplication
        const hash = hashObjective(objective);
        this.dispatchedObjectiveHashes.add(hash);
        saveDispatchedObjective(this.dispatchedObjectiveHashes);

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

  async _preflightCheck(objective) {
    const checks = { passed: true, issues: [] };

    // 1. Length check
    if (!objective || objective.length < 20) {
      checks.issues.push("objective too short");
      checks.passed = false;
      return checks;
    }

    // 2. File reference check - if objective mentions a file path, verify it exists
    const fileRefPattern = /(?:swarm-platform\/src\/[\w/.]+\.js|swarm-platform\/tests\/[\w/.]+\.js)/g;
    const fileRefs = objective.match(fileRefPattern) || [];
    for (const ref of fileRefs) {
      const fullPath = path.join(this.projectRoot || process.cwd().replace(/\/swarm-platform.*/, ""), ref);
      if (!fs.existsSync(fullPath)) {
        // Try relative to project root
        const altPath = path.join("/home/sharaths/projects/openclaw_build", ref);
        if (!fs.existsSync(altPath)) {
          checks.issues.push(`referenced file not found: ${ref}`);
          // Don't fail - just warn, the objective might still be valid
        }
      }
    }

    if (checks.issues.length === 0) {
      checks.passed = true;
    }

    return checks;
  }

  async _generateAnalysisObjective() {
    if (!this.explorationEngine) return null;

    try {
      const obj = await this.explorationEngine.generateExplorationObjective();
      if (obj && obj.objective && obj.objective.length > 30) {
        console.log(`[autonomousLoop] Analysis-driven objective: ${obj.objective.slice(0, 80)}`);
        return obj;
      }
    } catch (err) {
      console.warn("[autonomousLoop] Analysis objective failed:", err?.message);
    }
    return null;
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

  async _selectNextObjective(stats) {
    const objectiveId = `auto-${Date.now()}`;

    // Calculate lesson-based weights
    const recentLessons = this.teamLearning?.roundHistory?.slice(-2) ?? [];
    const criticalCount = recentLessons.flatMap(r => r.lessons ?? []).filter(l => l.severity === "critical").length;
    const selfWeight = criticalCount > 3 ? 0.35 : 0.6;
    const exploreWeight = 1 - selfWeight;
    if (criticalCount > 3) {
      console.log(`[autonomousLoop] selfWeight=${selfWeight} (${criticalCount} critical lessons → boosting exploration)`);
    }

    // Every 4th objective: check ROI and potentially override category selection
    let category;
    if (this.objectivesDispatched > 0 && this.objectivesDispatched % 4 === 0 && this.objectivePerformanceTracker) {
      try {
        const topROI = await this.objectivePerformanceTracker.getTopROICategories(3);
        if (topROI.length > 0 && topROI[0].avgRoi > 0) {
          // Find the top-ROI category in META_OBJECTIVE_CATEGORIES
          const topCategoryName = topROI[0].category;
          const topCategoryIdx = META_OBJECTIVE_CATEGORIES.findIndex(c => c.category === topCategoryName);
          if (topCategoryIdx >= 0) {
            category = META_OBJECTIVE_CATEGORIES[topCategoryIdx];
            console.log(`[autonomousLoop] ROI-driven category override: ${topCategoryName} (roi=${topROI[0].avgRoi.toFixed(2)})`);
          }
        }
      } catch { /* best-effort, fall through to default */ }
    }
    if (!category) {
      category = META_OBJECTIVE_CATEGORIES[this.categoryIndex];
      this.categoryIndex = (this.categoryIndex + 1) % META_OBJECTIVE_CATEGORIES.length;
    } else {
      this.categoryIndex = (this.categoryIndex + 1) % META_OBJECTIVE_CATEGORIES.length;
    }
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

    // Inject gamma discoveries as context for self-improvement objectives
    if (this.competitiveCoordinator) {
      const gammaInsights = this.competitiveCoordinator.getGammaInsights();
      if (gammaInsights.length > 0) {
        const gammaContext = gammaInsights.slice(-2)
          .map(g => `${g.discoveries || ""}${g.recommendations ? `\nRecommendations: ${g.recommendations}` : ""}`)
          .join("\n---\n")
          .slice(0, 400);
        if (gammaContext.trim()) {
          selfObjectiveText += `\n\nGamma team's recent discoveries from implementation: ${gammaContext}. Build on these findings — don't repeat work already done by Gamma.`;
        }
      }
    }

    // Vary objective text to avoid exact duplicates by appending context
    const runCount = this.objectivesDispatched;
    if (runCount > 0 && runCount % 3 === 0) {
      selfObjectiveText += `\n\nContext: This is run #${runCount}. Focus on issues NOT covered in previous rounds. Look for NEW specific problems.`;
    }

    // Check for duplicate and skip if already dispatched recently
    const selfHash = hashObjective(selfObjectiveText);
    if (this.dispatchedObjectiveHashes.has(selfHash)) {
      // Force advance to next category
      this.categoryIndex = (this.categoryIndex + 1) % META_OBJECTIVE_CATEGORIES.length;
      const nextCategory = META_OBJECTIVE_CATEGORIES[this.categoryIndex];
      this.categoryIndex = (this.categoryIndex + 1) % META_OBJECTIVE_CATEGORIES.length;
      selfObjectiveText = nextCategory.generator(stats);
    }

    const selfObj = { objective: selfObjectiveText, objectiveId, isExternal: false, category: category.category };

    // Use weighObjectives if explorationEngine is available
    if (this.explorationEngine && this.objectivesDispatched > 0) {
      let explorationData;

      // Every 3rd objective: try to use real code analysis first
      if (this.objectivesDispatched % 3 === 2) {
        const analysisObj = await this._generateAnalysisObjective();
        if (analysisObj) {
          explorationData = analysisObj;
        } else {
          explorationData = this.objectivesDispatched % 6 === 0
            ? this.explorationEngine.generateSkillDiscoveryObjective()
            : await this.explorationEngine.generateExplorationObjective(stats);
        }
      } else {
        explorationData = this.objectivesDispatched % 6 === 0
          ? this.explorationEngine.generateSkillDiscoveryObjective()
          : await this.explorationEngine.generateExplorationObjective(stats);
      }

      const exploreObj = { objective: explorationData.objective, objectiveId, isExternal: true, category: explorationData.category };

      // Boost weights based on ROI data if objectivePerformanceTracker is available
      let adjustedSelfWeight = selfWeight;
      let adjustedExploreWeight = exploreWeight;
      if (this.objectivePerformanceTracker) {
        try {
          const topROI = await this.objectivePerformanceTracker.getTopROICategories(1);
          if (topROI.length > 0) {
            const topCategory = topROI[0].category;
            const topRoi = topROI[0].avgRoi;
            
            // Boost the weight of whichever objective type matches the top-ROI category
            if (selfObj.category === topCategory) {
              adjustedSelfWeight = Math.min(selfWeight * 1.5, 0.9);
              adjustedExploreWeight = 1 - adjustedSelfWeight;
              console.log(`[autonomousLoop] ROI boost: category=${topCategory} roi=${topRoi.toFixed(2)} selfWeight=${adjustedSelfWeight.toFixed(2)}`);
            } else if (exploreObj.category === topCategory) {
              adjustedExploreWeight = Math.min(exploreWeight * 1.5, 0.9);
              adjustedSelfWeight = 1 - adjustedExploreWeight;
              console.log(`[autonomousLoop] ROI boost: category=${topCategory} roi=${topRoi.toFixed(2)} exploreWeight=${adjustedExploreWeight.toFixed(2)}`);
            }
          }
        } catch { /* best-effort ROI boost */ }
      }

      const weighted = this.explorationEngine.weighObjectives(selfObj, exploreObj, { ...stats, selfWeight: adjustedSelfWeight, exploreWeight: adjustedExploreWeight });

      // Log category selection with weights
      const selected = weighted.selected;
      const selectedCategory = selected.category;
      const selectedWeight = selected.isExternal ? adjustedExploreWeight : adjustedSelfWeight;
      const roiBoost = this.objectivePerformanceTracker ? await this.objectivePerformanceTracker.getTopROICategories(1).catch(() => []) : [];
      const roiValue = roiBoost.length > 0 ? roiBoost[0].avgRoi : 0;
      console.log(`[autonomousLoop] Selected category=${selectedCategory} weight=${selectedWeight?.toFixed(2)} (roi=${roiValue?.toFixed(2) || 0})`);

      // Use global lesson tie-breaker: if weights are close (within 0.1), log suggested category (informational)
      if (this.teamLearning && Math.abs(adjustedSelfWeight - adjustedExploreWeight) < 0.1) {
        this.teamLearning.getSuggestedObjective(stats).then(suggestedCategory => {
          if (suggestedCategory) {
            console.log(`[autonomousLoop] Cross-team lesson tie-breaker suggests category: ${suggestedCategory}`);
          }
        }).catch((err) => {
          console.warn(`[autonomousLoop] Tie-breaker lookup failed: ${err?.message}`);
        });
      }

      // Pre-flight validation
      try {
        const preflight = await this._preflightCheck(selected.objective);
        if (!preflight.passed) {
          console.warn(`[autonomousLoop] Pre-flight failed for objective: ${preflight.issues.join(", ")}`);
          // Try to get a fallback
          selected.objective = `Review and improve error handling in swarm-platform/src/server.js: ensure all async route handlers have proper try/catch blocks and return meaningful error responses.`;
        } else if (preflight.issues.length > 0) {
          console.log(`[autonomousLoop] Pre-flight warnings: ${preflight.issues.join(", ")} (proceeding anyway)`);
        }
      } catch (err) {
        console.warn("[autonomousLoop] Pre-flight check error:", err?.message);
      }

      return selected;
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
