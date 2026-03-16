import test from "node:test";
import assert from "node:assert/strict";
import { buildEvaluationPrompt, validateEvaluationResponse, extractAndValidate } from "../../src/structuredEvaluator.js";

test("buildEvaluationPrompt includes objective and both outputs", () => {
  const prompt = buildEvaluationPrompt(
    "Team A output here",
    "Team B output here",
    "Improve system performance"
  );
  assert.match(prompt, /Improve system performance/);
  assert.match(prompt, /Team A output here/);
  assert.match(prompt, /Team B output here/);
  assert.match(prompt, /TEAM ALPHA OUTPUT/);
  assert.match(prompt, /TEAM BETA OUTPUT/);
});

test("validateEvaluationResponse rejects null or non-object", () => {
  assert.equal(validateEvaluationResponse(null), false);
  assert.equal(validateEvaluationResponse("string"), false);
  assert.equal(validateEvaluationResponse(undefined), false);
  assert.equal(validateEvaluationResponse(123), false);
});

test("validateEvaluationResponse accepts valid evaluation object", () => {
  const valid = {
    winner: "team-alpha",
    reasoning: "Team alpha was more complete",
    alphaScore: 8,
    betaScore: 5
  };
  assert.equal(validateEvaluationResponse(valid), true);
});

test("validateEvaluationResponse rejects invalid winner value", () => {
  const obj = {
    winner: "team-gamma",
    reasoning: "test",
    alphaScore: 5,
    betaScore: 5
  };
  assert.equal(validateEvaluationResponse(obj), false);
});

test("validateEvaluationResponse rejects missing or empty reasoning", () => {
  const noReasoning = {
    winner: "team-alpha",
    reasoning: "",
    alphaScore: 5,
    betaScore: 5
  };
  assert.equal(validateEvaluationResponse(noReasoning), false);

  const missingReasoning = {
    winner: "team-beta",
    alphaScore: 5,
    betaScore: 5
  };
  assert.equal(validateEvaluationResponse(missingReasoning), false);
});

test("validateEvaluationResponse rejects scores outside 0-10 range", () => {
  const alphaTooHigh = {
    winner: "team-alpha",
    reasoning: "test",
    alphaScore: 11,
    betaScore: 5
  };
  assert.equal(validateEvaluationResponse(alphaTooHigh), false);

  const betaNegative = {
    winner: "team-beta",
    reasoning: "test",
    alphaScore: 5,
    betaScore: -1
  };
  assert.equal(validateEvaluationResponse(betaNegative), false);
});

test("extractAndValidate handles null/empty input", () => {
  assert.equal(extractAndValidate(null), null);
  assert.equal(extractAndValidate(""), null);
  assert.equal(extractAndValidate("   "), null);
});

test("extractAndValidate extracts valid JSON from direct response", () => {
  const response = '{"winner": "team-alpha", "reasoning": "better output", "alphaScore": 9, "betaScore": 3}';
  const result = extractAndValidate(response);
  assert.deepEqual(result, {
    winner: "team-alpha",
    reasoning: "better output",
    alphaScore: 9,
    betaScore: 3
  });
});

test("extractAndValidate extracts JSON from JSONL format", () => {
  const response = `some text
{"winner": "team-beta", "reasoning": "superior analysis", "alphaScore": 4, "betaScore": 7}
more text`;
  const result = extractAndValidate(response);
  assert.equal(result.winner, "team-beta");
  assert.equal(result.betaScore, 7);
});

test("extractAndValidate handles markdown-fenced JSON", () => {
  const response = `Here is the evaluation:
\`\`\`json
{"winner": "team-alpha", "reasoning": "clear winner", "alphaScore": 10, "betaScore": 2}
\`\`\``;
  const result = extractAndValidate(response);
  assert.equal(result.winner, "team-alpha");
  assert.equal(result.alphaScore, 10);
});

test("extractAndValidate rejects invalid JSON even if structure looks right", () => {
  const response = '{"winner": "team-invalid", "reasoning": "test", "alphaScore": 5, "betaScore": 5}';
  const result = extractAndValidate(response);
  assert.equal(result, null);
});

test("extractAndValidate handles multiple JSON objects and returns first valid one", () => {
  const response = `{"winner": "invalid-team", "reasoning": "x", "alphaScore": 5, "betaScore": 5}
{"winner": "team-alpha", "reasoning": "good", "alphaScore": 8, "betaScore": 4}`;
  const result = extractAndValidate(response);
  assert.equal(result.winner, "team-alpha");
});
