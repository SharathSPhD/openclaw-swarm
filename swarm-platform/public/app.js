const state = {
  teams: [],
  chats: [],
  controlKey: sessionStorage.getItem("swarmAdminKey") || "",
  page: document.body.dataset.page || "command-center"
};

const els = {
  loadState: document.getElementById("loadState"),
  agentBudget: document.getElementById("agentBudget"),
  gpuState: document.getElementById("gpuState"),
  runnerMode: document.getElementById("runnerMode"),
  adminState: document.getElementById("adminState"),
  teamId: document.getElementById("teamId"),
  actorRole: document.getElementById("actorRole"),
  taskText: document.getElementById("taskText"),
  dispatchForm: document.getElementById("dispatchForm"),
  autonomyForm: document.getElementById("autonomyForm"),
  objectiveText: document.getElementById("objectiveText"),
  rounds: document.getElementById("rounds"),
  teamControlForm: document.getElementById("teamControlForm"),
  controlAction: document.getElementById("controlAction"),
  dispatchResult: document.getElementById("dispatchResult"),
  unlockControls: document.getElementById("unlockControls"),
  lockControls: document.getElementById("lockControls"),
  agentsBody: document.getElementById("agentsBody"),
  modelsBody: document.getElementById("modelsBody"),
  roleMatrixBody: document.getElementById("roleMatrixBody"),
  objectivesBody: document.getElementById("objectivesBody"),
  flowBody: document.getElementById("flowBody"),
  events: document.getElementById("events"),
  chatTeamFilter: document.getElementById("chatTeamFilter"),
  teamChats: document.getElementById("teamChats"),
  telegramBody: document.getElementById("telegramBody"),
  rewardPenalty: document.getElementById("rewardPenalty"),
  openclawInfo: document.getElementById("openclawInfo"),
  gpuDetail: document.getElementById("gpuDetail"),
  leaderboardBody: document.getElementById("leaderboardBody"),
  auditBody: document.getElementById("auditBody"),
  opsModelBody: document.getElementById("opsModelBody"),
  opsQueueBody: document.getElementById("opsQueueBody")
};

function authHeaders() {
  const headers = { "Content-Type": "application/json" };
  if (state.controlKey) headers["x-api-key"] = state.controlKey;
  return headers;
}

function updateControlStatus(required) {
  if (!els.adminState) return;
  const unlocked = Boolean(state.controlKey);
  els.adminState.textContent = required ? `controls: ${unlocked ? "unlocked" : "locked"}` : "controls: open";
}

function formatTime(ts) {
  return ts ? new Date(ts).toLocaleTimeString() : "-";
}

function setHeader(data) {
  if (els.loadState) els.loadState.textContent = `load: ${data.loadState}`;
  if (els.agentBudget) els.agentBudget.textContent = `agents: ${data.activeAgents}/${data.maxActiveAgents} queue:${data.queueDepth ?? 0}`;
  if (els.runnerMode) els.runnerMode.textContent = `runner: ${data.runnerMode || "unknown"}`;
  updateControlStatus(Boolean(data.adminKeyRequired));

  const gpu = data.system?.gpu;
  if (gpu?.available) {
    const memLabel = Number.isFinite(gpu.usedPct) ? `${gpu.usedPct}% mem` : "mem n/a";
    const localLabel = gpu.localGpuBacked ? "local-gpu active" : "local-gpu idle";
    if (els.gpuState) els.gpuState.textContent = `gpu: ${memLabel}, ${gpu.utilPct}% util (${gpu.gpus} gpu) ${localLabel}`;
  } else if (els.gpuState) {
    els.gpuState.textContent = "gpu: unavailable";
  }

  if (els.gpuDetail) {
    if (!gpu?.available) {
      els.gpuDetail.textContent = "No GPU telemetry available.";
      return;
    }
    const lines = [
      `overall mem: ${gpu.usedMb ?? "n/a"} / ${gpu.totalMb ?? "n/a"} MB (${Number.isFinite(gpu.usedPct) ? gpu.usedPct : "n/a"}%)`,
      `overall util: ${gpu.utilPct ?? "n/a"}%`,
      `local GPU-backed model runtime: ${gpu.localGpuBacked ? "yes" : "no"}`,
      "",
      "devices:"
    ];
    for (const d of gpu.devices || []) {
      lines.push(`gpu${d.index}: mem=${d.usedMb ?? "n/a"}/${d.totalMb ?? "n/a"}MB util=${d.utilPct ?? "n/a"}% temp=${d.tempC ?? "n/a"}C power=${d.powerW ?? "n/a"}W`);
    }
    lines.push("", "active compute processes:");
    if ((gpu.processes || []).length === 0) {
      lines.push("none");
    } else {
      for (const p of gpu.processes) {
        lines.push(`pid=${p.pid ?? "n/a"} proc=${p.process} mem=${p.usedMb ?? "n/a"}MB gpu=${p.gpu}`);
      }
    }
    lines.push("", "ollama runtime:");
    if ((gpu.ollamaRuntime || []).length === 0) {
      lines.push("none");
    } else {
      for (const r of gpu.ollamaRuntime) {
        lines.push(`model=${r.model} processor=${r.processor} context=${r.context} until=${r.until}`);
      }
    }
    lines.push("", "ollama run processes:");
    if ((gpu.ollamaRunProcesses || []).length === 0) {
      lines.push("none");
    } else {
      for (const p of gpu.ollamaRunProcesses) {
        lines.push(`pid=${p.pid ?? "n/a"} cmd=${p.cmd}`);
      }
    }
    els.gpuDetail.textContent = lines.join("\n");
  }
}

function hydrateTeams(teams) {
  state.teams = teams;
  const opts = teams.map((t) => `<option value="${t.id}">${t.name}</option>`).join("");
  if (els.teamId) els.teamId.innerHTML = opts;
  if (els.chatTeamFilter) els.chatTeamFilter.innerHTML = `<option value="">all teams</option>${opts}`;
}

function renderAgents(payload) {
  if (!els.agentsBody) return;
  const agents = payload?.active || [];
  els.agentsBody.innerHTML = agents
    .map(
      (a) => `<tr>
      <td>${a.agentId || "n/a"}</td>
      <td>${a.teamId}</td>
      <td>${a.role || "n/a"}</td>
      <td>${a.status || "n/a"}</td>
      <td>${a.model || "n/a"} (${a.modelTier || "n/a"})</td>
      <td>${Number.isFinite(a.estimatedLatencyMs) ? `${a.estimatedLatencyMs} ms` : "n/a"}</td>
      <td>${(a.task || "").slice(0, 90)}</td>
    </tr>`
    )
    .join("");
}

function renderRoleMatrix(payload) {
  if (!els.roleMatrixBody) return;
  const routes = payload?.routing?.roleRoutes || {};
  els.roleMatrixBody.innerHTML = Object.entries(routes)
    .map(([role, route]) => `<tr><td>${role}</td><td>${route.tier || "n/a"}</td><td>${route.primary || "n/a"}</td><td>${(route.fallback || []).join(", ") || "-"}</td></tr>`)
    .join("");
}

function renderModels(payload) {
  if (!els.modelsBody) return;
  const models = payload?.inventory?.models || [];
  const routes = payload?.routing?.roleRoutes || {};
  const lat = payload?.latency?.models || {};
  const caps = payload?.capabilities?.models || {};

  const modelHints = {};
  Object.entries(routes).forEach(([role, route]) => {
    if (route?.primary) modelHints[route.primary] = `${route.tier || "n/a"}/${role}`;
  });

  els.modelsBody.innerHTML = models
    .map((m) => {
      const key = m.id?.toLowerCase?.() || "";
      const hint = modelHints[m.id] || "-";
      const p50 = lat?.[key]?.p50Ms ?? caps?.[key]?.estimatedP50Ms;
      const source = lat?.[key]?.source || (caps?.[key] ? "web_estimate" : "none");
      return `<tr><td>${m.id}</td><td>${m.size || "n/a"}</td><td>${hint}</td><td>${Number.isFinite(p50) ? `${p50} ms (${source})` : "n/a"}</td><td>${m.modified || "n/a"}</td></tr>`;
    })
    .join("");
}

function renderObjectives(payload) {
  if (!els.objectivesBody) return;
  const rows = payload?.objectives || [];
  els.objectivesBody.innerHTML = rows
    .slice(0, 120)
    .map((o) => `<tr><td>${(o.objective || "").slice(0, 110)}</td><td>${o.teamId || "n/a"}</td><td>${o.status || "active"}</td><td>${formatTime(o.updatedAt)}</td></tr>`)
    .join("");
}

function renderFlow(payload) {
  if (!els.flowBody) return;
  const rows = payload?.flow || [];
  els.flowBody.innerHTML = rows
    .slice(0, 180)
    .map((r) => `<tr>
      <td>${r.taskId.slice(0, 8)}</td>
      <td>${(r.objective || r.task || "").slice(0, 80)}</td>
      <td>${r.teamId}</td>
      <td>${r.role}</td>
      <td>${r.status}</td>
      <td>${r.model || "n/a"} (${r.modelTier || "n/a"})</td>
      <td>${r.internalMessages}</td>
      <td>${r.telegramUpdates}</td>
      <td>${formatTime(r.lastUpdate)}</td>
    </tr>`)
    .join("");
}

function renderEvents(events) {
  if (!els.events) return;
  const last = [...(events || [])].reverse().slice(0, 180);
  els.events.innerHTML = last
    .map((e) => `<li>[${formatTime(e.ts)}] ${e.teamId} :: ${e.type} ${e.payload?.taskId ? `(task ${e.payload.taskId.slice(0, 8)})` : ""}</li>`)
    .join("");
}

function renderChats(chats) {
  if (!els.teamChats) return;
  const filter = els.chatTeamFilter?.value || "";
  const rows = (chats || []).filter((c) => !filter || c.teamId === filter).slice(-220).reverse();
  els.teamChats.innerHTML = rows
    .map((c) => `<li>[${formatTime(c.ts)}] [${c.teamId}] ${c.from} -> ${c.to}: ${c.text}</li>`)
    .join("");
}

function renderTelegram(proof) {
  if (!els.telegramBody) return;
  els.telegramBody.innerHTML = (proof || [])
    .slice(-120)
    .reverse()
    .map(
      (p) => `<tr>
      <td>${formatTime(p.ts)}</td>
      <td>${p.teamId}</td>
      <td>${p.type}</td>
      <td>${p.taskId ? p.taskId.slice(0, 8) : "n/a"}</td>
      <td>${p.chatId || "n/a"}</td>
      <td>${p.messageId || p.reason || "n/a"}</td>
    </tr>`
    )
    .join("");
}

function renderRewardPenalty(snapshot) {
  if (!els.rewardPenalty) return;
  const rows = snapshot.leaderboard || [];
  els.rewardPenalty.innerHTML = rows
    .map((r) => `<li>${r.teamName}: score=${r.score}, accuracy=${(r.accuracy * 100).toFixed(1)}%, completed=${r.completed}, penalties=${r.penalties}</li>`)
    .join("");
}

function renderOpenClaw(openclaw) {
  if (!els.openclawInfo) return;
  const lines = [
    `gateway: ${openclaw.gatewayUrl}`,
    `canvas: ${openclaw.canvasUrl}`,
    `ssh: ${openclaw.sshTunnelHint}`,
    `web_search: enabled=${openclaw.webSearch?.enabled} provider=${openclaw.webSearch?.provider || "n/a"} configured=${openclaw.webSearch?.configured}`,
    `sandbox: mode=${openclaw.sandbox?.mode || "n/a"} scope=${openclaw.sandbox?.scope || "n/a"} browser=${openclaw.sandbox?.browserEnabled} configured=${openclaw.sandbox?.configured}`,
    `telegram: configured=${openclaw.telegram?.configured} channelEnabled=${openclaw.telegram?.channelEnabled}`
  ];
  els.openclawInfo.textContent = lines.join("\n");
}

function renderLeaderboard(rows = []) {
  if (!els.leaderboardBody) return;
  els.leaderboardBody.innerHTML = rows
    .map((r) => `<tr><td>${r.rank}</td><td>${r.teamName}</td><td>${r.score}</td><td>${(r.accuracy * 100).toFixed(1)}%</td><td>${r.completed}</td><td>${r.penalties}</td></tr>`)
    .join("");
}

function renderAudit(rows = []) {
  if (!els.auditBody) return;
  els.auditBody.innerHTML = rows
    .slice(-400)
    .reverse()
    .map((r) => `<tr><td>${formatTime(r.ts)}</td><td>${r.teamId}</td><td>${r.type}</td><td>${r.taskId ? r.taskId.slice(0, 8) : "-"}</td><td>${r.source}</td><td>${(r.detail || "").toString().slice(0, 120)}</td></tr>`)
    .join("");
}

function renderOps(payload = {}) {
  if (els.opsModelBody) {
    const lat = payload.modelLatency?.models || {};
    const caps = payload.modelCapabilities?.models || {};
    const keys = [...new Set([...Object.keys(caps), ...Object.keys(lat)])];
    els.opsModelBody.innerHTML = keys
      .map((model) => {
        const row = lat[model] || {};
        const cap = caps[model] || {};
        const p50 = row.p50Ms ?? cap.estimatedP50Ms ?? "n/a";
        const avg = row.avgMs ?? cap.estimatedAvgMs ?? "n/a";
        const status = row.runnable === false ? "degraded" : "ok";
        return `<tr><td>${model}</td><td>${p50}</td><td>${avg}</td><td>${status}</td></tr>`;
      })
      .join("");
  }
  if (els.opsQueueBody) {
    els.opsQueueBody.innerHTML = (payload.queue?.items || [])
      .map((q) => `<tr><td>${q.teamId}</td><td>${q.role}</td><td>${(q.task || "").slice(0, 70)}</td><td>${q.priority}</td></tr>`)
      .join("");
  }
}

async function fetchJson(url) {
  const res = await fetch(url);
  return res.json();
}

async function refreshCommandCenter() {
  const teamFilter = els.chatTeamFilter?.value ? `?teamId=${encodeURIComponent(els.chatTeamFilter.value)}` : "";
  const [snapshot, agents, chats, tele, models, openclaw, objectives, flow] = await Promise.all([
    fetchJson("/api/snapshot"),
    fetchJson("/api/agents"),
    fetchJson("/api/chats" + teamFilter),
    fetchJson("/api/telegram"),
    fetchJson("/api/models"),
    fetchJson("/api/openclaw"),
    fetchJson("/api/objectives"),
    fetchJson("/api/flow" + teamFilter)
  ]);

  hydrateTeams(snapshot.teams || []);
  setHeader(snapshot);
  renderAgents(agents);
  renderRoleMatrix(models);
  renderModels(models);
  state.chats = chats.chats || [];
  renderChats(state.chats);
  renderTelegram(tele.proof || []);
  renderObjectives(objectives);
  renderFlow(flow);
  renderRewardPenalty(snapshot);
  renderEvents(snapshot.events || []);
  renderOpenClaw(openclaw);
}

async function refreshTimelinePage() {
  const [snapshot, flow, objectives] = await Promise.all([
    fetchJson("/api/snapshot"),
    fetchJson("/api/flow"),
    fetchJson("/api/objectives")
  ]);
  setHeader(snapshot);
  renderFlow(flow);
  renderObjectives(objectives);
  renderEvents(snapshot.events || []);
}

async function refreshAuditPage() {
  const [snapshot, audit] = await Promise.all([fetchJson("/api/snapshot"), fetchJson("/api/audit")]);
  setHeader(snapshot);
  renderAudit(audit.audit || []);
}

async function refreshOpsPage() {
  const [snapshot, ops] = await Promise.all([fetchJson("/api/snapshot"), fetchJson("/api/ops")]);
  setHeader(snapshot);
  renderOps(ops);
}

async function refreshLeaderboardPage() {
  const [snapshot, data] = await Promise.all([fetchJson("/api/snapshot"), fetchJson("/api/leaderboard")]);
  setHeader(snapshot);
  renderLeaderboard(data.leaderboard || []);
}

async function refreshByPage() {
  if (state.page === "timeline") return refreshTimelinePage();
  if (state.page === "audit") return refreshAuditPage();
  if (state.page === "ops") return refreshOpsPage();
  if (state.page === "leaderboard") return refreshLeaderboardPage();
  return refreshCommandCenter();
}

if (els.unlockControls) {
  els.unlockControls.addEventListener("click", () => {
    const key = prompt("Enter admin API key to unlock write actions");
    if (key && key.trim()) {
      state.controlKey = key.trim();
      sessionStorage.setItem("swarmAdminKey", state.controlKey);
      updateControlStatus(true);
    }
  });
}

if (els.lockControls) {
  els.lockControls.addEventListener("click", () => {
    state.controlKey = "";
    sessionStorage.removeItem("swarmAdminKey");
    updateControlStatus(true);
  });
}

if (els.chatTeamFilter) {
  els.chatTeamFilter.addEventListener("change", () => {
    renderChats(state.chats || []);
    refreshByPage();
  });
}

if (els.dispatchForm) {
  els.dispatchForm.addEventListener("submit", async (e) => {
    e.preventDefault();
    const payload = {
      teamId: els.teamId.value,
      task: els.taskText.value.trim(),
      actorRole: els.actorRole?.value || "program-lead"
    };
    const res = await fetch("/api/orchestrator/dispatch", { method: "POST", headers: authHeaders(), body: JSON.stringify(payload) });
    const data = await res.json();
    if (els.dispatchResult) els.dispatchResult.textContent = JSON.stringify(data, null, 2);
    await refreshByPage();
  });
}

if (els.autonomyForm) {
  els.autonomyForm.addEventListener("submit", async (e) => {
    e.preventDefault();
    const payload = {
      teamId: els.teamId.value,
      objective: els.objectiveText.value.trim(),
      rounds: Number(els.rounds.value || 4)
    };
    const res = await fetch("/api/orchestrator/autonomous-run", { method: "POST", headers: authHeaders(), body: JSON.stringify(payload) });
    const data = await res.json();
    if (els.dispatchResult) els.dispatchResult.textContent = JSON.stringify(data, null, 2);
    await refreshByPage();
  });
}

if (els.teamControlForm) {
  els.teamControlForm.addEventListener("submit", async (e) => {
    e.preventDefault();
    const payload = { teamId: els.teamId.value, action: els.controlAction.value };
    const res = await fetch("/api/control/team", { method: "POST", headers: authHeaders(), body: JSON.stringify(payload) });
    const data = await res.json();
    if (els.dispatchResult) els.dispatchResult.textContent = JSON.stringify(data, null, 2);
    await refreshByPage();
  });
}

function connectWs() {
  const wsProtocol = location.protocol === "https:" ? "wss" : "ws";
  const ws = new WebSocket(`${wsProtocol}://${location.host}`);
  ws.addEventListener("message", async () => {
    await refreshByPage();
  });
  ws.addEventListener("close", () => setTimeout(connectWs, 1000));
}

await refreshByPage();
connectWs();
setInterval(refreshByPage, 5000);
