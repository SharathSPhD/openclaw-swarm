import { SwarmCoordinator } from "./coordinator.js";
import { buildEvaluationPrompt, extractAndValidate } from "./structuredEvaluator.js";
import { ObjectivePerformanceTracker } from "./objectivePerformance.js";

export class CompetitiveCoordinator {
  constructor({
    runTask,
    emitEvent,
    createEvent,
    store,
    db,
    modelName = "qwen2.5:14b",
    chooseModelForRole,
    timeoutMs = 300000,
    worktreeManager,
    telegramBot,
    chatId,
    teamLearning,
    objectivePerformanceTracker
  }) {
    this.runTask = runTask;
    this.emitEvent = emitEvent;
    this.createEvent = createEvent;
    this.store = store;
    this.db = db;
    this.modelName = modelName;
    this.chooseModelForRole = chooseModelForRole;
    this.timeoutMs = timeoutMs;
    this.worktreeManager = worktreeManager;
    this.telegramBot = telegramBot;
    this.chatId = chatId;
    this.teamLearning = teamLearning;
    this.objectivePerformanceTracker = objectivePerformanceTracker || null;

    this.alphaCoordinator = new SwarmCoordinator({
      runTask, emitEvent, createEvent, store, db,
      modelName, chooseModelForRole, timeoutMs
    });

    this.betaCoordinator = new SwarmCoordinator({
      runTask, emitEvent, createEvent, store, db,
      modelName, chooseModelForRole, timeoutMs
    });

    this.gammaCoordinator = new SwarmCoordinator({
      runTask, emitEvent, createEvent, store, db,
      modelName, chooseModelForRole, timeoutMs
    });

    this.currentPhase = "idle";
    this.currentObjective = null;
  }

  async _notify(text) {
    if (this.telegramBot && this.chatId) {
      await this.telegramBot.sendMessage(this.chatId, text).catch(() => {});
    }
  }

  async executeCompetitiveObjective({ objective, objectiveId, category = "unknown" }) {
    this.currentObjective = { objectiveId, objective, category, phase: "forking" };

    await this.emitEvent(this.createEvent({
      type: "competitive.started",
      teamId: "program-lead",
      source: "competitive-coordinator",
      payload: { objectiveId, objective }
    }));

    console.log(`[competitive] Objective started: ${objective.slice(0, 80)}...`);

    // Capture leaderboard scores before the round for ROI tracking
    const preRoundLeaderboard = this.store?.getLeaderboard?.() || [];
    const preRoundTotalScore = preRoundLeaderboard.reduce((sum, r) => sum + (r.score || 0), 0);

    let alphaWorktree = null;
    let betaWorktree = null;

    try {
      // Phase 1: Fork - set up worktrees and dispatch to both teams
      this.currentPhase = "forking";
      this.currentObjective.phase = "forking";

      if (this.worktreeManager) {
        try {
          alphaWorktree = this.worktreeManager.setupWorktree("team-alpha", objectiveId);
          betaWorktree = this.worktreeManager.setupWorktree("team-beta", objectiveId);
        } catch (err) {
          console.warn("[competitive] Worktree setup failed, proceeding without isolation:", err?.message);
        }
      }

      await this.emitEvent(this.createEvent({
        type: "competitive.forked",
        teamId: "program-lead",
        source: "competitive-coordinator",
        payload: {
          objectiveId,
          alphaWorktree: alphaWorktree?.path || null,
          betaWorktree: betaWorktree?.path || null
        }
      }));

      console.log("[competitive] Fork phase: dispatching to both teams");

      const [alphaResult, betaResult] = await this._forkToTeams(objective, objectiveId);

      // Phase 2: Evaluate - program lead picks the winner
      this.currentPhase = "evaluating";
      this.currentObjective.phase = "evaluating";

      console.log(`[competitive] Evaluate phase: alpha=${alphaResult.status}, beta=${betaResult.status}`);

      const evaluation = await this._evaluateOutputs(alphaResult, betaResult, objective, objectiveId);

      await this.emitEvent(this.createEvent({
        type: "competitive.evaluated",
        teamId: "program-lead",
        source: "competitive-coordinator",
        payload: {
          objectiveId,
          winner: evaluation.winner,
          reasoning: evaluation.reasoning,
          alphaStatus: alphaResult.status,
          betaStatus: betaResult.status
        }
      }));

      // Award points
      const winnerTeam = (evaluation.winner === "tie_timeout" || !evaluation.winner)
        ? (alphaResult.status === "completed" ? "team-alpha" : "team-beta")
        : evaluation.winner;
      const loserTeam = winnerTeam === "team-alpha" ? "team-beta" : "team-alpha";

      await this.emitEvent(this.createEvent({
        type: "reward.applied",
        teamId: winnerTeam,
        source: "competitive-coordinator",
        payload: { objectiveId, pointsAdded: 100, reason: "competitive_winner" }
      }));

      await this.emitEvent(this.createEvent({
        type: "reward.applied",
        teamId: loserTeam,
        source: "competitive-coordinator",
        payload: { objectiveId, pointsAdded: 25, reason: "competitive_participant" }
      }));

      console.log(`[competitive] Winner: ${winnerTeam}. Reasoning: ${evaluation.reasoning.slice(0, 100)}`);

      // Phase 3: Implement - team-gamma implements the winning approach
      this.currentPhase = "implementing";
      this.currentObjective.phase = "implementing";

      let gammaWorktree = null;
      if (this.worktreeManager) {
        try {
          gammaWorktree = this.worktreeManager.setupWorktree("team-gamma", objectiveId);
        } catch (err) {
          console.warn("[competitive] Gamma worktree setup failed:", err?.message);
        }
      }

      await this.emitEvent(this.createEvent({
        type: "competitive.implementing",
        teamId: "team-gamma",
        source: "competitive-coordinator",
        payload: { objectiveId, winnerTeam, gammaWorktree: gammaWorktree?.path || null }
      }));

      console.log("[competitive] Implement phase: team-gamma building winner's approach");

      const winnerOutput = winnerTeam === "team-alpha" ? alphaResult : betaResult;
      const gammaResult = await this._implementWinner(winnerOutput, objective, objectiveId);

      await this.emitEvent(this.createEvent({
        type: "reward.applied",
        teamId: "team-gamma",
        source: "competitive-coordinator",
        payload: { objectiveId, pointsAdded: 75, reason: "competitive_implementation" }
      }));

      // Phase 4: Merge - merge gamma's work into main and push
      this.currentPhase = "merging";
      this.currentObjective.phase = "merging";

      let mergeInfo = null;
      if (this.worktreeManager && gammaWorktree) {
        try {
          mergeInfo = await this.worktreeManager.mergeAndPush("team-gamma", objectiveId);

          await this.emitEvent(this.createEvent({
            type: "competitive.merged",
            teamId: "team-gamma",
            source: "competitive-coordinator",
            payload: {
              objectiveId,
              changedFiles: mergeInfo.changedFiles,
              needsRestart: mergeInfo.needsRestart
            }
          }));

          await this.emitEvent(this.createEvent({
            type: "reward.applied",
            teamId: "team-gamma",
            source: "competitive-coordinator",
            payload: { objectiveId, pointsAdded: 50, reason: "competitive_merge" }
          }));

          console.log(`[competitive] Merged. Changed: ${mergeInfo.changedFiles.length} files. Restart: ${mergeInfo.needsRestart}`);

          if (mergeInfo.needsRestart) {
            await this.emitEvent(this.createEvent({
              type: "competitive.restarting",
              teamId: "program-lead",
              source: "competitive-coordinator",
              payload: { objectiveId, reason: "server_code_changed" }
            }));

            console.log("[competitive] Self-update detected, scheduling PM2 reload");
            try {
              const { execFileSync } = await import("node:child_process");
              setTimeout(() => {
                try {
                  execFileSync("pm2", ["reload", "swarm-platform"], { timeout: 10000 });
                } catch (reloadErr) {
                  console.warn("[competitive] PM2 reload failed:", reloadErr?.message);
                }
              }, 3000);
            } catch { /* pm2 not available */ }
          }
        } catch (err) {
          console.warn("[competitive] Merge failed:", err?.message);
          console.warn(`[competitive] Merge failed: ${err?.message}`);
        }
      }

      // Cleanup worktrees
      if (this.worktreeManager) {
        try { this.worktreeManager.cleanupWorktree("team-alpha"); } catch { /* ok */ }
        try { this.worktreeManager.cleanupWorktree("team-beta"); } catch { /* ok */ }
      }

      const fullResult = {
        objectiveId,
        status: "completed",
        winner: winnerTeam,
        alphaResult,
        betaResult,
        evaluation,
        gammaResult,
        mergeInfo
      };

      // Team Learning: analyze round and provide cross-team feedback
      let lessons = [];
      let feedback = null;
      if (this.teamLearning) {
        try {
          lessons = await this.teamLearning.analyzeRound(fullResult);
          feedback = await this.teamLearning.generateCrossTeamFeedback(fullResult);

          await this.emitEvent(this.createEvent({
            type: "competitive.feedback",
            teamId: "program-lead",
            source: "team-learning",
            payload: {
              objectiveId,
              lessonsCount: lessons.length,
              feedback: feedback ? {
                winner: feedback.winner,
                loserAdvice: feedback.feedbackToLoser.message.slice(0, 500),
                winnerAdvice: feedback.feedbackToWinner.message.slice(0, 500)
              } : null
            }
          }));
        } catch (err) {
          console.warn("[competitive] Learning analysis failed:", err?.message);
        }
      }

      // Objective ROI tracking (Phase 5)
      if (this.objectivePerformanceTracker) {
        try {
          const postRoundLeaderboard = this.store?.getLeaderboard?.() || [];
          const postRoundTotalScore = postRoundLeaderboard.reduce((sum, r) => sum + (r.score || 0), 0);
          const category = this.currentObjective?.category || "unknown";
          await this.objectivePerformanceTracker.recordObjectiveImpact({
            objectiveId,
            category,
            before: { totalScore: preRoundTotalScore },
            after: { totalScore: postRoundTotalScore },
            lessons
          });
        } catch (err) {
          console.warn("[competitive] ROI tracking failed:", err?.message);
        }
      }

      this.currentPhase = "idle";
      this.currentObjective = { ...this.currentObjective, phase: "completed" };

      // Send ONE condensed Telegram summary for the entire round
      await this._sendRoundSummary({ objective, objectiveId, evaluation, winnerTeam, loserTeam, alphaResult, betaResult, gammaResult, mergeInfo, lessons, feedback });

      return fullResult;

    } catch (err) {
      this.currentPhase = "idle";
      this.currentObjective = { ...this.currentObjective, phase: "failed" };

      await this._notify(`*Competitive Objective FAILED*: ${err?.message || "unknown"}`);

      if (this.worktreeManager) {
        try { this.worktreeManager.cleanupWorktree("team-alpha"); } catch { /* ok */ }
        try { this.worktreeManager.cleanupWorktree("team-beta"); } catch { /* ok */ }
        try { this.worktreeManager.cleanupWorktree("team-gamma"); } catch { /* ok */ }
      }

      return {
        objectiveId,
        status: "failed",
        error: err?.message || String(err)
      };
    }
  }

  async _forkToTeams(objective, objectiveId) {
    const alphaId = `${objectiveId}-alpha`;
    const betaId = `${objectiveId}-beta`;

    const [alphaResult, betaResult] = await Promise.all([
      this.alphaCoordinator.executeObjective({
        teamId: "team-alpha",
        objective,
        objectiveId: alphaId,
        maxIterations: 2
      }),
      this.betaCoordinator.executeObjective({
        teamId: "team-beta",
        objective,
        objectiveId: betaId,
        maxIterations: 2
      })
    ]);

    return [alphaResult, betaResult];
  }

  _extractTextFromOpenClawJson(raw) {
    const trimmed = (raw || "").trim();
    if (!trimmed) return "";

    const extractPayloadText = (obj) => {
      const payloads = obj?.result?.payloads ?? obj?.payloads ?? [];
      for (const p of payloads) {
        if (p?.text) return p.text;
      }
      if (obj?.result?.text) return obj.result.text;
      if (obj?.text) return obj.text;
      return null;
    };

    // Try parsing the entire output as one JSON object (pretty-printed)
    try {
      const obj = JSON.parse(trimmed);
      const text = extractPayloadText(obj);
      if (text) return text;
    } catch { /* not valid JSON as a whole */ }

    // Try line-by-line (JSONL format)
    try {
      const lines = trimmed.split("\n").filter(Boolean);
      for (const line of lines) {
        try {
          const obj = JSON.parse(line);
          const text = extractPayloadText(obj);
          if (text) return text;
        } catch { /* skip */ }
      }
    } catch { /* use raw */ }

    return trimmed;
  }

  async _evaluateOutputs(alphaResult, betaResult, objective, objectiveId) {
    const { spawn } = await import("node:child_process");

    const alphaOutput = alphaResult.status === "completed"
      ? (alphaResult.finalOutput || "(no output)").slice(0, 3000)
      : `FAILED: ${alphaResult.error || "unknown"}`;

    const betaOutput = betaResult.status === "completed"
      ? (betaResult.finalOutput || "(no output)").slice(0, 3000)
      : `FAILED: ${betaResult.error || "unknown"}`;

    const prompt = buildEvaluationPrompt(alphaOutput, betaOutput, objective);

    return new Promise((resolve) => {
      const args = ["agent", "--agent", "evaluator", "--message", prompt, "--json"];
      const child = spawn("openclaw", args, {
        stdio: ["ignore", "pipe", "pipe"],
        env: { ...process.env }
      });

      let stdout = "";
      let done = false;

      const timer = setTimeout(() => {
        if (!done) {
          done = true;
          child.kill("SIGTERM");
          console.warn(`[competitive] Evaluation timed out for ${objectiveId}`);
          resolve({
            winner: "tie_timeout",
            reasoning: "Evaluation timed out.",
            alphaScore: alphaResult.status === "completed" ? 5 : 0,
            betaScore: betaResult.status === "completed" ? 5 : 0,
            timedOut: true
          });
        }
      }, this.timeoutMs);

      child.stdout.on("data", (c) => { stdout += c.toString(); });

      child.on("close", () => {
        clearTimeout(timer);
        if (done) return;
        done = true;

        const parsed = extractAndValidate(stdout);

        if (parsed) {
          resolve({
            winner: parsed.winner,
            reasoning: String(parsed.reasoning || ""),
            alphaScore: Number(parsed.alphaScore) || 0,
            betaScore: Number(parsed.betaScore) || 0
          });
          return;
        }

        console.warn("[competitive] Evaluation parse failed for", objectiveId, "- raw:", stdout.slice(0, 200));
        // Structured fallback: base decision on completion status, not arbitrary choice
        const alphaCompleted = alphaResult.status === "completed";
        const betaCompleted = betaResult.status === "completed";
        if (alphaCompleted && !betaCompleted) {
          resolve({ winner: "team-alpha", reasoning: "Beta failed; alpha completed.", alphaScore: 5, betaScore: 0 });
        } else if (betaCompleted && !alphaCompleted) {
          resolve({ winner: "team-beta", reasoning: "Alpha failed; beta completed.", alphaScore: 0, betaScore: 5 });
        } else {
          resolve({ winner: "team-alpha", reasoning: "Both completed; defaulting to alpha (parse failure).", alphaScore: 5, betaScore: 5 });
        }
      });
    });
  }

  async _implementWinner(winnerResult, objective, objectiveId) {
    const gammaObjective = `Implement the following solution for the objective below.

Original objective: ${objective}

Winning team's output (use this as the basis for implementation):
${(winnerResult.finalOutput || "").slice(0, 4000)}

Your task: Take the winning team's analysis/solution and implement it. If it involves code changes, make them in the codebase at /codebase/swarm-platform/. If it's a report or analysis, refine and finalize it.`;

    const gammaId = `${objectiveId}-gamma`;

    return this.gammaCoordinator.executeObjective({
      teamId: "team-gamma",
      objective: gammaObjective,
      objectiveId: gammaId,
      maxIterations: 2
    });
  }

  async _sendRoundSummary({ objective, objectiveId, evaluation, winnerTeam, loserTeam, alphaResult, betaResult, gammaResult, mergeInfo, lessons, feedback }) {
    const lines = [];
    lines.push(`*Round Complete: ${objectiveId}*`);
    lines.push(`Objective: _${objective.slice(0, 200)}_`);
    lines.push("");

    const alphaScore = evaluation?.alphaScore ?? "?";
    const betaScore = evaluation?.betaScore ?? "?";
    lines.push(`*Winner: ${winnerTeam}* (${alphaScore} vs ${betaScore})`);
    if (evaluation?.reasoning) {
      lines.push(`Why: ${evaluation.reasoning.slice(0, 200)}`);
    }
    lines.push("");

    const sanitize = (raw) => {
      if (!raw) return "";
      let text = raw.trim();
      // Strip openclaw JSON wrapper if present
      try {
        const obj = JSON.parse(text);
        if (obj?.result?.payloads) {
          const payload = obj.result.payloads.find(p => p?.text);
          if (payload) text = payload.text;
        }
      } catch { /* not JSON, use as-is */ }
      // Strip Ollama error wrappers
      if (text.includes("Ollama API error")) {
        const errMatch = text.match(/"error":"([^"]+)"/);
        text = errMatch ? `[Model error: ${errMatch[1]}]` : "[Model error]";
      }
      return text.trim();
    };

    const alphaOut = sanitize(alphaResult?.finalOutput);
    const betaOut = sanitize(betaResult?.finalOutput);
    if (alphaOut) lines.push(`Alpha: ${alphaOut.slice(0, 300)}${alphaOut.length > 300 ? "..." : ""}`);
    if (betaOut) lines.push(`Beta: ${betaOut.slice(0, 300)}${betaOut.length > 300 ? "..." : ""}`);

    const gammaOut = sanitize(gammaResult?.finalOutput);
    if (gammaOut) {
      lines.push("");
      lines.push(`*Implementation:* ${gammaOut.slice(0, 350)}${gammaOut.length > 350 ? "..." : ""}`);
    }

    if (mergeInfo?.changedFiles?.length > 0) {
      lines.push(`Merged ${mergeInfo.changedFiles.length} files to main.`);
    }

    const criticalLessons = lessons.filter(l => l.severity === "critical");
    const warningLessons = lessons.filter(l => l.severity === "warning");
    if (criticalLessons.length > 0 || warningLessons.length > 0) {
      lines.push("");
      lines.push(`*Lessons learned:*`);
      for (const l of criticalLessons.slice(0, 3)) {
        lines.push(`  [!] ${l.lesson.slice(0, 150)}`);
      }
      for (const l of warningLessons.slice(0, 2)) {
        lines.push(`  [~] ${l.lesson.slice(0, 150)}`);
      }
    }

    if (feedback) {
      lines.push("");
      lines.push(`*Feedback to ${loserTeam}:* ${feedback.feedbackToLoser.message.slice(0, 200)}`);
    }

    const leaderboard = this.store?.getLeaderboard?.() || [];
    const scores = leaderboard.map(r => `${r.teamName || r.teamId}: ${r.score}`).join(" | ");
    if (scores) {
      lines.push("");
      lines.push(`*Scores:* ${scores}`);
    }

    await this._notify(lines.join("\n"));
  }

  getStatus() {
    return {
      phase: this.currentPhase,
      objective: this.currentObjective
    };
  }
}
