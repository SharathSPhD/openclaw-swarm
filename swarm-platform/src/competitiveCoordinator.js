import { SwarmCoordinator } from "./coordinator.js";
import { buildEvaluationPrompt, extractAndValidate } from "./structuredEvaluator.js";
import { ObjectivePerformanceTracker } from "./objectivePerformance.js";
import { escapeMd } from "./telegramRelay.js";

import crypto from "node:crypto";

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
    this.gammaDiscoveries = []; // Store up to 20 recent gamma discoveries for Program Lead context
  }

  async _notify(text) {
    if (this.telegramBot && this.chatId) {
      // TelegramBot.sendMessage uses Markdown by default
      await this.telegramBot.sendMessage(this.chatId, text).catch(() => {});
    }
  }

  async executeCompetitiveObjective({ objective, objectiveId, category = "unknown" }) {
    const roundStartTime = Date.now();
    this.currentObjective = { objectiveId, objective, category, phase: "forking" };

    await this.emitEvent(this.createEvent({
      type: "competitive.started",
      teamId: "program-lead",
      source: "competitive-coordinator",
      payload: { objectiveId, objective }
    }));

    console.log(`[competitive] Objective started: ${objective.slice(0, 80)}...`);

    // Send round start Telegram message
    await this._sendRoundStart({ objective, objectiveId, category: this.currentObjective?.category });

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

      // Get model recommendations for both teams before dispatch
      if (this.teamLearning) {
        const alphaRecs = this.teamLearning.getModelRecommendations("team-alpha");
        const betaRecs = this.teamLearning.getModelRecommendations("team-beta");
        
        if (alphaRecs?.roleOverrides && Object.keys(alphaRecs.roleOverrides).length > 0) {
          console.log(`[competitive] Applying model recommendations for team-alpha:`, alphaRecs.roleOverrides);
          this._modelOverrides = this._modelOverrides || {};
          this._modelOverrides["team-alpha"] = alphaRecs.roleOverrides;
        }
        
        if (betaRecs?.roleOverrides && Object.keys(betaRecs.roleOverrides).length > 0) {
          console.log(`[competitive] Applying model recommendations for team-beta:`, betaRecs.roleOverrides);
          this._modelOverrides = this._modelOverrides || {};
          this._modelOverrides["team-beta"] = betaRecs.roleOverrides;
        }
      }

      const [alphaResult, betaResult] = await this._forkToTeams(objective, objectiveId);

      // Emit agent.message events for alpha and beta outputs
      if (alphaResult.finalOutput) {
        await this.emitEvent(this.createEvent({
          id: crypto.randomUUID(),
          type: "agent.message",
          teamId: "team-alpha",
          source: "alpha-coordinator",
          payload: {
            role: "coordinator",
            content: alphaResult.finalOutput.slice(0, 1000),
            taskId: `${objectiveId}-alpha`,
            objectiveId,
            phase: "competitive"
          }
        })).catch(() => {});
      }

      if (betaResult.finalOutput) {
        await this.emitEvent(this.createEvent({
          id: crypto.randomUUID(),
          type: "agent.message",
          teamId: "team-beta",
          source: "beta-coordinator",
          payload: {
            role: "coordinator",
            content: betaResult.finalOutput.slice(0, 1000),
            taskId: `${objectiveId}-beta`,
            objectiveId,
            phase: "competitive"
          }
        })).catch(() => {});
      }

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

      // Emit agent.message event for gamma output
      if (gammaResult.finalOutput) {
        await this.emitEvent(this.createEvent({
          id: crypto.randomUUID(),
          type: "agent.message",
          teamId: "team-gamma",
          source: "gamma-coordinator",
          payload: {
            role: "coordinator",
            content: gammaResult.finalOutput.slice(0, 1000),
            taskId: `${objectiveId}-gamma`,
            objectiveId,
            phase: "competitive"
          }
        })).catch(() => {});
      }

      // Gamma implements but does not earn competitive points (only logs work)

      // Phase 4: Record what Gamma actually changed
      this.currentPhase = "merging";
      this.currentObjective.phase = "merging";

      let mergeInfo = { changedFiles: [], committed: false, needsRestart: false };

      if (this.worktreeManager) {
        try {
          // Clean up the empty worktree branch first (it wasn't used)
          try { this.worktreeManager.cleanupWorktree("team-gamma"); } catch { /* ok */ }

          // Detect any actual changes Gamma wrote to the main repo
          const changeResult = this.worktreeManager.detectAndCommitMainChanges(
            objectiveId,
            objective.slice(0, 80)
          );

          const needsRestart = (changeResult.changedFiles || []).some(
            f => f.startsWith("swarm-platform/src/") || f.startsWith("swarm-platform/package")
          );

          mergeInfo = {
            changedFiles: changeResult.changedFiles || [],
            committed: changeResult.committed || false,
            needsRestart,
            error: changeResult.error || null
          };

          if (changeResult.committed) {
            // Push the changes
            this.worktreeManager.safePushToRemote();

            await this.emitEvent(this.createEvent({
              type: "competitive.merged",
              teamId: "team-gamma",
              source: "competitive-coordinator",
              payload: {
                objectiveId,
                changedFiles: mergeInfo.changedFiles,
                needsRestart: mergeInfo.needsRestart,
                committed: true
              }
            }));

            console.log(`[competitive] Gamma committed ${mergeInfo.changedFiles.length} files: ${mergeInfo.changedFiles.slice(0, 3).join(", ")}`);

            if (mergeInfo.needsRestart) {
              await this.emitEvent(this.createEvent({
                type: "competitive.restarting",
                teamId: "program-lead",
                source: "competitive-coordinator",
                payload: { objectiveId, reason: "server_code_changed", changedFiles: mergeInfo.changedFiles }
              }));

              console.log("[competitive] Server changes detected, scheduling restart via exit(42)");
              setTimeout(() => process.exit(42), 3000);
            }
          } else {
            // No file changes - emit merged with empty list (Gamma only produced analysis)
            await this.emitEvent(this.createEvent({
              type: "competitive.merged",
              teamId: "team-gamma",
              source: "competitive-coordinator",
              payload: {
                objectiveId,
                changedFiles: [],
                needsRestart: false,
                committed: false,
                note: changeResult.error || "no code changes detected"
              }
            }));
            console.log("[competitive] Gamma produced no file changes (analysis/report only)");
          }
        } catch (err) {
          console.warn("[competitive] Merge/commit failed:", err?.message);
          // Still emit merged event so implementation-log has a record
          await this.emitEvent(this.createEvent({
            type: "competitive.merged",
            teamId: "team-gamma",
            source: "competitive-coordinator",
            payload: { objectiveId, changedFiles: [], needsRestart: false, error: err?.message }
          }));
        }
      }

      // Cleanup alpha/beta worktrees
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
        mergeInfo,
        category: this.currentObjective?.category || "unknown"
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

          // Log adaptation telemetry
          if (lessons && lessons.length > 0) {
            const lessonsByTeam = {};
            for (const l of lessons) {
              if (!lessonsByTeam[l.teamId]) lessonsByTeam[l.teamId] = [];
              lessonsByTeam[l.teamId].push(`${l.category}: ${l.lesson?.slice(0, 60)}`);
            }
            console.log(`[competitive] Round adaptation: ${JSON.stringify(lessonsByTeam)}`);
          }
          if (feedback) {
            console.log(`[competitive] Cross-team feedback: winner=${feedback.winner}, loser advice length=${feedback.feedbackToLoser?.message?.length || 0}`);
          }
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
          const scoreGained = postRoundTotalScore - preRoundTotalScore;
          await this.objectivePerformanceTracker.recordObjectiveImpact({
            objectiveId,
            category,
            before: { totalScore: preRoundTotalScore },
            after: { totalScore: postRoundTotalScore },
            lessons
          });
          console.log(`[competitive] ROI tracked: category=${category}, scoreGain=${scoreGained}, lessons=${lessons?.length || 0}`);
        } catch (err) {
          console.error("[competitive] ROI tracking failed:", err?.message, err?.stack);
        }
      }

      this.currentPhase = "idle";
      this.currentObjective = { ...this.currentObjective, phase: "completed" };

      // Send ONE condensed Telegram summary for the entire round
      const elapsedMs = Date.now() - roundStartTime;
      await this._sendRoundSummary({ objective, objectiveId, evaluation, winnerTeam, loserTeam, alphaResult, betaResult, gammaResult, mergeInfo, lessons, feedback, elapsedMs });

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

    // Include recent gamma discoveries in evaluation context
    const recentDiscoveries = this.gammaDiscoveries.slice(-3)
      .map(d => `${d.ts}: ${d.discoveries.slice(0, 100)}`)
      .join("\n");
    const gammaContext = recentDiscoveries
      ? `\n\nGamma team recent discoveries (for context): ${recentDiscoveries}`
      : "";

    let prompt = buildEvaluationPrompt(alphaOutput, betaOutput, objective);
    if (gammaContext) {
      prompt += gammaContext;
    }

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
        // Structured fallback: base decision on completion status and output length
        const alphaCompleted = alphaResult.status === "completed";
        const betaCompleted = betaResult.status === "completed";
        if (alphaCompleted && !betaCompleted) {
          resolve({ winner: "team-alpha", reasoning: "Beta failed; alpha completed.", alphaScore: 5, betaScore: 0 });
        } else if (betaCompleted && !alphaCompleted) {
          resolve({ winner: "team-beta", reasoning: "Alpha failed; beta completed.", alphaScore: 0, betaScore: 5 });
        } else if (alphaCompleted && betaCompleted) {
          // Both completed; use output length as tiebreaker
          const alphaLen = (alphaResult.finalOutput || "").length;
          const betaLen = (betaResult.finalOutput || "").length;
          const lengthDiff = Math.abs(alphaLen - betaLen);
          const tenPercentAlpha = alphaLen * 0.1;
          
          if (lengthDiff > tenPercentAlpha) {
            // Significant difference: winner is team with more output
            const winner = alphaLen > betaLen ? "team-alpha" : "team-beta";
            const longer = Math.max(alphaLen, betaLen);
            const shorter = Math.min(alphaLen, betaLen);
            const pct = Math.round((longer / shorter - 1) * 100);
            resolve({
              winner,
              reasoning: `Both completed; ${winner} has ${pct}% more output (length-based tiebreaker).`,
              alphaScore: alphaLen > betaLen ? 5 : 3,
              betaScore: betaLen > alphaLen ? 5 : 3
            });
          } else {
            // Within 10% length: use objectiveId hash for consistent tie-breaking
            const hash = objectiveId.split("").reduce((a, c) => a + c.charCodeAt(0), 0);
            const winner = hash % 2 === 0 ? "team-alpha" : "team-beta";
            resolve({
              winner,
              reasoning: `Both completed with similar output length (${alphaLen} vs ${betaLen} chars); hash-based selection (parse failure).`,
              alphaScore: 4,
              betaScore: 4
            });
          }
        } else {
          // Both failed
          resolve({
            winner: "tie_timeout",
            reasoning: "Both teams failed; no winner.",
            alphaScore: 0,
            betaScore: 0
          });
        }
      });
    });
  }

  async _implementWinner(winnerResult, objective, objectiveId) {
    // Build lessons context from recent rounds
    const lessonsText = this.teamLearning?.roundHistory?.slice(-3)
      ?.flatMap(r => r.lessons || [])
      ?.filter(l => l.severity === "critical")
      ?.map(l => l.lesson)
      ?.join("\n") || "(no critical lessons yet)";

    const gammaObjective = `Implement the following solution for the objective below.

Original objective: ${objective}

Recent critical lessons from past rounds: ${lessonsText}

Winning team's output (use this as the basis for implementation):
${(winnerResult.finalOutput || "").slice(0, 4000)}

Your task:
1. IMPLEMENT: Take the winning team's analysis/solution and implement it in the codebase at /codebase/swarm-platform/. If it involves code changes, make them. If it's a report or analysis, refine and finalize it.
2. EXPLORE: After implementing, briefly scan adjacent files and modules for obvious quick wins (bugs, performance issues, security gaps, error handling gaps). Do NOT make changes beyond the implementation task.
3. REPORT: Return your response in this structure:
   IMPLEMENTATION: [what you implemented]
   DISCOVERIES: [bulleted list of issues found in adjacent code, max 5]
   RECOMMENDATIONS: [1-3 specific improvements for future rounds]`;

    const gammaId = `${objectiveId}-gamma`;

    const gammaResult = await this.gammaCoordinator.executeObjective({
      teamId: "team-gamma",
      objective: gammaObjective,
      objectiveId: gammaId,
      maxIterations: 2
    });

    // Extract discoveries and recommendations from gamma output
    if (gammaResult.finalOutput) {
      try {
        const output = gammaResult.finalOutput;
        const discoveriesMatch = output.match(/DISCOVERIES:\s*([\s\S]*?)(?=RECOMMENDATIONS:|$)/);
        const recommendationsMatch = output.match(/RECOMMENDATIONS:\s*([\s\S]*?)$/);

        if (discoveriesMatch || recommendationsMatch) {
          const entry = {
            ts: new Date().toISOString(),
            discoveries: discoveriesMatch ? discoveriesMatch[1].trim() : "",
            recommendations: recommendationsMatch ? recommendationsMatch[1].trim() : ""
          };
          this.gammaDiscoveries.push(entry);
          if (this.gammaDiscoveries.length > 20) {
            this.gammaDiscoveries.shift(); // Keep rolling 20
          }
          console.log("[gamma] Discoveries:", JSON.stringify(entry.discoveries.slice(0, 150)));
        }
      } catch (err) {
        console.warn("[gamma] Failed to parse discoveries:", err?.message);
      }
    }

    return gammaResult;
  }

  async _sendRoundStart({ objective, objectiveId, category }) {
    if (!this.telegramBot || !this.chatId) return;

    const objEscaped = escapeMd(objective.slice(0, 120));
    const objEllipsis = objective.length > 120 ? "\\.\\.\\." : "";
    const catEscaped = escapeMd(category || "general");

    const text = `🏁 *Round Starting*\n` +
      `Alpha vs Beta competing\n` +
      `Category: \`${catEscaped}\`\n` +
      `Objective: _${objEscaped}${objEllipsis}_`;

    await this.telegramBot.sendMessage(this.chatId, text, "MarkdownV2").catch(() => {});
  }

  async _sendRoundSummary({ objective, objectiveId, evaluation, winnerTeam, loserTeam, alphaResult, betaResult, gammaResult, mergeInfo, lessons, feedback, elapsedMs }) {
    if (!this.telegramBot || !this.chatId) return;

    const elapsedSec = elapsedMs ? Math.round(elapsedMs / 1000) : 0;
    const objShort = escapeMd(objective.slice(0, 120));
    const objEllipsis = objective.length > 120 ? "\\.\\.\\." : "";
    const winner = escapeMd(winnerTeam);
    const alphaScoreStr = escapeMd(String(evaluation?.alphaScore ?? "?"));
    const betaScoreStr = escapeMd(String(evaluation?.betaScore ?? "?"));
    
    const sanitize = (raw) => {
      if (!raw) return "";
      let text = raw.trim();
      try {
        const obj = JSON.parse(text);
        if (obj?.result?.payloads) {
          const payload = obj.result.payloads.find(p => p?.text);
          if (payload) text = payload.text;
        }
      } catch { /* not JSON */ }
      if (text.includes("Ollama API error")) {
        const errMatch = text.match(/"error":"([^"]+)"/);
        text = errMatch ? `[Model error: ${errMatch[1]}]` : "[Model error]";
      }
      return text.trim();
    };

    const alphaOut = sanitize(alphaResult?.finalOutput)?.slice(0, 150) || "";
    const betaOut = sanitize(betaResult?.finalOutput)?.slice(0, 150) || "";
    const gammaOut = sanitize(gammaResult?.finalOutput)?.slice(0, 200) || "";
    
    const alphaEscaped = escapeMd(alphaOut);
    const betaEscaped = escapeMd(betaOut);
    const gammaEscaped = escapeMd(gammaOut);

    const reasoningEscaped = escapeMd((evaluation?.reasoning || "").slice(0, 150));

    const lines = [];
    lines.push(`🏆 *Round Complete* · ${escapeMd(String(elapsedSec))}s`);
    lines.push(`Objective: _${objShort}${objEllipsis}_`);
    lines.push("");
    lines.push(`Winner: *${winner}* \\(α:${alphaScoreStr} vs β:${betaScoreStr}\\)`);
    if (reasoningEscaped) {
      lines.push(`Why: ${reasoningEscaped}`);
    }
    lines.push("");

    if (alphaOut) {
      lines.push(`*Alpha* proposed:`);
      lines.push(`\`${alphaEscaped}\``);
    }
    if (betaOut) {
      lines.push(`*Beta* proposed:`);
      lines.push(`\`${betaEscaped}\``);
    }

    const criticalLessons = (lessons || []).filter(l => l.severity === "critical");
    if (criticalLessons.length > 0 || gammaOut) {
      lines.push("");
    }

    if (gammaOut) {
      lines.push(`*Gamma* found:`);
      lines.push(`_${gammaEscaped}_`);
    }

    if (mergeInfo?.changedFiles?.length > 0) {
      lines.push("");
      const fileCount = escapeMd(String(mergeInfo.changedFiles.length));
      lines.push(`Changed: ${fileCount} files \\| ${escapeMd(String(elapsedSec))}s`);
    }

    const text = lines.join("\n");
    await this.telegramBot.sendMessage(this.chatId, text, "MarkdownV2").catch(() => {});
  }

  getStatus() {
    return {
      phase: this.currentPhase,
      objective: this.currentObjective
    };
  }

  getGammaInsights() {
    return this.gammaDiscoveries.slice(-3);
  }
}
