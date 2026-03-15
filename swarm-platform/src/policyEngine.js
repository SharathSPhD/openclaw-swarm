import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const root = path.resolve(__dirname, "..");

function readJson(filePath, fallback) {
  try {
    return JSON.parse(fs.readFileSync(filePath, "utf8"));
  } catch {
    return fallback;
  }
}

export class PolicyEngine {
  constructor() {
    this.policiesFile = path.join(root, "data", "policies.json");
    this.teamsFile = path.join(root, "data", "teams.json");
    this.policies = readJson(this.policiesFile, {
      maxParallelPerTeam: 4,
      roles: {}
    });
    this.teams = readJson(this.teamsFile, { teams: [] }).teams || [];
  }

  refresh() {
    this.policies = readJson(this.policiesFile, this.policies);
    this.teams = readJson(this.teamsFile, { teams: this.teams }).teams || this.teams;
  }

  inferRole(taskText = "") {
    const text = taskText.toLowerCase();
    const keywords = {
      research: ["research", "search", "collect", "web", "facts"],
      build: ["build", "implement", "code", "fix", "patch"],
      critic: ["review", "risk", "test", "validate", "security"],
      integrator: ["integrate", "merge", "compose", "release", "deliver"]
    };
    for (const [role, words] of Object.entries(keywords)) {
      if (words.some((w) => text.includes(w))) return role;
    }
    return "build";
  }

  validateDispatch({ teamId, role, activeTeamAgents, actorRole = "team-lead" }) {
    const team = this.teams.find((t) => t.id === teamId);
    if (!team) return { ok: false, reason: "unknown_team" };

    const allowedRoles = new Set(team.roles || []);
    if (!allowedRoles.has(role)) return { ok: false, reason: "role_not_in_team" };

    const rolePolicy = this.policies.roles?.[role] || {};
    const allowedActorRoles = rolePolicy.allowedActorRoles || ["team-lead", "program-lead"];
    if (!allowedActorRoles.includes(actorRole)) return { ok: false, reason: "actor_role_denied" };

    const maxParallel = Number(rolePolicy.maxParallel ?? this.policies.maxParallelPerTeam ?? 4);
    if (activeTeamAgents >= maxParallel) return { ok: false, reason: "team_parallel_limit" };

    return {
      ok: true,
      policy: {
        timeoutMs: Number(rolePolicy.timeoutMs || 120000),
        modelTier: rolePolicy.modelTier || "standard",
        priority: rolePolicy.priority || 2,
        allowSpawn: Boolean(rolePolicy.allowSpawn ?? false)
      }
    };
  }
}
