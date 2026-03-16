import test from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const port = 3112;
let proc;
let tmpDir;

function wait(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

test.before(async () => {
  // Use an isolated temp data dir so the live swarm's events don't interfere
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "swarm-test-"));
  // Seed with the real teams.json so team-alpha exists
  fs.copyFileSync(path.join(process.cwd(), "data", "teams.json"), path.join(tmpDir, "teams.json"));

  proc = spawn("node", ["src/server.js"], {
    cwd: process.cwd(),
    env: {
      ...process.env,
      PORT: String(port),
      RUNNER_MODE: "mock",
      ADMIN_API_KEY: "test-key",
      SWARM_DATA_DIR: tmpDir
    },
    stdio: ["ignore", "pipe", "pipe"]
  });
  await wait(1500);
});

test.after(async () => {
  if (proc) proc.kill("SIGTERM");
  await wait(500);
  if (tmpDir) fs.rmSync(tmpDir, { recursive: true, force: true });
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
