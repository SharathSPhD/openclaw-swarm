import crypto from "node:crypto";

const ROLE_KEYWORDS = {
  research: ["research", "search", "web", "facts", "market"],
  build: ["build", "implement", "code", "patch", "fix"],
  critic: ["review", "risk", "security", "test", "validate"],
  integrator: ["merge", "integrate", "compose", "final", "deliver"]
};

function pickRole(taskText = "") {
  const text = taskText.toLowerCase();
  for (const [role, words] of Object.entries(ROLE_KEYWORDS)) {
    if (words.some((w) => text.includes(w))) return role;
  }
  return "build";
}

export function createDispatch({ teamId, task, activeAgents, maxAgents, loadState }) {
  const role = pickRole(task);
  const taskId = crypto.randomUUID();
  const now = new Date().toISOString();

  if (activeAgents >= maxAgents) {
    return {
      accepted: false,
      reason: "agent_budget_exceeded",
      taskId,
      events: [
        {
          id: crypto.randomUUID(),
          ts: now,
          type: "task.queued",
          teamId,
          payload: { taskId, task, role, reason: "budget" }
        }
      ]
    };
  }

  if (loadState === "critical") {
    return {
      accepted: false,
      reason: "system_critical",
      taskId,
      events: [
        {
          id: crypto.randomUUID(),
          ts: now,
          type: "task.rejected",
          teamId,
          payload: { taskId, task, role, reason: "critical_load" }
        }
      ]
    };
  }

  const accepted = loadState !== "high" || role !== "integrator";
  if (!accepted) {
    return {
      accepted: false,
      reason: "degraded_mode_deferral",
      taskId,
      events: [
        {
          id: crypto.randomUUID(),
          ts: now,
          type: "task.queued",
          teamId,
          payload: { taskId, task, role, reason: "degraded_mode" }
        }
      ]
    };
  }

  return {
    accepted: true,
    taskId,
    role,
    events: [
      {
        id: crypto.randomUUID(),
        ts: now,
        type: "task.submitted",
        teamId,
        payload: { taskId, task, role }
      },
      {
        id: crypto.randomUUID(),
        ts: now,
        type: "agent.assigned",
        teamId,
        payload: { taskId, role, agentId: `${teamId}-${role}` }
      }
    ]
  };
}

export function createDispatchWithPolicy({ teamId, task, actorRole, policyEngine, admissionDecision, activeAgents, maxAgents, activeTeamAgents }) {
  const role = policyEngine.inferRole(task);
  const taskId = crypto.randomUUID();
  const now = new Date().toISOString();

  if (activeAgents >= maxAgents) {
    return {
      accepted: false,
      reason: "global_agent_budget_exceeded",
      taskId,
      role,
      events: [
        {
          id: crypto.randomUUID(),
          ts: now,
          type: "task.queued",
          teamId,
          source: "orchestrator",
          payload: { taskId, task, role, reason: "global_budget" }
        }
      ]
    };
  }

  const policy = policyEngine.validateDispatch({ teamId, role, activeTeamAgents, actorRole });
  if (!policy.ok) {
    return {
      accepted: false,
      reason: policy.reason,
      taskId,
      role,
      events: [
        {
          id: crypto.randomUUID(),
          ts: now,
          type: "task.rejected",
          teamId,
          source: "policy",
          payload: { taskId, task, role, reason: policy.reason }
        }
      ]
    };
  }

  if (admissionDecision.action === "reject") {
    return {
      accepted: false,
      reason: admissionDecision.reason,
      taskId,
      role,
      events: [
        {
          id: crypto.randomUUID(),
          ts: now,
          type: "task.rejected",
          teamId,
          source: "admission",
          payload: { taskId, task, role, reason: admissionDecision.reason }
        }
      ]
    };
  }

  if (admissionDecision.action === "queue") {
    return {
      accepted: false,
      queued: true,
      reason: admissionDecision.reason,
      taskId,
      role,
      policy: policy.policy,
      events: [
        {
          id: crypto.randomUUID(),
          ts: now,
          type: "task.queued",
          teamId,
          source: "admission",
          payload: { taskId, task, role, reason: admissionDecision.reason }
        }
      ]
    };
  }

  return {
    accepted: true,
    taskId,
    role,
    policy: policy.policy,
    events: [
      {
        id: crypto.randomUUID(),
        ts: now,
        type: "task.submitted",
        teamId,
        source: "orchestrator",
        payload: { taskId, task, role }
      },
      {
        id: crypto.randomUUID(),
        ts: now,
        type: "agent.assigned",
        teamId,
        source: "orchestrator",
        payload: { taskId, role, agentId: `${teamId}-${role}` }
      }
    ]
  };
}
