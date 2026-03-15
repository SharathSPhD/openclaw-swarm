export class AdmissionController {
  constructor(cfg) {
    this.cfg = cfg;
    this.lastTransitionTs = Date.now();
    this.cooldownMs = Number(cfg.STATE_COOLDOWN_MS || 8000);
    this.state = "normal";
  }

  update({ systemSnapshot, queueDepth, activeAgents }) {
    const used = systemSnapshot?.gpu?.usedPct ?? 0;
    const now = Date.now();
    let next = "normal";

    if (used >= Number(this.cfg.gpuCritPct)) next = "critical";
    else if (used >= Number(this.cfg.gpuEmergencyPct)) next = "emergency";
    else if (used >= Number(this.cfg.gpuWarnPct)) next = "high";
    else if (used >= Number(this.cfg.gpuElevatedPct) || queueDepth > Number(this.cfg.queueWarnDepth)) next = "elevated";

    if (activeAgents >= Number(this.cfg.maxActiveAgents)) next = next === "normal" ? "elevated" : next;

    if (next !== this.state && now - this.lastTransitionTs > this.cooldownMs) {
      this.state = next;
      this.lastTransitionTs = now;
    }

    return this.state;
  }

  decide({ rolePriority = 2, role = "build" }) {
    if (this.state === "critical" && rolePriority > 0) return { action: "reject", reason: "critical_load" };
    if (this.state === "emergency" && rolePriority > 1) return { action: "queue", reason: "emergency_defer" };
    if (this.state === "high" && role === "integrator") return { action: "queue", reason: "high_defer_integrator" };
    if (this.state === "elevated" && rolePriority > 2) return { action: "queue", reason: "elevated_queue" };
    return { action: "accept" };
  }
}
