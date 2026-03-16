import { spawn } from "node:child_process";
import { buildToolContext, buildToolAwarePrompt } from "./toolContextBuilder.js";

const VALID_ROLES = new Set(["research", "build", "critic", "integrator"]);
const MIN_SUBTASKS = 2;
const MAX_SUBTASKS = 8;
const COORDINATOR_TIMEOUT_MS = 300000;

/**
 * Run a coordinator prompt via openclaw agent CLI.
 */
async function runCoordinatorPrompt({ prompt, modelName, timeoutMs = COORDINATOR_TIMEOUT_MS }) {
  return new Promise((resolve) => {
    const args = ["agent", "--agent", "coordinator", "--message", prompt, "--json"];
    const child = spawn("openclaw", args, {
      stdio: ["ignore", "pipe", "pipe"],
      env: { ...process.env }
    });

    let stdout = "";
    let stderr = "";
    let done = false;

    const timer = setTimeout(() => {
      if (!done) {
        done = true;
        child.kill("SIGTERM");
        setTimeout(() => { if (child.exitCode === null) child.kill("SIGKILL"); }, 5000);
        resolve({ ok: false, stdout, stderr: "timeout", code: -1 });
      }
    }, timeoutMs);

    child.stdout.on("data", (c) => { stdout += c.toString(); });
    child.stderr.on("data", (c) => { stderr += c.toString(); });

    child.on("close", (code) => {
      clearTimeout(timer);
      if (done) return;
      done = true;

      let text = stdout;
      try {
        const lines = stdout.split("\n").filter(Boolean);
        for (const line of lines) {
          try {
            const obj = JSON.parse(line);
            const payloads = obj?.result?.payloads ?? obj?.payloads ?? [];
            for (const p of payloads) {
              if (p?.type === "text" && p?.text) { text = p.text; break; }
            }
            if (obj?.result?.text) { text = obj.result.text; break; }
            if (obj?.text) { text = obj.text; break; }
          } catch { /* skip */ }
        }
      } catch { /* use raw stdout */ }

      if (code === 0) {
        resolve({ ok: true, stdout: text, stderr, code: 0 });
      } else {
        resolve({ ok: false, stdout: text, stderr, code });
      }
    });
  });
}

function extractJson(text) {
  const trimmed = (text || "").trim();
  if (!trimmed) return null;

  const fenceMatch = trimmed.match(/```(?:json)?\s*\n?([\s\S]*?)\n?```/);
  const jsonStr = fenceMatch ? fenceMatch[1].trim() : trimmed;

  try {
    return JSON.parse(jsonStr);
  } catch {
    const lines = jsonStr.split("\n").filter((l) => l.trim());
    for (const line of lines) {
      try {
        const obj = JSON.parse(line);
        if (obj && typeof obj === "object") return obj;
      } catch { /* skip */ }
    }
    return null;
  }
}

function topologicalSort(subTasks) {
  const byId = new Map(subTasks.map((t) => [t.id, t]));
  const inDegree = new Map();
  for (const t of subTasks) {
    inDegree.set(t.id, 0);
  }
  for (const t of subTasks) {
    for (const dep of t.dependsOn || []) {
      if (byId.has(dep)) inDegree.set(t.id, (inDegree.get(t.id) || 0) + 1);
    }
  }
  const waves = [];
  const remaining = new Set(subTasks.map((t) => t.id));
  while (remaining.size > 0) {
    const wave = [];
    for (const id of remaining) {
      if (inDegree.get(id) === 0) wave.push(id);
    }
    if (wave.length === 0) break;
    waves.push(wave);
    for (const id of wave) {
      remaining.delete(id);
      for (const t of subTasks) {
        if ((t.dependsOn || []).includes(id)) {
          inDegree.set(t.id, Math.max(0, (inDegree.get(t.id) || 0) - 1));
        }
      }
    }
  }
  return waves;
}

function hasCircularDeps(subTasks) {
  const byId = new Map(subTasks.map((t) => [t.id, t]));
  const visited = new Set();
  const recStack = new Set();
  function visit(id) {
    visited.add(id);
    recStack.add(id);
    const t = byId.get(id);
    for (const dep of t?.dependsOn || []) {
      if (!visited.has(dep)) { if (visit(dep)) return true; }
      else if (recStack.has(dep)) return true;
    }
    recStack.delete(id);
    return false;
  }
  for (const t of subTasks) {
    if (!visited.has(t.id) && visit(t.id)) return true;
  }
  return false;
}

function validateSubTasks(raw) {
  if (!Array.isArray(raw)) return raw;
  const subTasks = raw
    .filter((t) => t && typeof t === "object" && t.id && t.role && t.description)
    .map((t) => ({
      id: String(t.id).trim(),
      role: String(t.role).toLowerCase(),
      description: String(t.description || "").trim(),
      dependsOn: Array.isArray(t.dependsOn) ? t.dependsOn.map(String) : [],
      priority: Math.min(5, Math.max(1, Number(t.priority) || 1))
    }))
    .filter((t) => t.description.length > 0 && VALID_ROLES.has(t.role));

  if (subTasks.length < MIN_SUBTASKS || subTasks.length > MAX_SUBTASKS) return null;
  if (hasCircularDeps(subTasks)) return null;
  return subTasks;
}

export class SwarmCoordinator {
  constructor({ runTask, emitEvent, createEvent, store, db, modelName = "qwen2.5:14b", chooseModelForRole, timeoutMs = 300000, explorationEngine, teamLearning }) {
    this.runTask = runTask;
    this.emitEvent = emitEvent;
    this.createEvent = createEvent;
    this.store = store;
    this.db = db;
    this.modelName = modelName;
    this.chooseModelForRole = chooseModelForRole || (() => ({ selectedModel: "qwen2.5:7b" }));
    this.timeoutMs = timeoutMs;
    this.explorationEngine = explorationEngine || null;
    this.teamLearning = teamLearning || null;
  }

  async decompose(objective) {
    const prompt = `You are a coordinator agent for a multi-agent AI swarm. Given the following objective, decompose it into 3-6 sub-tasks. Each sub-task should be assigned to a specialist role.

Available roles:
- research: Information gathering, web search, fact-finding
- build: Code implementation, writing, creating artifacts
- critic: Review, validation, testing, security analysis
- integrator: Combining results, final synthesis, delivery

Output ONLY a JSON array of sub-tasks (no other text):
[
  {
    "id": "sub-1",
    "role": "research",
    "description": "Detailed description of what this sub-task should accomplish",
    "dependsOn": [],
    "priority": 1
  }
]

Rules:
- 3 to 6 sub-tasks
- research tasks should come first (no dependencies)
- build tasks depend on research
- critic tasks depend on build
- integrator tasks depend on everything else
- Each description should be specific and actionable

Objective: ${objective}`;

    const result = await runCoordinatorPrompt({
      prompt,
      modelName: this.modelName,
      timeoutMs: this.timeoutMs
    });

    if (!result.ok) {
      throw new Error(`Decomposition failed: ${result.stderr || "unknown"}`);
    }

    let parsed = extractJson(result.stdout);
    let subTasks = Array.isArray(parsed)
      ? validateSubTasks(parsed)
      : validateSubTasks(parsed?.sub_tasks ?? parsed?.subTasks ?? parsed?.tasks ?? []);

    if (!subTasks) {
      subTasks = this._fallbackDecomposition(objective);
    }
    return subTasks;
  }

  _fallbackDecomposition(objective) {
    return [
      { id: "sub-1", role: "research", description: `Research and gather information about: ${objective}`, dependsOn: [], priority: 1 },
      { id: "sub-2", role: "build", description: `Create an implementation or detailed analysis based on the research for: ${objective}`, dependsOn: ["sub-1"], priority: 2 },
      { id: "sub-3", role: "critic", description: `Review and validate the work product for quality and completeness regarding: ${objective}`, dependsOn: ["sub-2"], priority: 2 },
      { id: "sub-4", role: "integrator", description: `Synthesize all outputs into a final deliverable for: ${objective}`, dependsOn: ["sub-3"], priority: 3 }
    ];
  }

  async executeDAG(teamId, subTasks, objectiveId, subTaskResults, { feedback = "", mode = "real", modelOverrides = null } = {}) {
    const waves = topologicalSort(subTasks);
    const byId = new Map(subTasks.map((t) => [t.id, t]));
    const timeoutMs = this.timeoutMs;

    for (let waveIndex = 0; waveIndex < waves.length; waveIndex += 1) {
      const wave = waves[waveIndex];
      await this.emitEvent(
        this.createEvent({
          type: "swarm.session.dispatching",
          teamId,
          source: "coordinator",
          payload: { objectiveId, wave: waveIndex + 1, subTaskIds: wave }
        })
      );

      const feedbackPrefix = waveIndex === 0 && feedback ? `Critic feedback from previous iteration:\n${feedback.slice(0, 1500)}\n\n` : "";

      const waveResults = await Promise.all(
        wave.map((taskId) => {
          const subTask = byId.get(taskId);
          if (!subTask) return Promise.resolve({ taskId, ok: false, output: null, error: "unknown_task" });

          const depOutputs = (subTask.dependsOn || [])
            .map((depId) => subTaskResults.get(depId))
            .filter(Boolean);
          const MAX_DEP_CONTEXT = 3000; // prevent context overflow on small-context models
          const dependencyContext = depOutputs
            .map((r) => (typeof r === "string" ? r : r?.output ?? r?.text ?? ""))
            .filter(Boolean)
            .join("\n\n---\n\n")
            .slice(0, MAX_DEP_CONTEXT);

          const baseTask = dependencyContext
            ? `Context from prior tasks:\n${dependencyContext}\n\nYour task: ${subTask.description}`
            : subTask.description;
          let taskPrompt = feedbackPrefix + baseTask;
          // Always inject tool context for agent roles
          const toolContext = buildToolContext(this.explorationEngine, subTask.role);
          if (toolContext) {
            taskPrompt = buildToolAwarePrompt({ role: subTask.role, taskText: feedbackPrefix + baseTask, toolContext, codebaseHint: "" });
          }

          const chosen = this.chooseModelForRole({ role: subTask.role, modelTier: "standard", teamId });
          const baseModel = chosen?.selectedModel || "qwen2.5:7b";
          const roleOverride = modelOverrides?.[subTask.role];
          const model = roleOverride?.prefer || baseModel;
          if (roleOverride?.prefer && roleOverride.prefer !== baseModel) {
            console.log(`[coordinator] Learning override ${teamId}/${subTask.role}: ${baseModel} → ${model} (${roleOverride.reason})`);
          }

          // Emit message event before dispatching to agent
          this.emitEvent(this.createEvent({
            type: "agent.message",
            teamId,
            source: "coordinator",
            payload: {
              objectiveId,
              direction: "to_agent",
              fromRole: "coordinator",
              toRole: subTask.role,
              subTaskId: subTask.id,
              message: taskPrompt.slice(0, 500),
              model,
              wave: waveIndex + 1
            }
          })).catch(() => {});

          return new Promise((resolve) => {
            this.runTask({
              teamId,
              role: subTask.role,
              taskId: `${objectiveId}-${subTask.id}`,
              taskText: taskPrompt,
              modelName: model,
              timeoutMs,
              mode,
              onEvent: async (event) => {
                await this.emitEvent({ ...event, source: event.source || "runner" });
                if (event.type === "task.completed") {
                  this.teamLearning?.recordTaskOutcome({
                    teamId, model: event.payload?.model || model, role: subTask.role,
                    success: true, latencyMs: event.payload?.durationMs,
                    correctness: event.payload?.correctness,
                    outputLength: (event.payload?.output || "").length,
                    roundId: objectiveId
                  });
                  // Emit agent.message for the response
                  this.emitEvent(this.createEvent({
                    type: "agent.message",
                    teamId,
                    source: subTask.role,
                    payload: {
                      objectiveId,
                      direction: "from_agent",
                      fromRole: subTask.role,
                      toRole: "coordinator",
                      subTaskId: subTask.id,
                      message: (event.payload?.output || "").slice(0, 500),
                      model: event.payload?.model || model,
                      durationMs: event.payload?.durationMs || null
                    }
                  })).catch(() => {});
                  resolve({ taskId: subTask.id, ok: true, output: event.payload?.output || null, error: null });
                } else if (event.type === "task.failed") {
                  this.teamLearning?.recordTaskOutcome({
                    teamId, model: event.payload?.model || model, role: subTask.role,
                    success: false, errorType: event.payload?.error,
                    latencyMs: event.payload?.durationMs, roundId: objectiveId
                  });
                  resolve({ taskId: subTask.id, ok: false, output: null, error: event.payload?.error || null });
                }
              }
            });
          });
        })
      );

      for (const r of waveResults) {
        if (r) {
          subTaskResults.set(r.taskId, r.ok ? r.output : { error: r.error, output: null });

          // Emit agent.handoff event after each task completes
          const subTask = byId.get(r.taskId);
          if (subTask && r.ok) {
            const nextWaveIndex = waveIndex + 1;
            const nextWave = waves[nextWaveIndex] || [];
            const toRole = nextWave.length > 0
              ? byId.get(nextWave[0])?.role || "pending"
              : "integrator";

            await this.emitEvent(this.createEvent({
              type: "agent.handoff",
              teamId,
              source: "coordinator",
              payload: {
                objectiveId,
                fromRole: subTask.role,
                toRole,
                subTaskId: subTask.id,
                status: "completed",
                outputPreview: (r.output || "").slice(0, 200),
                durationMs: null
              }
            }));
          }
        }
      }
    }

    return subTaskResults;
  }

  async criticReview(teamId, objectiveId, subTaskResults, objective) {
    const outputsText = [...subTaskResults.entries()]
      .map(([id, out]) => {
        const val = typeof out === "string" ? out : out?.output ?? out?.text ?? "";
        const err = typeof out === "object" && out?.error ? ` (FAILED: ${out.error})` : "";
        return `[${id}]: ${(val || err || "(no output)").slice(0, 2000)}`;
      })
      .join("\n\n---\n\n");

    const prompt = `You are a critic. Review these outputs against the objective.
Objective: ${objective}

Outputs to review:
${outputsText}

Respond with valid JSON only: { "approved": true, "feedback": "...", "issuesFound": [] }
If approved is false, provide specific, actionable feedback for improvement.`;

    // Emit critic review start
    await this.emitEvent(this.createEvent({
      type: "agent.message",
      teamId,
      source: "coordinator",
      payload: {
        objectiveId,
        direction: "to_agent",
        fromRole: "coordinator",
        toRole: "critic",
        subTaskId: `critic-${objectiveId}`,
        message: prompt.slice(0, 500),
        model: "evaluator",
        wave: "critic"
      }
    })).catch(() => {});

    const result = await runCoordinatorPrompt({
      prompt,
      modelName: this.modelName,
      timeoutMs: this.timeoutMs
    });

    let parsed = extractJson(result.stdout);
    const approved = Boolean(parsed?.approved ?? parsed?.pass ?? true);

    // Emit agent.message for the critic's response
    await this.emitEvent(this.createEvent({
      type: "agent.message",
      teamId,
      source: "critic",
      payload: {
        objectiveId,
        direction: "from_agent",
        fromRole: "critic",
        toRole: "coordinator",
        subTaskId: `critic-${objectiveId}`,
        message: (result.stdout || "").slice(0, 500),
        model: "evaluator",
        durationMs: null
      }
    })).catch(() => {});

    if (!approved) {
      await this.emitEvent(
        this.createEvent({
          type: "penalty.applied",
          teamId,
          source: "coordinator",
          payload: { objectiveId, pointsDeducted: 10, reason: "critic_rejection" }
        })
      );
    } else {
      await this.emitEvent(
        this.createEvent({
          type: "reward.applied",
          teamId,
          source: "coordinator",
          payload: { objectiveId, pointsAdded: 20, reason: "first_pass_approval" }
        })
      );
    }

    return {
      approved,
      feedback: String(parsed?.feedback ?? ""),
      issuesFound: Array.isArray(parsed?.issuesFound) ? parsed.issuesFound : []
    };
  }

  async aggregate(teamId, objectiveId, subTaskResults, objective) {
    const outputsText = [...subTaskResults.entries()]
      .map(([id, out]) => {
        const val = typeof out === "string" ? out : out?.output ?? out?.text ?? "";
        const err = typeof out === "object" && out?.error ? `(FAILED: ${out.error})` : "";
        return `[${id}]: ${val || err || "(no output)"}`;
      })
      .join("\n\n---\n\n");

    const prompt = `You are the program lead. Combine the following specialist outputs into a single coherent deliverable for the objective.

Objective: ${objective}

Specialist outputs:
${outputsText}

Produce the final integrated output. Be concise and actionable.`;

    const result = await runCoordinatorPrompt({
      prompt,
      modelName: this.modelName,
      timeoutMs: this.timeoutMs
    });

    return result.stdout || "(no output)";
  }

  async executeObjective({ teamId, objective, objectiveId, maxIterations = 2, onProgress, modelOverrides = null }) {
    const subTaskResults = new Map();
    let subTasks = [];
    let iterations = 0;
    let finalOutput = "";

    await this.emitEvent(
      this.createEvent({
        type: "swarm.session.created",
        teamId,
        source: "coordinator",
        payload: { objectiveId, objective, teamId }
      })
    );

    try {
      subTasks = await this.decompose(objective);
      await this.emitEvent(
        this.createEvent({
          type: "swarm.session.decomposed",
          teamId,
          source: "coordinator",
          payload: { objectiveId, subTasks }
        })
      );

      const mode = process.env.RUNNER_MODE || "real";
      let feedback = "";

      while (iterations < maxIterations) {
        iterations += 1;
        subTaskResults.clear();

        await this.emitEvent(
          this.createEvent({
            type: "swarm.session.executing",
            teamId,
            source: "coordinator",
            payload: { objectiveId, iteration: iterations }
          })
        );

        await this.executeDAG(teamId, subTasks, objectiveId, subTaskResults, { feedback, mode, modelOverrides });

        await this.emitEvent(
          this.createEvent({
            type: "swarm.session.reviewing",
            teamId,
            source: "coordinator",
            payload: { objectiveId, iteration: iterations }
          })
        );

        const review = await this.criticReview(teamId, objectiveId, subTaskResults, objective);
        if (review.approved || iterations >= maxIterations) break;
        feedback = review.feedback;
        if (onProgress) onProgress({ objectiveId, iteration: iterations, feedback: review.feedback });
      }

      await this.emitEvent(
        this.createEvent({
          type: "swarm.session.aggregating",
          teamId,
          source: "coordinator",
          payload: { objectiveId }
        })
      );

      finalOutput = await this.aggregate(teamId, objectiveId, subTaskResults, objective);

      await this.emitEvent(
        this.createEvent({
          type: "swarm.session.completed",
          teamId,
          source: "coordinator",
          payload: { objectiveId, finalOutput }
        })
      );

      await this.emitEvent(
        this.createEvent({
          type: "reward.applied",
          teamId,
          source: "coordinator",
          payload: { objectiveId, pointsAdded: 50, reason: "objective_completed" }
        })
      );

      return { objectiveId, status: "completed", finalOutput, subTasks, iterations };
    } catch (err) {
      await this.emitEvent(
        this.createEvent({
          type: "swarm.session.failed",
          teamId,
          source: "coordinator",
          payload: { objectiveId, error: err?.message || String(err) }
        })
      );
      return { objectiveId, status: "failed", finalOutput: "", subTasks, iterations, error: err?.message || String(err) };
    }
  }
}
