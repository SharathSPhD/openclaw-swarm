import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const rulesFile = path.resolve(__dirname, "..", "data", "scoring_rules.json");

function loadRules() {
  try {
    return JSON.parse(fs.readFileSync(rulesFile, "utf8"));
  } catch {
    return {
      weights: { base: 100, correctness: 45, speed: 20, efficiency: 20, reproducibility: 10, firstPass: 10 },
      penalties: { taskFailed: 45, timeout: 35, policyViolation: 50, resourcePenaltyMultiplier: 2, manualPenaltyDefault: 25 }
    };
  }
}

function toNum(v, d = 0) {
  const n = Number(v);
  return Number.isFinite(n) ? n : d;
}

export function calculateScoreDelta(event) {
  const type = event.type;
  const payload = event.payload || {};
  const rules = loadRules();

  if (type === "task.completed") {
    const correctness = toNum(payload.correctness, 0.8);
    const speed = toNum(payload.speed, 0.7);
    const efficiency = toNum(payload.efficiency, 0.7);
    const reproducibility = payload.reproducible ? 1 : 0;
    const firstPass = payload.firstPass ? 1 : 0;
    const resourcePenalty = Math.abs(toNum(payload.resourcePenalty, 0));

    const positive =
      rules.weights.base +
      Math.round(rules.weights.correctness * correctness) +
      Math.round(rules.weights.speed * speed) +
      Math.round(rules.weights.efficiency * efficiency) +
      Math.round(rules.weights.reproducibility * reproducibility) +
      Math.round(rules.weights.firstPass * firstPass);

    const negative = Math.round(resourcePenalty * rules.penalties.resourcePenaltyMultiplier);
    return positive - negative;
  }

  if (type === "task.failed") return -Math.abs(rules.penalties.taskFailed);
  if (type === "task.timeout") return -Math.abs(rules.penalties.timeout);
  if (type === "policy.violation") return -Math.abs(rules.penalties.policyViolation);
  if (type === "penalty.applied") return -Math.abs(toNum(payload.pointsDeducted, rules.penalties.manualPenaltyDefault));
  if (type === "reward.applied") return Math.abs(toNum(payload.pointsAdded, 15));
  return 0;
}

export function summarizeTeam(events, teamId) {
  const teamEvents = events.filter((e) => e.teamId === teamId);
  const score = teamEvents.reduce((sum, e) => sum + calculateScoreDelta(e), 0);

  const completedEvents = teamEvents.filter((e) => e.type === "task.completed");
  const completed = completedEvents.length;
  const failed = teamEvents.filter((e) => e.type === "task.failed").length;
  const penalties = teamEvents
    .filter((e) => e.type === "penalty.applied")
    .reduce((sum, e) => sum + Math.abs(toNum(e.payload?.pointsDeducted, 0)), 0);

  const accuracy = completed + failed === 0 ? 0 : completed / (completed + failed);

  const byRole = {};
  const byAgent = {};
  for (const e of completedEvents) {
    const role = e.payload?.role || "unknown";
    const agent = e.payload?.agentId || `${teamId}-${role}`;
    byRole[role] = (byRole[role] || 0) + 1;
    byAgent[agent] = (byAgent[agent] || 0) + 1;
  }

  const modelUsage = {};
  const durations = [];
  let toolCallCount = 0;
  for (const e of completedEvents) {
    const model = e.payload?.model || "unknown";
    modelUsage[model] = (modelUsage[model] || 0) + 1;
    if (e.payload?.durationMs) durations.push(e.payload.durationMs);
    if (Array.isArray(e.payload?.toolCalls)) toolCallCount += e.payload.toolCalls.length;
  }
  const avgLatency = durations.length > 0 ? Math.round(durations.reduce((a, b) => a + b, 0) / durations.length) : 0;

  const rewardEvents = teamEvents.filter((e) => e.type === "reward.applied");
  const rewards = rewardEvents.reduce((sum, e) => sum + Math.abs(toNum(e.payload?.pointsAdded, 0)), 0);

  const firstPassApprovals = rewardEvents.filter((e) => e.payload?.reason === "first_pass_approval").length;
  const criticReviews = teamEvents.filter((e) => e.type === "penalty.applied" && e.payload?.reason === "critic_rejection").length + firstPassApprovals;
  const criticApprovalRate = criticReviews > 0 ? Number((firstPassApprovals / criticReviews).toFixed(3)) : 1;

  const objectiveCompleted = teamEvents.filter((e) => e.type === "swarm.session.completed");
  const objectiveFailed = teamEvents.filter((e) => e.type === "swarm.session.failed");
  const recentObjectives = [...objectiveCompleted.map((e) => ({ id: e.payload?.objectiveId, status: "completed" })),
    ...objectiveFailed.map((e) => ({ id: e.payload?.objectiveId, status: "failed" }))
  ].slice(-5);

  return {
    teamId,
    score,
    completed,
    failed,
    penalties,
    rewards,
    accuracy: Number(accuracy.toFixed(3)),
    byRole,
    byAgent,
    modelUsage,
    avgLatency,
    toolUsage: toolCallCount,
    criticApprovalRate,
    recentObjectives
  };
}
