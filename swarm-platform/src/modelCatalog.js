import { execSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const root = path.resolve(__dirname, "..");
const routingFile = path.join(root, "data", "model_routing.json");
const latencyFile = path.join(root, "data", "model_latency.json");
const capabilitiesFile = path.join(root, "data", "model_capabilities.json");

const ROLE_PREFERENCES = {
  research: ["qwen2.5:7b", "phi3:mini", "llama3.2:3b", "nemotron-mini:4b", "qwen2.5:3b"],
  build: ["qwen2.5-coder:7b", "deepseek-coder:6.7b", "qwen2.5:7b", "gemma2:9b"],
  critic: ["llama3.1:8b", "mistral:7b", "qwen2.5:14b", "gemma2:9b"],
  integrator: ["qwen2.5:14b", "gemma2:9b", "mistral:7b"],
  coordinator: ["qwen2.5:14b", "gemma2:9b", "qwen2.5:7b"],
  "program-lead": ["qwen2.5:14b", "nemotron-mini:4b", "gemma2:9b"],
  evaluator: ["qwen2.5:14b", "gemma2:9b", "qwen2.5:7b"]
};

const DEFAULT_ROUTING = {
  requiredModels: [
    "gpt-oss:120b",
    "nemotron-mini:4b",
    "deepseek-r1:8b",
    "deepseek-coder:6.7b",
    "qwen2.5:7b",
    "qwen2.5:14b",
    "qwen2.5:3b",
    "qwen2.5-coder:7b",
    "llama3.1:8b",
    "llama3.2:3b",
    "mistral:7b",
    "gemma2:9b",
    "phi3:mini"
  ],
  tiers: {
    fast: ["qwen2.5:3b", "llama3.2:3b", "phi3:mini", "nemotron-mini:4b", "qwen2.5:7b", "mistral:7b"],
    standard: ["qwen2.5:7b", "qwen2.5-coder:7b", "deepseek-coder:6.7b", "llama3.1:8b", "mistral:7b", "gemma2:9b"],
    quality: ["qwen2.5:14b", "gemma2:9b", "qwen2.5-coder:7b", "deepseek-coder:6.7b"]
  },
  roleRoutes: {
    research: { tier: "fast", primary: "qwen2.5:7b", fallback: ["phi3:mini", "llama3.2:3b", "nemotron-mini:4b", "qwen2.5:3b"] },
    build: { tier: "standard", primary: "qwen2.5-coder:7b", fallback: ["deepseek-coder:6.7b", "qwen2.5:7b", "gemma2:9b"] },
    critic: { tier: "standard", primary: "llama3.1:8b", fallback: ["mistral:7b", "qwen2.5:14b", "gemma2:9b"] },
    integrator: { tier: "quality", primary: "qwen2.5:14b", fallback: ["gemma2:9b", "mistral:7b"] },
    coordinator: { tier: "quality", primary: "qwen2.5:14b", fallback: ["gemma2:9b", "qwen2.5:7b"] },
    "program-lead": { tier: "quality", primary: "qwen2.5:14b", fallback: ["nemotron-mini:4b", "gemma2:9b"] },
    evaluator: { tier: "quality", primary: "qwen2.5:14b", fallback: ["gemma2:9b", "qwen2.5:7b"] }
  }
};

function readJsonSafe(filePath, fallbackValue) {
  try {
    return JSON.parse(fs.readFileSync(filePath, "utf8"));
  } catch {
    return fallbackValue;
  }
}

function normalizeModelId(value = "") {
  return String(value).trim().toLowerCase();
}

function parseNumber(value, fallback = null) {
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
}

function parseOllamaList(output) {
  const lines = output
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean);

  const data = [];
  for (let i = 1; i < lines.length; i += 1) {
    const row = lines[i];
    const parts = row.split(/\s{2,}/).filter(Boolean);
    if (parts.length < 2) continue;
    data.push({
      id: parts[0],
      size: parts[2] || "unknown",
      modified: parts[3] || "unknown"
    });
  }
  return data;
}

export function discoverLocalModels() {
  try {
    const output = execSync("ollama list", { stdio: ["ignore", "pipe", "ignore"] }).toString();
    const models = parseOllamaList(output);
    return { available: true, models };
  } catch {
    return { available: false, models: [] };
  }
}

export function loadModelRouting() {
  const fromDisk = readJsonSafe(routingFile, {});
  return {
    requiredModels: fromDisk.requiredModels || DEFAULT_ROUTING.requiredModels,
    tiers: fromDisk.tiers || DEFAULT_ROUTING.tiers,
    roleRoutes: fromDisk.roleRoutes || DEFAULT_ROUTING.roleRoutes
  };
}

export function readModelLatency() {
  const payload = readJsonSafe(latencyFile, { generatedAt: null, models: {} });
  const capabilities = readJsonSafe(capabilitiesFile, { generatedAt: null, models: {} });
  const mergedModels = { ...(payload.models || {}) };

  for (const [id, cap] of Object.entries(capabilities.models || {})) {
    const key = normalizeModelId(id);
    const current = mergedModels[key] || {};
    const hasMeasured = current.runnable && parseNumber(current.p50Ms, null) !== null;
    if (!hasMeasured) {
      mergedModels[key] = {
        available: current.available ?? true,
        runnable: current.runnable ?? true,
        p50Ms: parseNumber(cap.estimatedP50Ms, parseNumber(current.p50Ms, null)),
        avgMs: parseNumber(cap.estimatedAvgMs, parseNumber(current.avgMs, null)),
        source: "web_estimate",
        note: cap.note || null
      };
    }
  }

  return {
    generatedAt: payload.generatedAt || capabilities.generatedAt || null,
    models: mergedModels
  };
}

export function readModelCapabilities() {
  const payload = readJsonSafe(capabilitiesFile, { generatedAt: null, models: {} });
  return {
    generatedAt: payload.generatedAt || null,
    sources: payload.sources || [],
    models: payload.models || {}
  };
}

export function computeInventoryStatus({ models = [], routing = loadModelRouting() }) {
  const availableSet = new Set(models.map((m) => normalizeModelId(m.id)));
  const required = routing.requiredModels || [];
  const missingRequired = required.filter((id) => !availableSet.has(normalizeModelId(id)));
  return {
    required,
    missingRequired,
    complete: missingRequired.length === 0
  };
}

function rankByLatency(candidates = [], latencyByModel = {}) {
  return [...candidates].sort((a, b) => {
    const aMs = parseNumber(latencyByModel[normalizeModelId(a)]?.p50Ms, Number.MAX_SAFE_INTEGER);
    const bMs = parseNumber(latencyByModel[normalizeModelId(b)]?.p50Ms, Number.MAX_SAFE_INTEGER);
    return aMs - bMs;
  });
}

function findInstalledModel(preferredIds = [], models = []) {
  for (const wanted of preferredIds) {
    const exact = models.find((m) => normalizeModelId(m.id) === normalizeModelId(wanted));
    if (exact) return exact;
    const byPrefix = models.find((m) => normalizeModelId(m.id).includes(normalizeModelId(wanted)));
    if (byPrefix) return byPrefix;
  }
  return null;
}

export function chooseModelForRole({ role, modelTier = "standard", models = [], routing = loadModelRouting(), latency = readModelLatency() }) {
  const routes = routing.roleRoutes || {};
  const tierMap = routing.tiers || {};
  const route = routes[role] || {};
  const targetTier = route.tier || modelTier || "standard";
  const tierCandidates = tierMap[targetTier] || [];
  const recommended = latency?.recommendations?.[role] || [];
  const roleCandidates = [
    ...recommended,
    route.primary,
    ...(route.fallback || []),
    ...(ROLE_PREFERENCES[role] || ROLE_PREFERENCES.build),
    ...tierCandidates
  ]
    .filter(Boolean);
  const latencyByModel = latency.models || {};
  const sortedCandidates = rankByLatency([...new Set(roleCandidates)], latencyByModel);

  if (!models.length) {
    return {
      selectedModel: `fallback-${targetTier}`,
      rationale: "No local model inventory available",
      tier: targetTier,
      alternatives: sortedCandidates,
      estimatedLatencyMs: null
    };
  }

  let selected = findInstalledModel(sortedCandidates, models);

  if (!selected) selected = models[0];
  const latencyMs = parseNumber(latencyByModel[normalizeModelId(selected.id)]?.p50Ms, null);
  return {
    selectedModel: selected.id,
    rationale: `Matched role=${role} tier=${targetTier}${latencyMs ? ` latencyP50=${latencyMs}ms` : ""}`,
    tier: targetTier,
    alternatives: sortedCandidates,
    estimatedLatencyMs: latencyMs
  };
}
