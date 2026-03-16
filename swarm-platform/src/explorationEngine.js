/**
 * Exploration Engine
 *
 * The program lead's assistant (team-delta) uses this to:
 * 1. Discover and catalog available OpenClaw skills/tools
 * 2. Generate external objectives beyond self-improvement
 * 3. Weigh and prioritize objectives based on system state
 * 4. Manage the skill ecosystem
 */

import fs from "node:fs";
import path from "node:path";

const OPENCLAW_HOME = process.env.OPENCLAW_HOME || path.join(process.env.HOME || "/root", ".openclaw");
const SKILL_CATALOG_PATH = path.join(OPENCLAW_HOME, "skills");

const EXTERNAL_OBJECTIVE_TEMPLATES = [
  {
    category: "security_audit",
    weight: 0.8,
    generator: () => "Perform a security audit of the swarm platform codebase. Check for: hardcoded secrets, SQL injection risks, unvalidated inputs in API endpoints, missing authentication on sensitive routes, and exposed debug endpoints. Report findings with severity and fix recommendations."
  },
  {
    category: "api_design",
    weight: 0.7,
    generator: () => "Review all REST API endpoints in server.js for consistency. Check: HTTP method correctness, response format uniformity, error handling patterns, status code usage, and missing CORS headers. Propose a standardized API response format."
  },
  {
    category: "code_quality",
    weight: 0.6,
    generator: () => "Analyze the swarm-platform codebase for code smells and refactoring opportunities. Focus on: duplicated logic, overly complex functions (>50 lines), missing error handling, inconsistent naming conventions, and dead code. Provide specific refactoring suggestions."
  },
  {
    category: "resilience",
    weight: 0.75,
    generator: () => "Design a resilience strategy for the swarm platform. Address: what happens when Ollama is down, how to handle partial task failures in a coordinator pipeline, implementing circuit breakers for model calls, and graceful degradation when GPU memory is exhausted."
  },
  {
    category: "monitoring",
    weight: 0.65,
    generator: () => "Design a comprehensive monitoring dashboard for the swarm platform. Include: task throughput over time, model error rates, GPU utilization trends, team performance comparison over rounds, and automated alerting thresholds. Specify metric collection points and visualization recommendations."
  },
  {
    category: "user_experience",
    weight: 0.5,
    generator: () => "Evaluate the swarm platform UI for usability improvements. Consider: information density on the dashboard, navigation flow between pages, real-time feedback for running objectives, mobile responsiveness, and accessibility. Propose 5 concrete UI improvements."
  },
  {
    category: "scalability",
    weight: 0.6,
    generator: () => "Analyze the swarm platform's scalability limits. Consider: maximum concurrent objectives, event store memory growth, WebSocket connection limits, database query performance under load, and model loading/unloading overhead. Propose specific solutions for each bottleneck."
  },
  {
    category: "knowledge_base",
    weight: 0.55,
    generator: () => "Design a knowledge base system for the swarm platform that persists insights from completed objectives. The system should: store actionable findings, tag them by domain, make them searchable by future objectives, and automatically include relevant past knowledge in new task prompts."
  }
];

export class ExplorationEngine {
  constructor({ db, store, teamLearning }) {
    this.db = db;
    this.store = store;
    this.teamLearning = teamLearning;
    this.explorationIndex = 0;
    this.completedExplorations = new Set();
  }

  discoverInstalledSkills() {
    const skills = [];
    try {
      if (!fs.existsSync(SKILL_CATALOG_PATH)) return skills;
      const entries = fs.readdirSync(SKILL_CATALOG_PATH, { withFileTypes: true });
      for (const entry of entries) {
        if (entry.isDirectory()) {
          const skillDir = path.join(SKILL_CATALOG_PATH, entry.name);
          const metaPath = path.join(skillDir, "skill.json");
          if (fs.existsSync(metaPath)) {
            try {
              const meta = JSON.parse(fs.readFileSync(metaPath, "utf-8"));
              skills.push({ id: entry.name, name: meta.name || entry.name, description: meta.description || "", path: skillDir, version: meta.version || "0.0.0" });
            } catch { skills.push({ id: entry.name, name: entry.name, path: skillDir }); }
          } else {
            skills.push({ id: entry.name, name: entry.name, path: skillDir });
          }
        }
      }
    } catch { /* skill dir may not exist */ }
    return skills;
  }

  discoverInstalledTools() {
    const tools = [];
    try {
      const configPath = path.join(OPENCLAW_HOME, "openclaw.json");
      if (!fs.existsSync(configPath)) return tools;
      const config = JSON.parse(fs.readFileSync(configPath, "utf-8"));
      const agents = config.agents || {};
      for (const [agentId, agentDef] of Object.entries(agents)) {
        const agentTools = agentDef.tools || [];
        for (const t of agentTools) {
          tools.push({ agent: agentId, tool: typeof t === "string" ? t : t.name || t.id || "unknown" });
        }
      }
    } catch { /* config may not exist */ }
    return tools;
  }

  generateExplorationObjective(stats) {
    const eligible = EXTERNAL_OBJECTIVE_TEMPLATES.filter(t => !this.completedExplorations.has(t.category));
    if (eligible.length === 0) {
      this.completedExplorations.clear();
      return this.generateExplorationObjective(stats);
    }

    const weighted = eligible.map(t => {
      let adjustedWeight = t.weight;
      if (t.category === "security_audit" && stats.completed < 5) adjustedWeight *= 1.5;
      if (t.category === "resilience" && stats.avgLatency > 30000) adjustedWeight *= 1.3;
      if (t.category === "code_quality" && stats.completed > 20) adjustedWeight *= 1.2;
      return { ...t, adjustedWeight };
    });

    weighted.sort((a, b) => b.adjustedWeight - a.adjustedWeight);
    const selected = weighted[0];
    this.completedExplorations.add(selected.category);

    return {
      category: selected.category,
      objective: selected.generator(),
      weight: selected.adjustedWeight,
      isExternal: true
    };
  }

  generateSkillDiscoveryObjective() {
    const skills = this.discoverInstalledSkills();
    const tools = this.discoverInstalledTools();

    return {
      category: "skill_discovery",
      objective: `Audit the OpenClaw skill and tool ecosystem. Currently installed skills: ${skills.length} (${skills.map(s => s.name).join(", ") || "none"}). ` +
        `Available agent tools: ${tools.length} (${tools.map(t => `${t.agent}:${t.tool}`).join(", ") || "none"}). ` +
        `Research what additional skills or tools would most benefit the swarm platform. Consider: web search tools, code analysis tools, file management tools, and testing frameworks. ` +
        `For each recommendation, explain how it would improve the platform's autonomous capabilities.`,
      weight: 0.7,
      isExternal: true
    };
  }

  weighObjectives(selfImprovementObj, explorationObj, stats) {
    // Use externally computed weights if provided (from lesson-based feedback loop)
    const selfWeight = stats?.selfWeight ?? 0.6;
    const exploreWeight = stats?.exploreWeight ?? 0.4;

    const roundNumber = stats?.completed || 0;
    const exploreBoost = Math.min(0.2, roundNumber * 0.02);

    const adjustedExploreWeight = exploreWeight + exploreBoost;
    const adjustedSelfWeight = selfWeight - exploreBoost;

    // High-priority exploration overrides weights
    if (explorationObj.weight > 0.9) {
      return { selected: explorationObj, reason: `High-priority exploration: ${explorationObj.category}` };
    }

    // Use weighted random selection based on computed weights
    if (Math.random() < adjustedExploreWeight) {
      return { selected: explorationObj, reason: `Exploration selected. Weight: ${adjustedExploreWeight.toFixed(2)}` };
    }

    return { selected: selfImprovementObj, reason: `Self-improvement priority. Weight: ${adjustedSelfWeight.toFixed(2)}` };
  }
}
