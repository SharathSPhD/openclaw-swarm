import { useState } from "react";
import { postApi } from "../hooks/useApi";
import type { SnapshotResponse, WsMessage, AgentInfo, SwarmEvent } from "../types";

interface DashboardPageProps {
  snapshot: SnapshotResponse | null;
  lastMessage: WsMessage | null;
}

function SystemStatusBar({ snapshot }: { snapshot: SnapshotResponse | null }) {
  const gpu = snapshot?.system?.gpu;
  if (!gpu) {
    return (
      <div className="panel flex items-center gap-4">
        <span className="text-swarm-muted">GPU: N/A</span>
      </div>
    );
  }
  return (
    <div className="panel flex flex-wrap items-center gap-4">
      <span className="text-sm font-medium">GPU</span>
      <span className="text-swarm-muted">
        {gpu.usedMb ?? 0} / {gpu.totalMb ?? 0} MB ({gpu.usedPct ?? 0}%)
      </span>
      <span className="text-swarm-muted">Util: {gpu.utilPct ?? 0}%</span>
      {gpu.devices?.map((d) => (
        <span key={d.index} className="chip chip-normal">
          GPU {d.index}: {(d.usedMb ?? 0)}MB
        </span>
      ))}
    </div>
  );
}

function DispatchControls() {
  const [teamId, setTeamId] = useState("team-alpha");
  const [task, setTask] = useState("");
  const [objective, setObjective] = useState("");
  const [mode, setMode] = useState<"dispatch" | "swarm">("dispatch");
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<string | null>(null);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setResult(null);
    try {
      if (mode === "swarm") {
        const res = await postApi<{ ok: boolean; objectiveId?: string }>("/api/orchestrator/swarm-run", {
          teamId,
          objective,
          maxIterations: 3,
        });
        setResult(res.ok ? `Swarm started: ${res.objectiveId}` : "Failed");
      } else {
        const res = await postApi<{ accepted?: boolean; taskId?: string }>("/api/orchestrator/dispatch", {
          teamId,
          task,
        });
        setResult(res.accepted ? `Dispatched: ${res.taskId}` : `Queued/Rejected: ${res.taskId}`);
      }
    } catch (err) {
      setResult(`Error: ${err instanceof Error ? err.message : "Unknown"}`);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="panel">
      <h3 className="text-sm font-semibold mb-3">Dispatch Controls</h3>
      <form onSubmit={handleSubmit} className="space-y-3">
        <div className="flex gap-2">
          <button
            type="button"
            onClick={() => setMode("dispatch")}
            className={`px-3 py-1 rounded text-sm ${mode === "dispatch" ? "bg-swarm-accent text-white" : "bg-swarm-border text-gray-400"}`}
          >
            Single Task
          </button>
          <button
            type="button"
            onClick={() => setMode("swarm")}
            className={`px-3 py-1 rounded text-sm ${mode === "swarm" ? "bg-swarm-accent text-white" : "bg-swarm-border text-gray-400"}`}
          >
            Swarm Run
          </button>
        </div>
        <div>
          <label className="block text-xs text-swarm-muted mb-1">Team ID</label>
          <input
            type="text"
            value={teamId}
            onChange={(e) => setTeamId(e.target.value)}
            className="w-full bg-swarm-bg border border-swarm-border rounded px-3 py-2 text-sm"
            placeholder="team-alpha"
          />
        </div>
        {mode === "dispatch" ? (
          <div>
            <label className="block text-xs text-swarm-muted mb-1">Task</label>
            <input
              type="text"
              value={task}
              onChange={(e) => setTask(e.target.value)}
              className="w-full bg-swarm-bg border border-swarm-border rounded px-3 py-2 text-sm"
              placeholder="Research and summarize..."
            />
          </div>
        ) : (
          <div>
            <label className="block text-xs text-swarm-muted mb-1">Objective</label>
            <textarea
              value={objective}
              onChange={(e) => setObjective(e.target.value)}
              className="w-full bg-swarm-bg border border-swarm-border rounded px-3 py-2 text-sm"
              rows={3}
              placeholder="Build a feature that..."
            />
          </div>
        )}
        <button
          type="submit"
          disabled={loading}
          className="px-4 py-2 bg-swarm-accent rounded text-sm font-medium hover:bg-blue-600 disabled:opacity-50"
        >
          {loading ? "Sending..." : mode === "swarm" ? "Start Swarm" : "Dispatch"}
        </button>
        {result && <p className="text-sm text-swarm-muted">{result}</p>}
      </form>
    </div>
  );
}

function ActiveAgentsTable({ agents }: { agents: AgentInfo[] }) {
  if (!agents?.length) {
    return (
      <div className="panel">
        <h3 className="text-sm font-semibold mb-2">Active Agents</h3>
        <p className="text-swarm-muted text-sm">No active agents</p>
      </div>
    );
  }
  return (
    <div className="panel overflow-x-auto">
      <h3 className="text-sm font-semibold mb-3">Active Agents</h3>
      <table className="w-full text-sm">
        <thead>
          <tr className="text-left text-swarm-muted border-b border-swarm-border">
            <th className="pb-2 pr-4">Task</th>
            <th className="pb-2 pr-4">Team</th>
            <th className="pb-2 pr-4">Role</th>
            <th className="pb-2 pr-4">Status</th>
            <th className="pb-2 pr-4">Model</th>
          </tr>
        </thead>
        <tbody>
          {agents.map((a) => (
            <tr key={a.taskId} className="border-b border-swarm-border/50">
              <td className="py-2 pr-4 truncate max-w-[200px]">{a.taskId}</td>
              <td className="py-2 pr-4">{a.teamId}</td>
              <td className="py-2 pr-4">{a.role}</td>
              <td className="py-2 pr-4">
                <span className={`chip ${a.status === "running" ? "chip-normal" : a.status === "queued" ? "chip-elevated" : "chip-high"}`}>
                  {a.status}
                </span>
              </td>
              <td className="py-2 pr-4">{a.model || "—"}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function EventStream({ events }: { events: SwarmEvent[] }) {
  const recent = (events || []).slice(-15).reverse();
  return (
    <div className="panel">
      <h3 className="text-sm font-semibold mb-3">Event Stream</h3>
      <div className="space-y-1 max-h-64 overflow-y-auto text-xs font-mono">
        {recent.length === 0 ? (
          <p className="text-swarm-muted">No events</p>
        ) : (
          recent.map((e) => (
            <div key={e.id} className="flex gap-2 text-swarm-muted">
              <span className="shrink-0">{new Date(e.ts).toLocaleTimeString()}</span>
              <span className="text-emerald-400">{e.type}</span>
              <span>{e.teamId}</span>
            </div>
          ))
        )}
      </div>
    </div>
  );
}

export default function DashboardPage({ snapshot, lastMessage }: DashboardPageProps) {
  const agents = (snapshot as { activeAgentDetails?: AgentInfo[] })?.activeAgentDetails ?? [];
  const events = snapshot?.events ?? [];

  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-bold">Dashboard</h1>
      <SystemStatusBar snapshot={snapshot} />
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <DispatchControls />
        <div className="panel">
          <h3 className="text-sm font-semibold mb-2">Swarm Topology</h3>
          <p className="text-swarm-muted text-sm">Visual topology placeholder — teams and agent graph</p>
        </div>
      </div>
      <ActiveAgentsTable agents={agents} />
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <EventStream events={events} />
        <div className="panel">
          <h3 className="text-sm font-semibold mb-2">WebSocket</h3>
          <p className="text-swarm-muted text-sm">
            {lastMessage ? `Last: ${lastMessage.type} at ${lastMessage.ts}` : "No messages yet"}
          </p>
        </div>
      </div>
    </div>
  );
}
