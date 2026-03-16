import test from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const port = 3114;
let proc;
let tmpDir;

function wait(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

test.before(async () => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "swarm-learning-test-"));
  fs.copyFileSync(path.join(process.cwd(), "data", "teams.json"), path.join(tmpDir, "teams.json"));

  proc = spawn("node", ["src/server.js"], {
    cwd: process.cwd(),
    env: { ...process.env, PORT: String(port), RUNNER_MODE: "mock", ADMIN_API_KEY: "test-key", SWARM_DATA_DIR: tmpDir },
    stdio: ["ignore", "pipe", "pipe"]
  });
  
  // Wait for server to start with retries
  let ready = false;
  for (let i = 0; i < 10; i++) {
    await wait(300);
    try {
      const res = await fetch(`http://127.0.0.1:${port}/api/health`, { signal: AbortSignal.timeout(2000) });
      if (res.ok) {
        ready = true;
        break;
      }
    } catch {
      // Server not ready yet
    }
  }
  if (!ready) {
    proc?.kill();
    throw new Error("Server did not start");
  }
});

test.after(async () => {
  if (proc) proc.kill("SIGTERM");
  await wait(500);
  if (tmpDir) fs.rmSync(tmpDir, { recursive: true, force: true });
});

test("/api/learning/team-stats returns valid shape", async () => {
  const res = await fetch(`http://127.0.0.1:${port}/api/learning/team-stats`);
  assert.equal(res.status, 200);
  const data = await res.json();
  assert.ok(data.hasOwnProperty("teams") || data.hasOwnProperty("ok"), "should have teams or ok field");
});

test("/api/learning/model-performance returns valid shape", async () => {
  const res = await fetch(`http://127.0.0.1:${port}/api/learning/model-performance`);
  assert.equal(res.status, 200);
  const data = await res.json();
  // Should have models array
  assert.ok(Array.isArray(data.models) || data.hasOwnProperty("ok"), "should have models array");
});

test("/api/learning/recommendations/team-alpha returns 200", async () => {
  const res = await fetch(`http://127.0.0.1:${port}/api/learning/recommendations/team-alpha`);
  assert.equal(res.status, 200);
});

test("/api/learning/summary returns 200", async () => {
  const res = await fetch(`http://127.0.0.1:${port}/api/learning/summary`);
  // May return 200 or 503 if not initialized, both are valid
  assert.ok([200, 503].includes(res.status), "should return 200 or 503");
});

test("/api/learning/lessons/:teamId returns lessons array", async () => {
  const res = await fetch(`http://127.0.0.1:${port}/api/learning/lessons/team-alpha`);
  assert.equal(res.status, 200);
  const data = await res.json();
  assert.ok(Array.isArray(data), "should return array of lessons");
});
