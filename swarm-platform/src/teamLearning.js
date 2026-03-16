/**
 * Team Learning System
 *
 * Tracks model/role performance across competitive rounds, stores lessons in DB,
 * and generates adaptive recommendations for model selection and prompt tuning.
 * The program lead uses this to give cross-team feedback after each round.
 */

export class TeamLearning {
  constructor({ db, store }) {
    this.db = db;
    this.store = store;
    this.lessons = new Map();
    this.roundHistory = [];
    // In-memory stores for file-based mode (max 500 and 200 entries respectively)
    this.performanceRecords = [];
    this.lessonRecords = [];
    // Category outcome tracking for objective ROI analysis
    this.categoryStats = new Map();
  }

  async init() {
    if (!this.db?.pool) return;
    try {
      await this.db.pool.query(`
        CREATE TABLE IF NOT EXISTS team_lessons (
          id SERIAL PRIMARY KEY,
          team_id TEXT NOT NULL,
          round_id TEXT NOT NULL,
          category TEXT NOT NULL,
          lesson TEXT NOT NULL,
          model TEXT,
          role TEXT,
          severity TEXT DEFAULT 'info',
          created_at TIMESTAMPTZ DEFAULT NOW()
        )
      `);
      await this.db.pool.query(`
        CREATE TABLE IF NOT EXISTS model_performance (
          id SERIAL PRIMARY KEY,
          team_id TEXT NOT NULL,
          model TEXT NOT NULL,
          role TEXT NOT NULL,
          success BOOLEAN NOT NULL,
          error_type TEXT,
          latency_ms INT,
          correctness REAL,
          output_length INT,
          round_id TEXT,
          created_at TIMESTAMPTZ DEFAULT NOW()
        )
      `);
    } catch (err) {
      console.warn("[teamLearning] Schema creation failed:", err?.message);
    }
  }

  async recordTaskOutcome({ teamId, model, role, success, errorType, latencyMs, correctness, outputLength, roundId }) {
    // Validation: handle missing or invalid fields gracefully
    if (!teamId || !role || typeof success !== "boolean") {
      console.warn("[teamLearning] recordTaskOutcome: missing required fields (teamId, role, success)");
      return;
    }

    // Always record to in-memory store (rolling window of 500 entries)
    const record = {
      teamId,
      model: model || "unknown",
      role,
      success,
      errorType: errorType || null,
      latencyMs: latencyMs || null,
      correctness: correctness || null,
      outputLength: outputLength || 0,
      roundId: roundId || null,
      createdAt: new Date().toISOString()
    };
    this.performanceRecords.push(record);
    if (this.performanceRecords.length > 500) {
      this.performanceRecords.shift(); // Keep rolling window of 500
    }

    // Also update roundHistory if we have a roundId
    if (roundId) {
      const roundEntry = this.roundHistory.find(r => r.roundId === roundId);
      if (roundEntry) {
        // We'll let analyzeRound() handle full details; just track that outcome occurred
      }
    }

    // If DB available, also persist to PostgreSQL
    if (!this.db?.pool) return;
    try {
      await this.db.pool.query(
        `INSERT INTO model_performance (team_id, model, role, success, error_type, latency_ms, correctness, output_length, round_id)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
        [teamId, model || "unknown", role, success, errorType || null, latencyMs || null, correctness || null, outputLength || 0, roundId || null]
      );
    } catch (err) {
      console.warn("[teamLearning] recordTaskOutcome (DB):", err?.message);
    }
  }

  recordCategoryOutcome(category, { scoreGained, tasksCompleted, tasksFailed, durationMs }) {
    if (!category) return; // Skip if no category provided
    
    const key = String(category);
    const existing = this.categoryStats.get(key) || {
      attempts: 0,
      totalScore: 0,
      totalDuration: 0,
      failures: 0
    };

    existing.attempts += 1;
    existing.totalScore += scoreGained || 0;
    existing.totalDuration += durationMs || 0;
    existing.failures += tasksFailed || 0;

    this.categoryStats.set(key, existing);

    // Telemetry: Log category ROI tracking
    const avgScore = existing.totalScore / existing.attempts;
    const successRate = ((existing.attempts - existing.failures) / existing.attempts * 100);
    console.log(`[teamLearning] Category ROI: ${category} score_gain=${scoreGained || 0} avg_score=${avgScore.toFixed(2)} total_rounds=${existing.attempts} success_rate=${successRate.toFixed(1)}%`);
  }

  getTopCategories(limit = 3) {
    const categories = [];
    
    for (const [category, stats] of this.categoryStats.entries()) {
      if (stats.attempts === 0) continue;
      
      const avgScore = stats.totalScore / stats.attempts;
      const successRate = stats.attempts > 0 ? ((stats.attempts - stats.failures) / stats.attempts) : 0;
      
      categories.push({
        category,
        avgScore: Number(avgScore.toFixed(2)),
        attempts: stats.attempts,
        successRate: Number((successRate * 100).toFixed(1))
      });
    }

    // Sort by average score gained (descending)
    categories.sort((a, b) => b.avgScore - a.avgScore);
    return categories.slice(0, limit);
  }

  async recordLesson({ teamId, roundId, category, lesson, model, role, severity }) {
    // Always record to in-memory store (rolling window of 200 entries)
    const record = {
      teamId,
      roundId,
      category,
      lesson,
      model: model || null,
      role: role || null,
      severity: severity || "info",
      createdAt: new Date().toISOString()
    };
    this.lessonRecords.push(record);
    if (this.lessonRecords.length > 200) {
      this.lessonRecords.shift(); // Keep rolling window of 200
    }

    // If DB available, also persist to PostgreSQL
    if (this.db?.pool) {
      try {
        await this.db.pool.query(
          `INSERT INTO team_lessons (team_id, round_id, category, lesson, model, role, severity)
           VALUES ($1, $2, $3, $4, $5, $6, $7)`,
          [teamId, roundId, category, lesson, model || null, role || null, severity || "info"]
        );
      } catch (err) {
        console.warn("[teamLearning] recordLesson (DB):", err?.message);
      }
    }
  }

  _detectOutputErrors(outputText) {
    if (!outputText) return [];
    const errors = [];
    const text = String(outputText);

    const patterns = [
      { regex: /does not support tools/i, category: "tool_incompatibility", severity: "critical",
        message: (m) => "Model does not support tool calling. Switch to a tool-capable model or disable tools." },
      { regex: /Ollama API error (\d+)/i, category: "api_error", severity: "critical",
        message: (m) => `Ollama API returned error ${m[1]}. Check model compatibility and configuration.` },
      { regex: /OOM|out of memory|CUDA out of memory/i, category: "oom", severity: "critical",
        message: () => "Out of memory error. Use a smaller model or reduce context size." },
      { regex: /context length exceeded|maximum context length/i, category: "context_overflow", severity: "warning",
        message: () => "Context length exceeded. Reduce prompt size or use a model with larger context window." },
      { regex: /rate limit|429/i, category: "rate_limit", severity: "warning",
        message: () => "Rate limited by model provider. Add backoff or reduce concurrent requests." },
      { regex: /connection refused|ECONNREFUSED/i, category: "infrastructure", severity: "critical",
        message: () => "Connection refused to model server. Check if Ollama/gateway is running." },
      { regex: /timeout|ETIMEDOUT/i, category: "timeout", severity: "warning",
        message: () => "Request timed out. Model may be overloaded or prompt too complex." },
    ];

    for (const p of patterns) {
      const match = text.match(p.regex);
      if (match) {
        errors.push({ category: p.category, severity: p.severity, message: p.message(match) });
      }
    }
    return errors;
  }

  async analyzeRound(roundResult) {
    const { objectiveId, alphaResult, betaResult, evaluation, gammaResult } = roundResult;
    const lessons = [];

    for (const [teamId, result] of [["team-alpha", alphaResult], ["team-beta", betaResult]]) {
      if (!result) continue;
      const allEvents = this.store.getEvents(1000);
      const events = allEvents.filter(
        e => e.teamId === teamId && (
          (e.payload?.objectiveId || "").includes(objectiveId) ||
          (e.payload?.taskId || "").includes(objectiveId) ||
          (e.payload?.runId || "").includes(objectiveId)
        )
      );

      const failures = events.filter(e => e.type === "task.failed");
      const completions = events.filter(e => e.type === "task.completed");
      const timeouts = events.filter(e => e.type === "task.timeout" || (e.type === "task.failed" && (e.payload?.reason === "runner_timeout" || (e.payload?.error || "").includes("timeout"))));
      const oomErrors = failures.filter(e => {
        const errText = (e.payload?.error || "") + " " + (e.payload?.reason || "") + " " + (e.payload?.output || "");
        return /oom|out.?of.?memory|cuda/i.test(errText);
      });
      const penalties = events.filter(e => e.type === "penalty.applied");
      const rewards = events.filter(e => e.type === "reward.applied");

      for (const f of failures) {
        const errType = f.payload?.error || "unknown";
        const model = f.payload?.model || "unknown";
        const role = f.payload?.role || "unknown";

        await this.recordTaskOutcome({
          teamId, model, role, success: false, errorType: errType,
          latencyMs: f.payload?.durationMs, roundId: objectiveId
        });

        if (/oom|out.?of.?memory/i.test(errType)) {
          const lesson = `Model ${model} caused OOM in role ${role}. Avoid this model for this role or reduce context size.`;
          lessons.push({ teamId, category: "model_failure", lesson, model, role, severity: "critical" });
          await this.recordLesson({ teamId, roundId: objectiveId, category: "model_failure", lesson, model, role, severity: "critical" });
        } else if (/timeout/i.test(errType) || errType === "runner_timeout") {
          const lesson = `Model ${model} timed out in role ${role}. Consider a faster model or simpler prompts.`;
          lessons.push({ teamId, category: "timeout", lesson, model, role, severity: "warning" });
          await this.recordLesson({ teamId, roundId: objectiveId, category: "timeout", lesson, model, role, severity: "warning" });
        } else if (errType === "gateway_unreachable") {
          const lesson = `Gateway was unreachable during ${role} task. Check OpenClaw gateway health.`;
          lessons.push({ teamId, category: "infrastructure", lesson, severity: "critical" });
          await this.recordLesson({ teamId, roundId: objectiveId, category: "infrastructure", lesson, severity: "critical" });
        }
      }

      for (const c of completions) {
        const model = c.payload?.model || "unknown";
        const role = c.payload?.role || "unknown";
        const correctness = c.payload?.correctness || 0;
        const outputLen = (c.payload?.output || "").length;
        const toolCalls = c.payload?.toolCalls || [];

        await this.recordTaskOutcome({
          teamId, model, role, success: true,
          latencyMs: c.payload?.durationMs, correctness,
          outputLength: outputLen, roundId: objectiveId
        });

        if (toolCalls.length === 0 && role === "build") {
          const lesson = `Model ${model} did not use any tools for build role. May lack tool-calling capability. Consider switching to qwen2.5-coder or deepseek-coder.`;
          lessons.push({ teamId, category: "tool_capability", lesson, model, role, severity: "warning" });
          await this.recordLesson({ teamId, roundId: objectiveId, category: "tool_capability", lesson, model, role, severity: "warning" });
        }

        if (correctness < 0.6) {
          const lesson = `Low quality output (${(correctness * 100).toFixed(0)}%) from ${model} in ${role}. Consider a higher-tier model.`;
          lessons.push({ teamId, category: "quality", lesson, model, role, severity: "warning" });
          await this.recordLesson({ teamId, roundId: objectiveId, category: "quality", lesson, model, role, severity: "warning" });
        }
      }

      // Scan finalOutput for known error patterns (catches errors that bypass structured event reporting)
      const outputErrors = this._detectOutputErrors(result.finalOutput);
      for (const err of outputErrors) {
        const lesson = `[Output scan] ${err.message}`;
        lessons.push({ teamId, category: err.category, lesson, severity: err.severity });
        await this.recordLesson({ teamId, roundId: objectiveId, category: err.category, lesson, severity: err.severity });
      }

      if (result.status === "failed") {
        const lesson = `Team failed to complete the objective. ${failures.length} task failures, ${timeouts.length} timeouts, ${oomErrors.length} OOM errors.`;
        lessons.push({ teamId, category: "round_failure", lesson, severity: "critical" });
        await this.recordLesson({ teamId, roundId: objectiveId, category: "round_failure", lesson, severity: "critical" });
      }

      const totalPenalties = penalties.reduce((sum, e) => sum + (e.payload?.pointsDeducted || 0), 0);
      const totalRewards = rewards.reduce((sum, e) => sum + (e.payload?.pointsAdded || 0), 0);
      const summaryLesson = `Round summary: ${completions.length} tasks completed, ${failures.length} failed, ${timeouts.length} timed out, ${outputErrors.length} output errors detected. Net points: +${totalRewards} -${totalPenalties}.`;
      lessons.push({ teamId, category: "round_summary", lesson: summaryLesson, severity: "info" });
      await this.recordLesson({ teamId, roundId: objectiveId, category: "round_summary", lesson: summaryLesson, severity: "info" });
    }

    // Scan gamma output for errors too
    if (gammaResult?.finalOutput) {
      const gammaErrors = this._detectOutputErrors(gammaResult.finalOutput);
      for (const err of gammaErrors) {
        const lesson = `[Gamma output scan] ${err.message}`;
        lessons.push({ teamId: "team-gamma", category: err.category, lesson, severity: err.severity });
        await this.recordLesson({ teamId: "team-gamma", roundId: objectiveId, category: err.category, lesson, severity: err.severity });
      }
    }

    if (evaluation) {
      const winner = evaluation.winner;
      const lesson = `${winner} won this round (Alpha: ${evaluation.alphaScore}/10, Beta: ${evaluation.betaScore}/10). Reasoning: ${(evaluation.reasoning || "").slice(0, 300)}.`;
      lessons.push({ teamId: "program-lead", category: "evaluation", lesson, severity: "info" });
      await this.recordLesson({ teamId: "program-lead", roundId: objectiveId, category: "evaluation", lesson, severity: "info" });
    }

    // Record category outcome for ROI tracking
    const category = roundResult?.category || "unknown";
    const totalScore = (alphaResult?.score || 0) + (betaResult?.score || 0);
    const tasksCompleted = (alphaResult?.tasksCompleted || 0) + (betaResult?.tasksCompleted || 0);
    const tasksFailed = (alphaResult?.tasksFailed || 0) + (betaResult?.tasksFailed || 0);
    const totalDuration = Math.max((alphaResult?.durationMs || 0), (betaResult?.durationMs || 0));
    
    this.recordCategoryOutcome(category, {
      scoreGained: totalScore,
      tasksCompleted,
      tasksFailed,
      durationMs: totalDuration
    });

    // Telemetry: Log round analysis summary
    const uniqueCategories = [...new Set(lessons.map(l => l.category))];
    console.log(`[teamLearning] Round ${objectiveId}: winner=${evaluation?.winner || 'unknown'}, lessons=${lessons.length}, categories=${uniqueCategories.join(',')}`);

    this.roundHistory.push({ roundId: objectiveId, lessons, ts: new Date().toISOString() });
    return lessons;
  }

  async getModelRecommendations(teamId) {
    // In file-based mode, compute from in-memory performanceRecords
    // Data flow: recordTaskOutcome() → performanceRecords (rolling 500-entry window) →
    // getModelRecommendations() analyzes recent 24h records → returns avoid/prefer/overrides
    // This works in file-based mode (no PostgreSQL) because performanceRecords persists
    // across analyzeRound() calls within the same session.
    if (!this.db?.pool) {
      const avoidModels = [];
      const preferModels = [];
      const roleOverrides = {};

      // Filter records for this team and recent (24 hours)
      const cutoff = new Date(Date.now() - 24 * 60 * 60 * 1000);
      const recentRecords = this.performanceRecords.filter(
        r => r.teamId === teamId && new Date(r.createdAt) > cutoff
      );

      // Group by (model, role)
      const stats = new Map();
      for (const record of recentRecords) {
        const key = `${record.model}:${record.role}`;
        const stat = stats.get(key) || {
          model: record.model,
          role: record.role,
          total: 0,
          successes: 0,
          failures: 0,
          latencies: [],
          correctnesses: []
        };
        stat.total += 1;
        if (record.success) {
          stat.successes += 1;
          if (record.latencyMs) stat.latencies.push(record.latencyMs);
          if (record.correctness !== null) stat.correctnesses.push(record.correctness);
        } else {
          stat.failures += 1;
        }
        stats.set(key, stat);
      }

      // Analyze and build recommendations
      for (const stat of stats.values()) {
        const failRate = stat.total > 0 ? stat.failures / stat.total : 0;

        if (failRate > 0.5 && stat.total >= 2) {
          avoidModels.push({
            model: stat.model,
            role: stat.role,
            failRate: Number(failRate.toFixed(2)),
            reason: `${stat.failures}/${stat.total} failures`
          });
        }

        const avgCorrectness = stat.correctnesses.length > 0
          ? stat.correctnesses.reduce((a, b) => a + b, 0) / stat.correctnesses.length
          : 0;
        const avgLatency = stat.latencies.length > 0
          ? stat.latencies.reduce((a, b) => a + b, 0) / stat.latencies.length
          : 0;

        if (failRate === 0 && stat.total >= 2 && avgCorrectness > 0.8) {
          preferModels.push({
            model: stat.model,
            role: stat.role,
            avgCorrectness: Number(avgCorrectness.toFixed(2)),
            avgLatency: Math.round(avgLatency)
          });
        }
      }

      // Build role overrides
      for (const avoid of avoidModels) {
        const better = preferModels.find(p => p.role === avoid.role);
        if (better) {
          roleOverrides[avoid.role] = {
            avoid: avoid.model,
            prefer: better.model,
            reason: `${avoid.model} has ${avoid.reason}; ${better.model} has ${(better.avgCorrectness * 100).toFixed(0)}% correctness`
          };
        }
      }

      // Telemetry: Log model recommendations
      if (avoidModels.length > 0 || preferModels.length > 0) {
        const avoidStr = avoidModels.map(a => `${a.model}(${a.role})`).join(',');
        const preferStr = preferModels.map(p => `${p.model}(${p.role})`).join(',');
        console.log(`[teamLearning] Recommendations for ${teamId}: avoid=[${avoidStr}], prefer=[${preferStr}]`);
      }

      return { avoidModels, preferModels, roleOverrides };
    }

    // PostgreSQL mode
    try {
      const perf = await this.db.pool.query(
        `SELECT model, role, 
                COUNT(*) as total,
                COUNT(*) FILTER (WHERE success) as successes,
                COUNT(*) FILTER (WHERE NOT success) as failures,
                AVG(latency_ms) FILTER (WHERE success) as avg_latency,
                AVG(correctness) FILTER (WHERE success) as avg_correctness
         FROM model_performance 
         WHERE team_id = $1 AND created_at > NOW() - INTERVAL '24 hours'
         GROUP BY model, role
         ORDER BY failures DESC, avg_latency DESC`,
        [teamId]
      );

      const avoidModels = [];
      const preferModels = [];
      const roleOverrides = {};

      for (const row of perf.rows) {
        const failRate = row.total > 0 ? row.failures / row.total : 0;

        if (failRate > 0.5 && row.total >= 2) {
          avoidModels.push({ model: row.model, role: row.role, failRate: Number(failRate.toFixed(2)), reason: `${row.failures}/${row.total} failures` });
        }

        if (failRate === 0 && row.total >= 2 && (row.avg_correctness || 0) > 0.8) {
          preferModels.push({ model: row.model, role: row.role, avgCorrectness: Number((row.avg_correctness || 0).toFixed(2)), avgLatency: Math.round(row.avg_latency || 0) });
        }
      }

      for (const avoid of avoidModels) {
        const better = preferModels.find(p => p.role === avoid.role);
        if (better) {
          roleOverrides[avoid.role] = {
            avoid: avoid.model,
            prefer: better.model,
            reason: `${avoid.model} has ${avoid.reason}; ${better.model} has ${(better.avgCorrectness * 100).toFixed(0)}% correctness`
          };
        }
      }

      return { avoidModels, preferModels, roleOverrides };
    } catch (err) {
      console.warn("[teamLearning] getModelRecommendations:", err?.message);
      return { avoidModels: [], preferModels: [], roleOverrides: {} };
    }
  }

  async getRecentLessons(teamId, limit = 20) {
    // In file-based mode, return from in-memory store
    if (!this.db?.pool) {
      return this.lessonRecords
        .filter(l => l.teamId === teamId)
        .slice(-limit)
        .reverse(); // Most recent first
    }

    // PostgreSQL mode
    try {
      const res = await this.db.pool.query(
        `SELECT * FROM team_lessons WHERE team_id = $1 ORDER BY created_at DESC LIMIT $2`,
        [teamId, limit]
      );
      return res.rows;
    } catch {
      return [];
    }
  }

  async generateCrossTeamFeedback(roundResult) {
    const { winner, evaluation, alphaResult, betaResult, objectiveId } = roundResult;
    if (!evaluation || !roundResult) return null;
    if (!winner && !evaluation.winner) return null; // Guard against missing winner

    const winnerTeam = winner || evaluation.winner;
    const loserTeam = winnerTeam === "team-alpha" ? "team-beta" : "team-alpha";

    const winnerRec = await this.getModelRecommendations(winnerTeam);
    const loserRec = await this.getModelRecommendations(loserTeam);

    const winnerOutput = (winnerTeam === "team-alpha" ? alphaResult : betaResult)?.finalOutput || "";
    const loserOutput = (loserTeam === "team-alpha" ? alphaResult : betaResult)?.finalOutput || "";

    return {
      roundId: objectiveId,
      winner: winnerTeam,
      loser: loserTeam,
      evaluation: {
        reasoning: evaluation.reasoning,
        alphaScore: evaluation.alphaScore,
        betaScore: evaluation.betaScore
      },
      feedbackToLoser: {
        message: `The winning team (${winnerTeam}) scored higher because: ${evaluation.reasoning}. ` +
          `Their output was ${winnerOutput.length} chars vs your ${loserOutput.length} chars. ` +
          `Consider: ${loserRec.avoidModels.length > 0 ? `avoiding models: ${loserRec.avoidModels.map(a => `${a.model}(${a.role})`).join(", ")}` : "reviewing your model selection"}.`,
        modelAdvice: loserRec.roleOverrides
      },
      feedbackToWinner: {
        message: `Good work! You won this round. Score: ${winnerTeam === "team-alpha" ? evaluation.alphaScore : evaluation.betaScore}/10. ` +
          `Continue with your current approach. ${winnerRec.preferModels.length > 0 ? `Your best models: ${winnerRec.preferModels.map(p => `${p.model}(${p.role})`).join(", ")}` : ""}`,
        modelAdvice: winnerRec.roleOverrides
      }
    };
  }

  getAdaptiveModelChoice(teamId, role, defaultModel, routing) {
    const key = `${teamId}:${role}`;
    const history = this.roundHistory.slice(-5);

    const oomModels = new Set();
    const timeoutModels = new Set();

    for (const round of history) {
      for (const lesson of round.lessons) {
        if (lesson.teamId !== teamId) continue;
        if (lesson.role !== role) continue;
        if (lesson.category === "model_failure" && lesson.model) oomModels.add(lesson.model);
        if (lesson.category === "timeout" && lesson.model) timeoutModels.add(lesson.model);
      }
    }

    if (oomModels.has(defaultModel) || timeoutModels.has(defaultModel)) {
      const route = routing?.roleRoutes?.[role];
      if (route?.fallback) {
        const safe = route.fallback.find(m => !oomModels.has(m) && !timeoutModels.has(m));
        if (safe) return { model: safe, reason: `Avoiding ${defaultModel} (${oomModels.has(defaultModel) ? "OOM" : "timeout"}). Using fallback.` };
      }
    }

    return { model: defaultModel, reason: "default" };
  }

  async getGlobalLessons(categoryFilter = null, windowDays = 7) {
    if (!this.db?.pool) {
      // File-based mode: aggregate from in-memory roundHistory
      const cutoff = new Date(Date.now() - windowDays * 24 * 60 * 60 * 1000).toISOString();
      const allLessons = this.roundHistory
        .filter(r => r.ts >= cutoff)
        .flatMap(r => r.lessons ?? []);
      const filtered = categoryFilter ? allLessons.filter(l => l.category === categoryFilter) : allLessons;

      // Count occurrences per (category, lesson) pair
      const counts = new Map();
      for (const l of filtered) {
        const key = `${l.category}:${l.lesson}`;
        counts.set(key, { ...(counts.get(key) || { ...l, count: 0 }), count: (counts.get(key)?.count || 0) + 1 });
      }
      return [...counts.values()].sort((a, b) => b.count - a.count).slice(0, 20);
    }

    try {
      const params = categoryFilter ? [categoryFilter] : [];
      const whereClause = categoryFilter ? "WHERE category = $1" : "";
      const windowFilter = categoryFilter
        ? `AND created_at > NOW() - INTERVAL '${Math.floor(windowDays)} days'`
        : `WHERE created_at > NOW() - INTERVAL '${Math.floor(windowDays)} days'`;
      const res = await this.db.pool.query(
        `SELECT category, lesson, severity, COUNT(*) as count
         FROM team_lessons
         ${categoryFilter ? `WHERE category = $1 AND created_at > NOW() - INTERVAL '${Math.floor(windowDays)} days'` : `WHERE created_at > NOW() - INTERVAL '${Math.floor(windowDays)} days'`}
         GROUP BY category, lesson, severity
         ORDER BY count DESC
         LIMIT 20`,
        params
      );
      return res.rows;
    } catch (err) {
      console.warn("[teamLearning] getGlobalLessons:", err?.message);
      return [];
    }
  }

  async getSuggestedObjective(stats) {
    // Find categories with the highest rate of critical lessons — these need attention
    const lessons = await this.getGlobalLessons(null, 3);
    const criticalByCategory = {};
    for (const l of lessons) {
      if (l.severity === "critical") {
        criticalByCategory[l.category] = (criticalByCategory[l.category] || 0) + (l.count || 1);
      }
    }

    if (Object.keys(criticalByCategory).length === 0) return null;

    // Map lesson categories to objective categories
    const categoryMap = {
      model_failure: "system_health",
      oom: "system_health",
      timeout: "performance",
      tool_capability: "coverage",
      quality: "quality",
      infrastructure: "resilience",
      round_failure: "coverage"
    };

    let topCategory = null;
    let topCount = 0;
    for (const [cat, count] of Object.entries(criticalByCategory)) {
      if (count > topCount) {
        topCount = count;
        topCategory = categoryMap[cat] || cat;
      }
    }

    return topCategory;
  }
}
