import test from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";

const port = 3111;
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
  let ready = false;
  for (let i = 0; i < 12; i++) {
    await wait(300);
    try {
      const res = await fetch(`http://127.0.0.1:${port}/api/health`, { signal: AbortSignal.timeout(2000) });
      if (res.ok) { ready = true; break; }
    } catch { /* retry */ }
  }
  if (!ready) throw new Error("Server did not start");
});

test.after(async () => {
  if (proc) proc.kill("SIGTERM");
  await wait(1000);
});

test("health and dispatch endpoints respond", async () => {
  const h = await fetch(`http://127.0.0.1:${port}/api/health`);
  assert.equal(h.status, 200);

  const d = await fetch(`http://127.0.0.1:${port}/api/orchestrator/dispatch`, {
    method: "POST",
    headers: { "Content-Type": "application/json", "x-api-key": "test-key" },
    body: JSON.stringify({ teamId: "team-alpha", task: "research and build pipeline", actorRole: "team-lead" })
  });
  assert.ok([200, 202].includes(d.status));
  const body = await d.json();
  assert.equal(typeof body.accepted, "boolean");
  if (d.status === 200) assert.equal(body.accepted, true);
});
