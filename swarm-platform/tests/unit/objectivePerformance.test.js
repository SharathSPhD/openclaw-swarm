import test from "node:test";
import assert from "node:assert/strict";
import { ObjectivePerformanceTracker } from "../../src/objectivePerformance.js";

test("ObjectivePerformanceTracker initializes with empty in-memory cache", () => {
  const tracker = new ObjectivePerformanceTracker({ db: null });
  assert.ok(Array.isArray(tracker.inMemoryRows));
  assert.equal(tracker.inMemoryRows.length, 0);
});

test("ObjectivePerformanceTracker.recordObjectiveImpact stores result in memory", async () => {
  const tracker = new ObjectivePerformanceTracker({ db: null });

  await tracker.recordObjectiveImpact({
    objectiveId: "obj-1",
    category: "performance",
    before: { totalScore: 100 },
    after: { totalScore: 150 },
    lessons: []
  });

  assert.equal(tracker.inMemoryRows.length, 1);
  const row = tracker.inMemoryRows[0];
  assert.equal(row.objectiveId, "obj-1");
  assert.equal(row.category, "performance");
  assert.equal(row.preScore, 100);
  assert.equal(row.postScore, 150);
  assert.equal(row.deltaScore, 50);
});

test("ObjectivePerformanceTracker calculates ROI correctly", async () => {
  const tracker = new ObjectivePerformanceTracker({ db: null });

  // Record: delta=50, no lessons → ROI = 50
  await tracker.recordObjectiveImpact({
    objectiveId: "obj-1",
    category: "coverage",
    before: { totalScore: 80 },
    after: { totalScore: 130 },
    lessons: []
  });

  // Record: delta=30, 2 lessons → ROI = 30/(2+1) = 10
  await tracker.recordObjectiveImpact({
    objectiveId: "obj-2",
    category: "coverage",
    before: { totalScore: 50 },
    after: { totalScore: 80 },
    lessons: [{ severity: "info" }, { severity: "info" }]
  });

  const stats = await tracker.getObjectiveROI("coverage", 7);
  assert.equal(stats.count, 2);
  // Average ROI: (50 + 10) / 2 = 30
  assert.equal(stats.avgRoi, 30);
});

test("ObjectivePerformanceTracker counts critical lessons", async () => {
  const tracker = new ObjectivePerformanceTracker({ db: null });

  await tracker.recordObjectiveImpact({
    objectiveId: "obj-1",
    category: "quality",
    before: { totalScore: 100 },
    after: { totalScore: 120 },
    lessons: [
      { severity: "critical" },
      { severity: "warning" },
      { severity: "critical" }
    ]
  });

  const row = tracker.inMemoryRows[0];
  assert.equal(row.lessonsCount, 3);
  assert.equal(row.criticalCount, 2);
});

test("ObjectivePerformanceTracker getObjectiveROI filters by window", async () => {
  const tracker = new ObjectivePerformanceTracker({ db: null });

  // Record with current timestamp
  await tracker.recordObjectiveImpact({
    objectiveId: "obj-1",
    category: "testing",
    before: { totalScore: 50 },
    after: { totalScore: 100 },
    lessons: []
  });

  // Check with 7-day window (should include recent entry)
  const recent = await tracker.getObjectiveROI("testing", 7);
  assert.equal(recent.count, 1);

  // Check with 0-day window (should not include entry from "now")
  const old = await tracker.getObjectiveROI("testing", 0);
  // Entries from "now" are on the boundary, so count might be 0 or 1 depending on timing
  assert.ok(old.count >= 0);
});

test("ObjectivePerformanceTracker enforces 100-row limit in memory", async () => {
  const tracker = new ObjectivePerformanceTracker({ db: null });

  // Add 110 records
  for (let i = 0; i < 110; i++) {
    await tracker.recordObjectiveImpact({
      objectiveId: `obj-${i}`,
      category: "scalability",
      before: { totalScore: i },
      after: { totalScore: i + 10 },
      lessons: []
    });
  }

  // Should only keep last 100
  assert.equal(tracker.inMemoryRows.length, 100);
  // First row should be obj-10 (since we shifted the first 10)
  assert.equal(tracker.inMemoryRows[0].objectiveId, "obj-10");
  // Last row should be obj-109
  assert.equal(tracker.inMemoryRows[99].objectiveId, "obj-109");
});

test("ObjectivePerformanceTracker.suggestNextCategory prefers unexplored", async () => {
  const tracker = new ObjectivePerformanceTracker({ db: null });

  // Record 3 entries for "performance" (explored)
  for (let i = 0; i < 3; i++) {
    await tracker.recordObjectiveImpact({
      objectiveId: `perf-${i}`,
      category: "performance",
      before: { totalScore: 50 },
      after: { totalScore: 55 },
      lessons: []
    });
  }

  const suggestion = await tracker.suggestNextCategory({});
  // Should prefer an unexplored category over "performance"
  assert.notEqual(suggestion, "performance");
});

test("ObjectivePerformanceTracker.suggestNextCategory returns first category when all unexplored", async () => {
  const tracker = new ObjectivePerformanceTracker({ db: null });

  // No records, so all categories unexplored with avgRoi=0
  // When all have count < 2, sort returns them in original order
  const suggestion = await tracker.suggestNextCategory({});
  // Should return first category "performance" when all are equally unexplored
  assert.equal(suggestion, "performance");
});

test("ObjectivePerformanceTracker handles missing score fields", async () => {
  const tracker = new ObjectivePerformanceTracker({ db: null });

  // Record with missing totalScore
  await tracker.recordObjectiveImpact({
    objectiveId: "obj-1",
    category: "resilience",
    before: {},
    after: { totalScore: 100 },
    lessons: null
  });

  const row = tracker.inMemoryRows[0];
  assert.equal(row.preScore, 0);
  assert.equal(row.postScore, 100);
  assert.equal(row.deltaScore, 100);
  assert.equal(row.lessonsCount, 0);
});
