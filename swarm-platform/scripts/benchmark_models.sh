#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
ROUTING_FILE="$ROOT_DIR/data/model_routing.json"
OUTPUT_FILE="$ROOT_DIR/data/model_latency.json"
SAMPLES="${1:-3}"

if ! command -v ollama >/dev/null 2>&1; then
  echo "ollama is not installed or not in PATH"
  exit 1
fi

if [[ ! -f "$ROUTING_FILE" ]]; then
  echo "missing routing file: $ROUTING_FILE"
  exit 1
fi

node - "$ROUTING_FILE" "$OUTPUT_FILE" "$SAMPLES" <<'NODE'
const fs = require('fs');
const cp = require('child_process');

const routingFile = process.argv[2];
const outputFile = process.argv[3];
const samples = Math.max(2, Number(process.argv[4] || 3));

function runGenerate(model, prompt) {
  const payload = JSON.stringify({ model, prompt, stream: false });
  const start = Date.now();
  cp.execFileSync('curl', [
    '-sS',
    '--max-time',
    '180',
    'http://127.0.0.1:11434/api/generate',
    '-H',
    'Content-Type: application/json',
    '-d',
    payload
  ], {
    stdio: ['ignore', 'pipe', 'pipe'],
    timeout: 210000
  });
  return Date.now() - start;
}

function percentile50(list) {
  const sorted = [...list].sort((a, b) => a - b);
  const idx = Math.floor((sorted.length - 1) * 0.5);
  return sorted[idx];
}

const routing = JSON.parse(fs.readFileSync(routingFile, 'utf8'));
const targetModels = routing.requiredModels || [];
const installedRows = cp.execSync('ollama list', { stdio: ['ignore', 'pipe', 'ignore'] }).toString().split('\n').slice(1).filter(Boolean);
const installed = installedRows.map((line) => line.trim().split(/\s{2,}/)[0]).filter(Boolean);
const models = [...new Set([...targetModels, ...installed])];
const result = {
  generatedAt: new Date().toISOString(),
  samples,
  prompt: 'Summarize why low-latency models matter in one sentence.',
  models: {},
  recommendations: {
    research: [],
    build: [],
    critic: [],
    integrator: [],
    'program-lead': []
  }
};

for (const model of models) {
  try {
    cp.execSync(`ollama show ${model}`, { stdio: ['ignore', 'ignore', 'ignore'] });
  } catch {
    result.models[model.toLowerCase()] = { available: false, reason: 'not_installed' };
    continue;
  }

  const warmupPrompt = 'Respond with OK';
  try {
    runGenerate(model, warmupPrompt);
  } catch (error) {
    result.models[model.toLowerCase()] = {
      available: true,
      runnable: false,
      reason: 'warmup_failed',
      error: String(error?.stderr || error?.message || 'unknown')
    };
    continue;
  }

  const durations = [];
  for (let i = 0; i < samples; i += 1) {
    try {
      durations.push(runGenerate(model, result.prompt));
    } catch {
      durations.push(120000);
    }
  }

  const p50 = percentile50(durations);
  const avg = Math.round(durations.reduce((sum, d) => sum + d, 0) / durations.length);
  result.models[model.toLowerCase()] = {
    available: true,
    runnable: true,
    runs: durations,
    p50Ms: p50,
    avgMs: avg,
    maxMs: Math.max(...durations),
    minMs: Math.min(...durations)
  };
}

const runnable = Object.entries(result.models)
  .filter(([, v]) => v && v.runnable)
  .map(([id, v]) => ({ id, p50Ms: v.p50Ms }))
  .sort((a, b) => a.p50Ms - b.p50Ms);

const fast = runnable.slice(0, 5).map((m) => m.id);
const standard = runnable.slice(0, 8).map((m) => m.id);
const quality = runnable
  .filter((m) => /(deepseek|gpt-oss|qwen2.5:14b|nemotron|llama3.1|mistral)/.test(m.id))
  .slice(0, 6)
  .map((m) => m.id);

result.recommendations.research = fast.slice(0, 3);
result.recommendations.build = standard.filter((m) => /(coder|qwen|deepseek|llama)/.test(m)).slice(0, 3);
result.recommendations.critic = standard.filter((m) => /(llama|mistral|qwen|gemma|deepseek)/.test(m)).slice(0, 3);
result.recommendations.integrator = quality.slice(0, 3);
result.recommendations['program-lead'] = quality.filter((m) => /(nemotron|deepseek|gpt-oss)/.test(m)).slice(0, 3);

fs.writeFileSync(outputFile, JSON.stringify(result, null, 2));
console.log(`Wrote latency profile to ${outputFile}`);
NODE
