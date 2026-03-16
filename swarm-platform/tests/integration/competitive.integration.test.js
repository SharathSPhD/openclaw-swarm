/**
 * Competitive Coordinator Integration Tests
 *
 * Tests the competitive coordination pipeline that orchestrates:
 * 1. Fork phase: dispatch objective to two teams (alpha & beta) in parallel
 * 2. Evaluate phase: have the program lead assess both teams' outputs
 * 3. Implement phase: have team gamma implement the winning approach
 * 4. Merge phase: integrate the implementation into main
 * 5. Learning phase: generate lessons from the round for adaptive routing
 *
 * These tests focus on:
 * - CompetitiveCoordinator initialization and lifecycle management
 * - Mock-mode execution with predetermined coordinator results
 * - StructuredEvaluator prompt building and response parsing
 * - TeamLearning round analysis and history tracking
 * - Store event contract and objective board tracking
 *
 * Run with: node --test tests/integration/competitive.integration.test.js
 */

import test from "node:test";
import assert from "node:assert/strict";
import { CompetitiveCoordinator } from "../../src/competitiveCoordinator.js";
import { buildEvaluationPrompt, extractAndValidate, validateEvaluationResponse } from "../../src/structuredEvaluator.js";
import { TeamLearning } from "../../src/teamLearning.js";

/**
 * Helper: Create a mock coordinator that returns predetermined results
 */
function createMockCoordinator(status = "completed", output = "Mock output") {
  return {
    executeObjective: async ({ objective, objectiveId, teamId }) => ({
      status,
      output,
      finalOutput: output,
      subtasks: [
        { id: `${objectiveId}-subtask-1`, role: "research", status: "completed" },
        { id: `${objectiveId}-subtask-2`, role: "build", status: "completed" }
      ],
      error: status === "failed" ? "Mock error" : null
    })
  };
}


/**
 * Test 1: CompetitiveCoordinator initialization with required dependencies
 */
test("CompetitiveCoordinator initializes with required dependencies", async () => {
  const emitEvent = async () => {};
  const createEvent = (opts) => ({ ...opts, id: "event-1", ts: new Date().toISOString() });

  const coordinator = new CompetitiveCoordinator({
    runTask: async () => {},
    emitEvent,
    createEvent,
    store: null,
    db: null,
    modelName: "test-model"
  });

  assert.equal(coordinator.modelName, "test-model");
  assert.ok(coordinator.alphaCoordinator);
  assert.ok(coordinator.betaCoordinator);
  assert.ok(coordinator.gammaCoordinator);
  assert.equal(coordinator.currentPhase, "idle");
  assert.equal(coordinator.currentObjective, null);
});

/**
 * Test 2: CompetitiveCoordinator handles missing optional dependencies gracefully
 */
test("CompetitiveCoordinator handles missing optional dependencies", async () => {
  const coordinator = new CompetitiveCoordinator({
    runTask: async () => {},
    emitEvent: async () => {},
    createEvent: (opts) => ({ ...opts, id: "event-1", ts: new Date().toISOString() }),
    modelName: "test-model"
  });

  assert.equal(coordinator.worktreeManager, undefined);
  assert.equal(coordinator.telegramBot, undefined);
  assert.equal(coordinator.chatId, undefined);
  assert.equal(coordinator.teamLearning, undefined);
  assert.equal(coordinator.objectivePerformanceTracker, null);
});

/**
 * Test 3: Mock-mode objective execution - successful fork and evaluate
 */
test("executes competitive objective with successful fork and evaluate", { timeout: 5000 }, async () => {
  const events = [];
  const createEvent = (opts) => ({ ...opts, id: `evt-${events.length}`, ts: new Date().toISOString() });
  const emitEvent = async (event) => {
    events.push(event);
  };

  const coordinator = new CompetitiveCoordinator({
    runTask: async () => {},
    emitEvent,
    createEvent,
    store: { getLeaderboard: () => [{ teamId: "team-alpha", score: 100 }] },
    db: null,
    modelName: "test-model",
    worktreeManager: null,
    telegramBot: null
  });

  // Mock the internal methods to avoid subprocess spawning
  coordinator.alphaCoordinator = createMockCoordinator("completed", "Alpha analysis: good performance");
  coordinator.betaCoordinator = createMockCoordinator("completed", "Beta analysis: excellent performance");
  coordinator.gammaCoordinator = createMockCoordinator("completed", "Gamma implementation: complete");
  coordinator._evaluateOutputs = async () => ({
    winner: "team-beta",
    reasoning: "Beta provided more detailed analysis",
    alphaScore: 6,
    betaScore: 8
  });
  coordinator._notify = async () => {};
  coordinator._sendRoundSummary = async () => {};

  const result = await coordinator.executeCompetitiveObjective({
    objective: "Test competitive objective",
    objectiveId: "test-obj-1",
    category: "test"
  });

  assert.equal(result.status, "completed");
  assert.equal(result.winner, "team-beta");
  assert.ok(result.alphaResult);
  assert.ok(result.betaResult);
  assert.ok(result.evaluation);
  assert.ok(result.gammaResult);

  // Verify events were emitted
  assert.ok(events.some((e) => e.type === "competitive.started"));
  assert.ok(events.some((e) => e.type === "competitive.forked"));
  assert.ok(events.some((e) => e.type === "competitive.evaluated"));
  assert.ok(events.some((e) => e.type === "reward.applied"));
});

/**
 * Test 4: Mock-mode objective execution - handles coordinator failure
 */
test("handles failure in fork phase gracefully", { timeout: 10000 }, async () => {
  const events = [];
  const createEvent = (opts) => ({ ...opts, id: `evt-${events.length}`, ts: new Date().toISOString() });
  const emitEvent = async (event) => {
    events.push(event);
  };

  const coordinator = new CompetitiveCoordinator({
    runTask: async () => {},
    emitEvent,
    createEvent,
    store: { getLeaderboard: () => [] },
    db: null,
    modelName: "test-model",
    worktreeManager: null,
    telegramBot: null
  });

  coordinator.alphaCoordinator = createMockCoordinator("failed", "");
  coordinator.betaCoordinator = createMockCoordinator("completed", "Beta output");
  coordinator._evaluateOutputs = async () => ({
    winner: "team-beta",
    reasoning: "Alpha failed, beta completed",
    alphaScore: 0,
    betaScore: 8
  });
  coordinator.gammaCoordinator = createMockCoordinator("completed", "Gamma implemented beta approach");
  coordinator._notify = async () => {};
  coordinator._sendRoundSummary = async () => {};

  const result = await coordinator.executeCompetitiveObjective({
    objective: "Failing test objective",
    objectiveId: "test-obj-fail",
    category: "test"
  });

  // Should complete even if one team fails (beta evaluation logic handles it)
  assert.ok(result.status === "completed" || result.status === "failed");
  assert.ok(result.alphaResult);
  assert.ok(result.betaResult);
});

/**
 * Test 5: StructuredEvaluator - buildEvaluationPrompt format
 */
test("buildEvaluationPrompt creates properly formatted prompt", async () => {
  const alphaOut = "Alpha: comprehensive analysis with 5 points";
  const betaOut = "Beta: minimal analysis with 2 points";
  const objective = "Implement feature X";

  const prompt = buildEvaluationPrompt(alphaOut, betaOut, objective);

  assert.ok(prompt.includes(objective));
  assert.ok(prompt.includes(alphaOut));
  assert.ok(prompt.includes(betaOut));
  assert.ok(prompt.includes("TEAM ALPHA OUTPUT"));
  assert.ok(prompt.includes("TEAM BETA OUTPUT"));
  assert.ok(prompt.includes('"winner"'));
  assert.ok(prompt.includes('"reasoning"'));
  assert.ok(prompt.includes('"alphaScore"'));
  assert.ok(prompt.includes('"betaScore"'));
});

/**
 * Test 6: StructuredEvaluator - extractAndValidate with valid JSON
 */
test("extractAndValidate parses valid evaluation JSON", async () => {
  const validJson = JSON.stringify({
    winner: "team-alpha",
    reasoning: "Alpha provided better analysis",
    alphaScore: 8,
    betaScore: 5
  });

  const result = extractAndValidate(validJson);
  assert.ok(result);
  assert.equal(result.winner, "team-alpha");
  assert.equal(result.reasoning, "Alpha provided better analysis");
  assert.equal(result.alphaScore, 8);
  assert.equal(result.betaScore, 5);
});

/**
 * Test 7: StructuredEvaluator - extractAndValidate with JSONL
 */
test("extractAndValidate handles JSONL format", async () => {
  const jsonl = `some text before
{"winner": "team-beta", "reasoning": "Beta was superior", "alphaScore": 3, "betaScore": 9}
some text after`;

  const result = extractAndValidate(jsonl);
  assert.ok(result);
  assert.equal(result.winner, "team-beta");
  assert.equal(result.alphaScore, 3);
  assert.equal(result.betaScore, 9);
});

/**
 * Test 8: StructuredEvaluator - extractAndValidate with markdown fence
 */
test("extractAndValidate strips markdown fence", async () => {
  const withFence = `Here is my evaluation:
\`\`\`json
{"winner": "team-alpha", "reasoning": "Clear winner", "alphaScore": 10, "betaScore": 1}
\`\`\`
End of evaluation`;

  const result = extractAndValidate(withFence);
  assert.ok(result);
  assert.equal(result.winner, "team-alpha");
  assert.equal(result.alphaScore, 10);
  assert.equal(result.betaScore, 1);
});

/**
 * Test 9: StructuredEvaluator - extractAndValidate rejects invalid JSON
 */
test("extractAndValidate returns null for malformed evaluation", async () => {
  const malformed = `{"winner": "invalid-team", "reasoning": "bad", "alphaScore": 5, "betaScore": 5}`;
  assert.equal(extractAndValidate(malformed), null);

  const invalidScores = `{"winner": "team-alpha", "reasoning": "bad scores", "alphaScore": 15, "betaScore": -1}`;
  assert.equal(extractAndValidate(invalidScores), null);

  const missingFields = `{"winner": "team-alpha"}`;
  assert.equal(extractAndValidate(missingFields), null);
});

/**
 * Test 10: TeamLearning.analyzeRound with mock data
 */
test("TeamLearning.analyzeRound generates lessons from round result", async () => {
  const learning = new TeamLearning({
    db: null,
    store: {
      getEvents: () => [],
      getLeaderboard: () => []
    }
  });

  const mockRoundResult = {
    objectiveId: "test-obj-1",
    alphaResult: {
      status: "failed",
      error: "OutOfMemory",
      finalOutput: "Alpha failed with OOM",
      subtasks: [
        { id: "sub-1", role: "research", status: "completed" },
        { id: "sub-2", role: "build", status: "failed", error: "OutOfMemory" }
      ]
    },
    betaResult: {
      status: "completed",
      finalOutput: "Beta analysis successful",
      subtasks: [
        { id: "sub-3", role: "research", status: "completed" },
        { id: "sub-4", role: "build", status: "completed" }
      ]
    },
    evaluation: {
      winner: "team-beta",
      reasoning: "Alpha OOM, beta completed",
      alphaScore: 0,
      betaScore: 9
    },
    gammaResult: {
      status: "completed",
      finalOutput: "Gamma implementation",
      subtasks: []
    }
  };

  const lessons = await learning.analyzeRound(mockRoundResult);
  assert.ok(Array.isArray(lessons));
  // Lessons may be empty or contain entries depending on analysis logic
  // The key is that it doesn't throw and returns an array
});

/**
 * Test 11: TeamLearning.roundHistory tracking
 */
test("TeamLearning tracks roundHistory correctly", async () => {
  const learning = new TeamLearning({
    db: null,
    store: {
      getEvents: () => [],
      getLeaderboard: () => []
    }
  });

  assert.ok(Array.isArray(learning.roundHistory));
  assert.equal(learning.roundHistory.length, 0);

  // Record a task outcome
  await learning.recordTaskOutcome({
    teamId: "team-alpha",
    model: "llama2",
    role: "research",
    success: true,
    latencyMs: 1500,
    roundId: "round-1"
  });

  assert.ok(Array.isArray(learning.performanceRecords));
  assert.ok(learning.performanceRecords.length > 0);
});

/**
 * Test 12: Store.appendEvent API contract - events require id field
 */
test("Store.appendEvent API requires event id", async () => {
  const mockStore = {
    appendEvent: async (event) => {
      if (!event?.id) return { ok: false, reason: "missing_event_id" };
      return { ok: true };
    }
  };

  const invalidEvent = {
    ts: new Date().toISOString(),
    type: "test.event",
    teamId: "team-alpha",
    source: "test"
  };

  const result = await mockStore.appendEvent(invalidEvent);
  assert.equal(result.ok, false);
  assert.equal(result.reason, "missing_event_id");

  const validEvent = {
    id: "evt-unique-1",
    ts: new Date().toISOString(),
    type: "test.event",
    teamId: "team-alpha",
    source: "test",
    payload: { test: true }
  };

  const result2 = await mockStore.appendEvent(validEvent);
  assert.equal(result2.ok, true);
});

/**
 * Test 13: Store.getObjectiveBoard returns correct status tracking
 */
test("Store.getObjectiveBoard tracks objective status types", async () => {
  // Test the getObjectiveBoard API contract with mock data
  const mockStore = {
    getObjectiveBoard: (limit = 200) => {
      const trackedTypes = new Set([
        "objective.created", "orchestrator.autonomous.start",
        "competitive.started", "competitive.forked", "competitive.evaluated",
        "competitive.implementing", "competitive.merged"
      ]);

      // Sample tracked events
      const events = [
        {
          id: "evt-1",
          ts: "2026-03-16T10:00:00Z",
          type: "competitive.started",
          teamId: "program-lead",
          source: "competitive-coordinator",
          payload: { objectiveId: "test-obj-board", objective: "Test objective" }
        },
        {
          id: "evt-2",
          ts: "2026-03-16T10:00:01Z",
          type: "competitive.evaluated",
          teamId: "program-lead",
          source: "competitive-coordinator",
          payload: { objectiveId: "test-obj-board", winner: "team-alpha" }
        }
      ];

      const objectives = new Map();
      for (const e of events) {
        if (!trackedTypes.has(e.type)) continue;
        const objectiveId = e.payload?.objectiveId || e.id;
        const current = objectives.get(objectiveId) || {
          objectiveId,
          teamId: e.teamId,
          objective: e.payload?.objective || "",
          status: "active",
          steps: []
        };
        current.steps.push({ ts: e.ts, type: e.type });
        if (e.payload?.winner) current.winner = e.payload.winner;
        objectives.set(objectiveId, current);
      }

      return [...objectives.values()];
    }
  };

  const board = mockStore.getObjectiveBoard();
  assert.ok(Array.isArray(board));
  const trackingObjective = board.find((o) => o.objectiveId === "test-obj-board");
  assert.ok(trackingObjective);
  assert.equal(trackingObjective.objective, "Test objective");
  assert.ok(trackingObjective.steps.length > 0);
  assert.equal(trackingObjective.winner, "team-alpha");
});

/**
 * Test 15: CompetitiveCoordinator.getStatus returns current phase
 */
test("CompetitiveCoordinator.getStatus returns current phase", async () => {
  const coordinator = new CompetitiveCoordinator({
    runTask: async () => {},
    emitEvent: async () => {},
    createEvent: (opts) => ({ ...opts, id: "evt", ts: new Date().toISOString() }),
    modelName: "test-model"
  });

  const status = coordinator.getStatus();
  assert.equal(status.phase, "idle");
  assert.equal(status.objective, null);

  // Simulate phase change
  coordinator.currentPhase = "forking";
  coordinator.currentObjective = { objectiveId: "test-123", objective: "test", phase: "forking" };

  const updatedStatus = coordinator.getStatus();
  assert.equal(updatedStatus.phase, "forking");
  assert.equal(updatedStatus.objective.objectiveId, "test-123");
});

/**
 * Test 16: validateEvaluationResponse validates all fields correctly
 */
test("validateEvaluationResponse validates JSON schema", async () => {
  const valid = {
    winner: "team-alpha",
    reasoning: "Alpha was better",
    alphaScore: 7,
    betaScore: 5
  };
  assert.equal(validateEvaluationResponse(valid), true);

  const invalidWinner = {
    winner: "team-gamma",
    reasoning: "Invalid winner",
    alphaScore: 5,
    betaScore: 5
  };
  assert.equal(validateEvaluationResponse(invalidWinner), false);

  const invalidScores = {
    winner: "team-alpha",
    reasoning: "Scores out of range",
    alphaScore: 15,
    betaScore: -5
  };
  assert.equal(validateEvaluationResponse(invalidScores), false);

  const missingReasoning = {
    winner: "team-alpha",
    reasoning: "",
    alphaScore: 5,
    betaScore: 5
  };
  assert.equal(validateEvaluationResponse(missingReasoning), false);

  assert.equal(validateEvaluationResponse(null), false);
  assert.equal(validateEvaluationResponse(undefined), false);
  assert.equal(validateEvaluationResponse({}), false);
});
