import { spawn } from "node:child_process";
import crypto from "node:crypto";
import { buildToolContext, buildToolAwarePrompt } from "./toolContextBuilder.js";

const RAW_OUTPUT_MAX = 8000;
const SIGKILL_GRACE_MS = 5000;

const ROLE_TO_AGENT = {
  research: "research",
  build: "build",
  critic: "critic",
  integrator: "integrator",
  coordinator: "coordinator"
};

function parseOpenClawOutput(rawOutput) {
  const trimmed = rawOutput.trim();
  if (!trimmed) return { text: "", toolCalls: [], objects: [] };

  const objects = [];
  const lines = trimmed.split("\n").filter((l) => l.trim());

  for (const line of lines) {
    try {
      const obj = JSON.parse(line);
      objects.push(obj);
    } catch {
      /* skip */
    }
  }

  if (objects.length === 0) {
    try {
      const obj = JSON.parse(trimmed);
      objects.push(obj);
    } catch {
      return { text: trimmed, toolCalls: [], objects: [] };
    }
  }

  let text = "";
  const toolCalls = [];

  for (const obj of objects) {
    const payloads = obj?.result?.payloads ?? obj?.payloads ?? [];
    for (const p of payloads) {
      if (p?.type === "text" && p?.text) text += p.text;
      if (p?.type === "tool_call" || p?.type === "tool_use" || p?.type === "function_call") {
        toolCalls.push({ name: p.name ?? p.tool ?? p.function, args: p.args ?? p.arguments ?? {} });
      }
    }
    if (obj?.text) text += obj.text;
    if (obj?.result?.text) text += obj.result.text;
    const tc = obj?.tool_call ?? obj?.tool_use ?? obj?.function_call;
    if (tc) toolCalls.push({ name: tc.name ?? tc.tool ?? tc.function, args: tc.args ?? tc.arguments ?? {} });
  }

  if (!text && objects.length > 0) text = trimmed;
  return { text: text || trimmed, toolCalls, objects };
}

function computeCorrectness(text, hasError) {
  if (hasError) return 0.5;
  const len = (text || "").length;
  if (len > 100) return 0.9;
  if (len > 20) return 0.7;
  return 0.5;
}

function computeSpeed(durationMs, timeoutMs) {
  if (timeoutMs <= 0) return 1;
  const ratio = Math.max(0, (timeoutMs - durationMs) / timeoutMs);
  return Math.min(1, Math.max(0, ratio));
}

function computeEfficiency(rawOutput, toolCalls) {
  const lower = (rawOutput || "").toLowerCase();
  const hasOom = lower.includes("oom") || lower.includes("memory");
  const hasGateway = lower.includes("gateway") && lower.includes("error");
  const hasToolError = lower.includes("tool") && (lower.includes("error") || lower.includes("fail"));
  if (hasOom || hasGateway) return 0.6;
  if (hasToolError && toolCalls?.length > 0) return 0.8;
  return 1.0;
}

function classifyError(code, stderr) {
  if (code === 137) return "runner_timeout";
  const s = (stderr || "").toLowerCase();
  if (code === 1 && s.includes("gateway")) return "gateway_unreachable";
  if (code === 1 && s.includes("model")) return "model_not_found";
  if (code === 1 && (s.includes("oom") || s.includes("memory"))) return "ollama_oom";
  return "process_crash";
}

function runViaOpenClaw({ teamId, role, taskId, taskText, modelName, timeoutMs, runId, startedAt, agent, onEvent, worktreePath, explorationEngine }) {
  const codebaseHint = worktreePath
    ? `\nThe project codebase is available at: ${worktreePath}\nYour working directory is set to the team worktree. Make changes there.`
    : "\nThe project codebase is available at /codebase/swarm-platform/ inside the sandbox.";
  const toolContext = buildToolContext(explorationEngine, role);
  const prompt = buildToolAwarePrompt({ role, taskText: `task ${taskId}: ${taskText}`, toolContext, codebaseHint });
  const agentId = agent || ROLE_TO_AGENT[role] || "main";
  const args = ["agent", "--agent", agentId, "--message", prompt, "--json"];
  const spawnCwd = worktreePath || undefined;
  const child = spawn("openclaw", args, {
    stdio: ["ignore", "pipe", "pipe"],
    env: { ...process.env },
    ...(spawnCwd ? { cwd: spawnCwd } : {})
  });

  let stdout = "";
  let stderr = "";
  let finalized = false;
  let timedOut = false;
  let killGraceTimer = null;

  const mainTimer = setTimeout(() => {
    if (finalized) return;
    timedOut = true;
    child.kill("SIGTERM");
    killGraceTimer = setTimeout(() => {
      if (!finalized && child.exitCode === null) child.kill("SIGKILL");
    }, SIGKILL_GRACE_MS);
  }, timeoutMs);

  child.stdout.on("data", (chunk) => {
    const str = chunk.toString();
    stdout += str;
    onEvent({
      type: "task.checkpoint",
      teamId,
      payload: { taskId, role, runId, model: modelName, checkpoint: "stdout", bytes: stdout.length, text: str }
    });
  });

  child.stderr.on("data", (chunk) => {
    stderr += chunk.toString();
  });

  child.on("close", (code) => {
    clearTimeout(mainTimer);
    if (killGraceTimer) clearTimeout(killGraceTimer);
    if (finalized) return;
    finalized = true;

    const durationMs = Date.now() - startedAt;
    const rawOutput = stdout.slice(0, RAW_OUTPUT_MAX);
    const { text, toolCalls } = parseOpenClawOutput(stdout);

    if (code === 0) {
      const output = text;
      const hasError = (output || "").toLowerCase().includes("error") && (output || "").length < 200;
      const correctness = computeCorrectness(output, hasError);
      const speed = computeSpeed(durationMs, timeoutMs);
      const efficiency = computeEfficiency(stdout, toolCalls);

      onEvent({
        type: "task.completed",
        teamId,
        payload: {
          taskId, role, runId, model: modelName, output, rawOutput, toolCalls, reasoningTrace: rawOutput, durationMs,
          correctness, speed, efficiency,
          firstPass: true, reproducible: true, resourcePenalty: 0
        }
      });

      if (speed > 0.7) {
        onEvent({ type: "reward.applied", teamId, payload: { taskId, role, pointsAdded: 15, reason: "fast_completion" } });
      }
      if (correctness > 0.85 && (output || "").length > 500) {
        onEvent({ type: "reward.applied", teamId, payload: { taskId, role, pointsAdded: 10, reason: "high_quality" } });
      }
    } else {
      const errorType = timedOut ? "runner_timeout" : classifyError(code, stderr);
      onEvent({
        type: "task.failed",
        teamId,
        payload: { taskId, role, runId, model: modelName, error: errorType, rawOutput, durationMs }
      });

      if (errorType === "runner_timeout") {
        onEvent({ type: "task.timeout", teamId, payload: { taskId, role, model: modelName, durationMs } });
      }
      if (errorType === "ollama_oom") {
        onEvent({ type: "penalty.applied", teamId, payload: { taskId, role, pointsDeducted: 25, reason: "ollama_oom" } });
      }
    }
  });

  return child;
}

export function runTask({ teamId, role, taskId, taskText, timeoutMs = 120000, telegramTo, agent, modelName = "qwen2.5:7b", mode = "mock", useTools = false, worktreePath, explorationEngine, onEvent }) {
  const startedAt = Date.now();
  const runId = crypto.randomUUID();

  onEvent({ type: "task.started", teamId, payload: { taskId, role, runId } });

  if (mode !== "real") {
    const wait = 1200 + Math.floor(Math.random() * 2800);
    setTimeout(() => {
      const ok = Math.random() > 0.08;
      if (ok) {
        onEvent({
          type: "task.completed",
          teamId,
          payload: {
            taskId, role, runId, output: `Mock completion for ${role}`,
            durationMs: Date.now() - startedAt,
            correctness: Math.random() * 0.25 + 0.75,
            speed: Math.random() * 0.35 + 0.65,
            efficiency: Math.random() * 0.35 + 0.65,
            firstPass: true, reproducible: true, resourcePenalty: 0
          }
        });
      } else {
        onEvent({
          type: "task.failed",
          teamId,
          payload: { taskId, role, runId, error: "mock_worker_error", durationMs: Date.now() - startedAt }
        });
      }
    }, wait);
    return { runId, process: null };
  }

  const child = runViaOpenClaw({ teamId, role, taskId, taskText, modelName, timeoutMs, runId, startedAt, agent, onEvent, worktreePath, explorationEngine });
  return { runId, process: child };
}
