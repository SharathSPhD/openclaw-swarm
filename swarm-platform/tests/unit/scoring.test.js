import test from "node:test";
import assert from "node:assert/strict";
import { calculateScoreDelta } from "../../src/scoring.js";

test("scoring gives positive score for strong completion", () => {
  const score = calculateScoreDelta({
    type: "task.completed",
    payload: {
      correctness: 0.95,
      speed: 0.8,
      efficiency: 0.82,
      firstPass: true,
      reproducible: true,
      resourcePenalty: 0
    }
  });
  assert.ok(score > 130);
});

test("penalty event is negative", () => {
  const delta = calculateScoreDelta({ type: "penalty.applied", payload: { pointsDeducted: 30 } });
  assert.equal(delta, -30);
});
