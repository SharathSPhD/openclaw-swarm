/**
 * Structured Evaluator
 *
 * Builds strict evaluation prompts with schema enforcement and validates
 * evaluation responses. Replaces the ad-hoc fallback parsing in
 * competitiveCoordinator._evaluateOutputs().
 */

const VALID_WINNERS = new Set(["team-alpha", "team-beta"]);

export function buildEvaluationPrompt(alphaOut, betaOut, objective) {
  return `You are the program lead evaluating two teams' outputs for the same objective.

OBJECTIVE:
${objective}

=== TEAM ALPHA OUTPUT ===
${alphaOut}

=== TEAM BETA OUTPUT ===
${betaOut}

EVALUATION CRITERIA: completeness, correctness, quality, and actionability.
Pick the better team. If both failed, pick the one with more useful partial output.

RESPONSE FORMAT: You MUST respond with ONLY the following JSON object, nothing else before or after:
{"winner": "team-alpha", "reasoning": "explanation here", "alphaScore": 7, "betaScore": 5}

RULES:
- "winner" MUST be exactly "team-alpha" or "team-beta" (no other values)
- "reasoning" MUST be a non-empty string
- "alphaScore" and "betaScore" MUST be integers between 0 and 10 inclusive
- NO markdown fences, NO preamble, NO trailing text — ONLY the JSON object

EXAMPLE of valid response:
{"winner": "team-alpha", "reasoning": "Team alpha provided a more complete analysis with specific examples.", "alphaScore": 8, "betaScore": 5}

EXAMPLE of invalid response (DO NOT do this):
Here is my evaluation:
\`\`\`json
{"winner": "team-alpha", ...}
\`\`\``;
}

export function validateEvaluationResponse(obj) {
  if (!obj || typeof obj !== "object") return false;
  if (!VALID_WINNERS.has(obj.winner)) return false;
  if (!obj.reasoning || typeof obj.reasoning !== "string" || obj.reasoning.length === 0) return false;
  const alpha = Number(obj.alphaScore);
  const beta = Number(obj.betaScore);
  if (isNaN(alpha) || alpha < 0 || alpha > 10) return false;
  if (isNaN(beta) || beta < 0 || beta > 10) return false;
  return true;
}

export function extractAndValidate(stdout) {
  if (!stdout) return null;

  // Strategy 1: Direct JSON parse of each line (JSONL)
  const lines = stdout.trim().split("\n").filter(Boolean);
  for (const line of lines) {
    try {
      const obj = JSON.parse(line.trim());
      if (validateEvaluationResponse(obj)) return obj;
    } catch { /* skip */ }
  }

  // Strategy 2: Full text JSON parse
  try {
    const obj = JSON.parse(stdout.trim());
    if (validateEvaluationResponse(obj)) return obj;
  } catch { /* skip */ }

  // Strategy 3: Extract text from openclaw JSON wrapper, then parse
  const extractedText = _extractOpenClawText(stdout);
  if (extractedText && extractedText !== stdout.trim()) {
    for (const line of extractedText.split("\n").filter(Boolean)) {
      try {
        const obj = JSON.parse(line.trim());
        if (validateEvaluationResponse(obj)) return obj;
      } catch { /* skip */ }
    }
    try {
      const obj = JSON.parse(extractedText.trim());
      if (validateEvaluationResponse(obj)) return obj;
    } catch { /* skip */ }
  }

  // Strategy 4: Regex extraction of JSON object containing "winner"
  const jsonRegex = /\{[^{}]*"winner"\s*:\s*"[^"]+?"[^{}]*\}/g;
  let match;
  while ((match = jsonRegex.exec(stdout)) !== null) {
    try {
      const obj = JSON.parse(match[0]);
      if (validateEvaluationResponse(obj)) return obj;
    } catch { /* skip */ }
  }

  // Strategy 5: Strip markdown fence and retry
  const fenceMatch = stdout.match(/```(?:json)?\s*\n?([\s\S]*?)\n?```/);
  if (fenceMatch) {
    try {
      const obj = JSON.parse(fenceMatch[1].trim());
      if (validateEvaluationResponse(obj)) return obj;
    } catch { /* skip */ }
  }

  return null;
}

function _extractOpenClawText(raw) {
  const trimmed = (raw || "").trim();
  if (!trimmed) return "";

  const extractPayload = (obj) => {
    const payloads = obj?.result?.payloads ?? obj?.payloads ?? [];
    for (const p of payloads) {
      if (p?.text) return p.text;
    }
    if (obj?.result?.text) return obj.result.text;
    if (obj?.text) return obj.text;
    return null;
  };

  try {
    const obj = JSON.parse(trimmed);
    const text = extractPayload(obj);
    if (text) return text;
  } catch { /* not whole JSON */ }

  try {
    for (const line of trimmed.split("\n").filter(Boolean)) {
      const obj = JSON.parse(line);
      const text = extractPayload(obj);
      if (text) return text;
    }
  } catch { /* use raw */ }

  return trimmed;
}
