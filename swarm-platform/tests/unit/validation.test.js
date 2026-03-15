import test from "node:test";
import assert from "node:assert/strict";
import { validateDispatchBody } from "../../src/validation.js";

test("dispatch body requires teamId and task", () => {
  const ok = validateDispatchBody({ teamId: "team-alpha", task: "build secure queue" });
  assert.equal(ok.ok, true);

  const bad = validateDispatchBody({ teamId: "", task: "x" });
  assert.equal(bad.ok, false);
});
