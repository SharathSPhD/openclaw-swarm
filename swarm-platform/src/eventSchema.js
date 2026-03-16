import crypto from "node:crypto";

const VALID_TYPES = new Set([
  "task.submitted",
  "agent.assigned",
  "task.started",
  "task.checkpoint",
  "task.completed",
  "task.failed",
  "task.queued",
  "task.rejected",
  "team.chat",
  "model.selected",
  "control.team.pause",
  "control.team.resume",
  "orchestrator.autonomous.start",
  "orchestrator.autonomous.end",
  "objective.created",
  "objective.updated",
  "teamlead.objective.received",
  "subagent.spawned",
  "subagent.progress",
  "subagent.completed",
  "subagent.failed",
  "penalty.applied",
  "reward.applied",
  "telegram.sent",
  "telegram.failed",
  "telegram.inbound",
  "swarm.session.created",
  "swarm.session.decomposed",
  "swarm.session.dispatching",
  "swarm.session.executing",
  "swarm.session.reviewing",
  "swarm.session.aggregating",
  "swarm.session.completed",
  "swarm.session.failed",
  "system.state",
  // Competitive round lifecycle
  "competitive.started",
  "competitive.forked",
  "competitive.evaluated",
  "competitive.implementing",
  "competitive.merged",
  "competitive.restarting",
  "competitive.quality-gate-failed",
  // Agent communication
  "agent.message",
  "agent.handoff",
  // Objective performance
  "objective.completed",
  "objective.failed"
]);

export function createEvent({ type, teamId, payload = {}, source = "platform" }) {
  return {
    id: crypto.randomUUID(),
    ts: new Date().toISOString(),
    type,
    teamId,
    source,
    payload
  };
}

export function normalizeEvent(raw) {
  const type = raw?.type || "task.checkpoint";
  return {
    id: raw?.id || crypto.randomUUID(),
    ts: raw?.ts || new Date().toISOString(),
    type: VALID_TYPES.has(type) ? type : "task.checkpoint",
    teamId: raw?.teamId || "team-alpha",
    source: raw?.source || "platform",
    payload: raw?.payload || {}
  };
}

export function validateEvent(event) {
  if (!event || typeof event !== "object") return { ok: false, reason: "event_not_object" };
  if (!event.id || typeof event.id !== "string") return { ok: false, reason: "id_missing" };
  if (!event.ts || typeof event.ts !== "string") return { ok: false, reason: "ts_missing" };
  if (!event.type || typeof event.type !== "string") return { ok: false, reason: "type_missing" };
  if (!event.teamId || typeof event.teamId !== "string") return { ok: false, reason: "team_missing" };
  if (typeof event.payload !== "object" || event.payload === null) return { ok: false, reason: "payload_invalid" };
  return { ok: true };
}
