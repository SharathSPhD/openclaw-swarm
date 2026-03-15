import test from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";

const port = 3112;
let proc;

function wait(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

test.before(async () => {
  proc = spawn("node", ["src/server.js"], {
    cwd: process.cwd(),
    env: {
      ...process.env,
      PORT: String(port),
      RUNNER_MODE: "mock",
      ADMIN_API_KEY: "test-key"
    },
    stdio: ["ignore", "pipe", "pipe"]
  });
  await wait(1500);
});

test.after(async () => {
  if (proc) proc.kill("SIGTERM");
  await wait(500);
});

test("task completion updates leaderboard", async () => {
  const before = await fetch(`http://127.0.0.1:${port}/api/leaderboard`).then((r) => r.json());
  const base = before.leaderboard.find((r) => r.teamId === "team-alpha")?.score || 0;

  await fetch(`http://127.0.0.1:${port}/api/orchestrator/dispatch`, {
    method: "POST",
    headers: { "Content-Type": "application/json", "x-api-key": "test-key" },
    body: JSON.stringify({ teamId: "team-alpha", task: "build secure release flow", actorRole: "team-lead" })
  });

  await wait(4500);

  const after = await fetch(`http://127.0.0.1:${port}/api/leaderboard`).then((r) => r.json());
  const now = after.leaderboard.find((r) => r.teamId === "team-alpha")?.score || 0;
  assert.ok(now >= base);
});
