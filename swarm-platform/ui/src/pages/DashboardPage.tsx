import { useState } from "react";
import { postApi, useApi } from "../hooks/useApi";
import MetricsPanel from "../components/MetricsPanel";
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

interface CompetitiveStatus {
  phase: string;
  objective?: {
    objectiveId?: string;
    objective?: string;
    phase?: string;
  } | null;
}

function TeamTopology({ agents, competitiveStatus }: { agents: AgentInfo[]; competitiveStatus: CompetitiveStatus | null }) {
  const teams = ["team-alpha", "team-beta", "team-gamma", "team-delta"];
  const teamLabels: Record<string, string> = {
    "team-alpha": "Alpha (Contender)",
    "team-beta": "Beta (Contender)",
    "team-gamma": "Gamma (Implementer)",
    "team-delta": "Delta (Explorer)"
  };
  const teamColors: Record<string, string> = {
    "team-alpha": "border-blue-500",
    "team-beta": "border-purple-500",
    "team-gamma": "border-amber-500",
    "team-delta": "border-emerald-500"
  };

  const phase = competitiveStatus?.phase || "idle";
  const phaseLabels: Record<string, string> = {
    idle: "Idle",
    forking: "Fork: Both teams competing",
    evaluating: "Evaluate: Program lead picking winner",
    implementing: "Implement: Gamma building winner's approach",
    merging: "Merge: Pushing to main"
  };

  return (
    <div className="panel">
      <h3 className="text-sm font-semibold mb-3">Competitive Team Topology</h3>

      <div className="mb-3 flex items-center gap-2">
        <span className="text-xs text-swarm-muted">Phase:</span>
        <span className={`chip ${phase === "idle" ? "chip-normal" : "chip-elevated"}`}>
          {phaseLabels[phase] || phase}
        </span>
      </div>

      {competitiveStatus?.objective?.objective && (
        <p className="text-xs text-swarm-muted mb-3 italic truncate">
          {competitiveStatus.objective.objective.slice(0, 120)}...
        </p>
      )}

      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        {teams.map((teamId) => {
          const teamAgents = agents.filter((a) => a.teamId === teamId);
          const isActive = phase === "forking"
            ? (teamId === "team-alpha" || teamId === "team-beta")
            : phase === "implementing"
              ? teamId === "team-gamma"
              : false;

          return (
            <div
              key={teamId}
              className={`rounded-lg border-2 p-3 ${teamColors[teamId] || "border-swarm-border"} ${
                isActive ? "bg-swarm-card" : "bg-swarm-bg opacity-70"
              }`}
            >
              <div className="text-xs font-semibold mb-2">{teamLabels[teamId] || teamId}</div>
              {teamAgents.length > 0 ? (
                <div className="space-y-1">
                  {teamAgents.map((a) => (
                    <div key={a.taskId} className="flex items-center gap-1">
                      <span className={`w-2 h-2 rounded-full ${
                        a.status === "running" ? "bg-green-400" : "bg-yellow-400"
                      }`} />
                      <span className="text-xs truncate">{a.role}</span>
                    </div>
                  ))}
                </div>
              ) : (
                <span className="text-xs text-swarm-muted">No active agents</span>
              )}
            </div>
          );
        })}
      </div>

      <div className="mt-3 flex items-center justify-center gap-1 text-xs text-swarm-muted flex-wrap">
        <span className="text-blue-400">Alpha</span>
        <span>+</span>
        <span className="text-purple-400">Beta</span>
        <span>→ Evaluate →</span>
        <span className="text-amber-400">Gamma</span>
        <span>→ Main → GitHub</span>
        <span className="ml-3 text-swarm-muted">|</span>
        <span className="text-emerald-400 ml-1">Delta</span>
        <span>explores externally</span>
      </div>
    </div>
  );
}

interface LessonEntry {
  id: number;
  team_id: string;
  round_id: string;
  category: string;
  lesson: string;
  model?: string;
  role?: string;
  severity: string;
  created_at: string;
}

interface ModelRecommendation {
  avoidModels: Array<{ model: string; role: string; failRate: number; reason: string }>;
  preferModels: Array<{ model: string; role: string; avgCorrectness: number; avgLatency: number }>;
  roleOverrides: Record<string, { avoid: string; prefer: string; reason: string }>;
}

function LearningPanel() {
  const { data: alphaLessons } = useApi<LessonEntry[]>("/api/learning/lessons/team-alpha", 10000);
  const { data: betaLessons } = useApi<LessonEntry[]>("/api/learning/lessons/team-beta", 10000);
  const { data: alphaRecs } = useApi<ModelRecommendation>("/api/learning/recommendations/team-alpha", 10000);

  const allLessons = [...(alphaLessons || []), ...(betaLessons || [])];
  const sorted = allLessons.sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime()).slice(0, 8);

  const severityClass: Record<string, string> = {
    critical: "text-red-400",
    warning: "text-yellow-400",
    info: "text-swarm-muted"
  };

  return (
    <div className="panel">
      <h3 className="text-sm font-semibold mb-3">Learning Insights</h3>
      {sorted.length === 0 ? (
        <p className="text-swarm-muted text-xs">No lessons recorded yet. Lessons accumulate after competitive rounds.</p>
      ) : (
        <div className="space-y-2 max-h-48 overflow-y-auto">
          {sorted.map((l) => (
            <div key={l.id} className="text-xs">
              <span className={`font-medium ${severityClass[l.severity] || "text-swarm-muted"}`}>
                [{l.severity?.toUpperCase()}]
              </span>
              {" "}
              <span className="text-swarm-muted">{l.team_id}</span>
              {" "}
              <span>{l.lesson?.slice(0, 150)}</span>
            </div>
          ))}
        </div>
      )}
      {alphaRecs && (alphaRecs.avoidModels?.length > 0 || alphaRecs.preferModels?.length > 0) && (
        <div className="mt-3 border-t border-swarm-border pt-2">
          <h4 className="text-xs font-semibold mb-1">Model Recommendations (Alpha)</h4>
          {alphaRecs.avoidModels?.map((a, i) => (
            <div key={i} className="text-xs text-red-400">Avoid: {a.model} for {a.role} ({a.reason})</div>
          ))}
          {alphaRecs.preferModels?.map((p, i) => (
            <div key={i} className="text-xs text-green-400">Prefer: {p.model} for {p.role} ({(p.avgCorrectness * 100).toFixed(0)}% correct, {p.avgLatency}ms)</div>
          ))}
        </div>
      )}
    </div>
  );
}

function RecentAgentActivity({ events }: { events: SwarmEvent[] }) {
  const taskEvents = (events || [])
    .filter((e) => e.type === "task.completed" || e.type === "task.failed")
    .slice(-8)
    .reverse();

  if (taskEvents.length === 0) {
    return (
      <div className="panel">
        <h3 className="text-sm font-semibold mb-2">Recent Agent Output</h3>
        <p className="text-swarm-muted text-xs">No completed tasks yet</p>
      </div>
    );
  }

  return (
    <div className="panel">
      <h3 className="text-sm font-semibold mb-3">Recent Agent Output</h3>
      <div className="space-y-2 max-h-64 overflow-y-auto">
        {taskEvents.map((e) => {
          const p = e.payload as Record<string, string | number | undefined>;
          const ok = e.type === "task.completed";
          const role = String(p.role ?? "?");
          const model = String(p.model ?? "?");
          const output = String(p.output ?? "");
          const dur = typeof p.durationMs === "number" ? p.durationMs : null;
          const err = p.error ? String(p.error) : null;
          return (
            <div key={e.id} className="text-xs border-l-2 pl-2 py-1"
              style={{ borderColor: ok ? "#10b981" : "#ef4444" }}>
              <div className="flex gap-2 items-baseline flex-wrap">
                <span className="text-swarm-muted">{new Date(e.ts).toLocaleTimeString()}</span>
                <span className={`font-medium ${ok ? "text-green-400" : "text-red-400"}`}>
                  {ok ? "OK" : "FAIL"}
                </span>
                <span className="chip chip-normal text-[10px]">{role}</span>
                <span className="text-blue-400">{model}</span>
                <span className="text-swarm-muted">{e.teamId}</span>
                {dur != null && <span className="text-swarm-muted">{(dur / 1000).toFixed(1)}s</span>}
              </div>
              {err && <p className="text-red-400 mt-0.5 truncate">{err}</p>}
              {output && (
                <p className="text-swarm-muted mt-0.5 truncate">{output.slice(0, 200)}</p>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}

interface AutonomyStatusData {
  running: boolean;
  currentObjective: { objectiveId?: string; objective?: string; category?: string; phase?: string } | null;
  currentPhase: string;
  dynamicInterval: number;
  baseInterval: number;
  objectivesDispatched: number;
}

function AutonomyStatus() {
  const { data } = useApi<AutonomyStatusData>("/api/dashboard/autonomy-status", 4000);
  if (!data) return null;

  const intervalSec = Math.round((data.dynamicInterval || 90000) / 1000);
  const isThrottled = data.dynamicInterval > data.baseInterval;

  return (
    <div className="panel">
      <h3 className="text-sm font-semibold mb-3">Autonomy Status</h3>
      <div className="flex flex-wrap gap-3 mb-3">
        <span className={`chip ${data.running ? "chip-elevated" : "chip-normal"}`}>
          {data.running ? "Running" : "Stopped"}
        </span>
        <span className={`chip ${isThrottled ? "chip-elevated" : "chip-normal"}`}>
          Interval: {intervalSec}s{isThrottled ? " (throttled)" : ""}
        </span>
        <span className="chip chip-normal">Dispatched: {data.objectivesDispatched}</span>
        {data.currentPhase !== "idle" && (
          <span className="chip chip-elevated">Phase: {data.currentPhase}</span>
        )}
      </div>
      {data.currentObjective?.objective && (
        <p className="text-xs text-swarm-muted italic truncate">
          [{data.currentObjective.category || "?"}] {data.currentObjective.objective.slice(0, 120)}...
        </p>
      )}
    </div>
  );
}

interface LessonRow {
  category: string;
  lesson: string;
  severity: string;
  count?: number;
}

interface LearningPulseData {
  recentLessons: LessonRow[];
  byCategory: Record<string, LessonRow[]>;
  roundHistoryLength: number;
}

function LearningPulse() {
  const { data } = useApi<LearningPulseData>("/api/dashboard/learning-pulse", 8000);
  if (!data) return null;

  const criticalLessons = (data.recentLessons || []).filter(l => l.severity === "critical").slice(0, 5);
  const categories = Object.keys(data.byCategory || {}).slice(0, 8);

  return (
    <div className="panel">
      <h3 className="text-sm font-semibold mb-3">Learning Pulse</h3>
      <div className="flex items-center gap-3 mb-3 text-xs text-swarm-muted">
        <span>Rounds: {data.roundHistoryLength}</span>
        <span>Categories: {categories.length}</span>
      </div>
      {criticalLessons.length > 0 && (
        <div className="space-y-1 mb-3">
          <p className="text-xs font-medium text-red-400">Critical Lessons</p>
          {criticalLessons.map((l, i) => (
            <div key={i} className="text-xs text-swarm-muted border-l-2 border-red-500 pl-2 truncate">
              [{l.category}] {l.lesson}
            </div>
          ))}
        </div>
      )}
      {categories.length > 0 && (
        <div className="flex flex-wrap gap-1">
          {categories.map((cat) => (
            <span key={cat} className="chip chip-normal text-[10px]">
              {cat}: {data.byCategory[cat].length}
            </span>
          ))}
        </div>
      )}
    </div>
  );
}

export default function DashboardPage({ snapshot, lastMessage }: DashboardPageProps) {
  const agents = (snapshot as { activeAgentDetails?: AgentInfo[] })?.activeAgentDetails ?? [];
  const events = snapshot?.events ?? [];
  const { data: competitiveStatus } = useApi<CompetitiveStatus>("/api/competitive/status", 5000);

  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-bold">Dashboard</h1>
      <SystemStatusBar snapshot={snapshot} />
      <MetricsPanel />
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <AutonomyStatus />
        <LearningPulse />
      </div>
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <DispatchControls />
        <TeamTopology agents={agents} competitiveStatus={competitiveStatus} />
      </div>
      <ActiveAgentsTable agents={agents} />
      <RecentAgentActivity events={events} />
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <EventStream events={events} />
        <LearningPanel />
      </div>
    </div>
  );
}
