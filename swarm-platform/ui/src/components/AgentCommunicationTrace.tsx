import { useState } from "react";
import { useApi } from "../hooks/useApi";

interface AgentHandoff {
  ts: string;
  teamId: string;
  fromRole: string;
  toRole: string;
  objectiveId: string;
  outputPreview: string;
  status: string;
}

interface TraceResponse {
  handoffs: AgentHandoff[];
  objectiveId?: string;
}

const ROLE_COLORS: Record<string, string> = {
  research: "#3b82f6",
  build: "#10b981",
  critic: "#f59e0b",
  integrator: "#a855f7",
  coordinator: "#6b7280",
};

export default function AgentCommunicationTrace() {
  const [selectedTeam, setSelectedTeam] = useState<string>("all");
  const [selectedRole, setSelectedRole] = useState<string>("all");
  const [search, setSearch] = useState<string>("");
  const { data } = useApi<TraceResponse>("/api/autonomy/agent-trace", 5000);
  const handoffs = (data?.handoffs || []).filter(h =>
    (selectedTeam === "all" || h.teamId === selectedTeam) &&
    (selectedRole === "all" || h.fromRole === selectedRole || h.toRole === selectedRole) &&
    (search === "" || h.outputPreview.toLowerCase().includes(search.toLowerCase()) || h.fromRole.includes(search) || h.teamId.includes(search))
  );

  const teams = ["all", "team-alpha", "team-beta", "team-gamma"];

  return (
    <div className="panel">
      <div className="flex items-center justify-between mb-3">
        <h3 className="text-sm font-semibold">Agent Communication Trace</h3>
        <div className="flex gap-1">
          {teams.map(t => (
            <button
              key={t}
              onClick={() => setSelectedTeam(t)}
              className={`px-2 py-0.5 text-[10px] rounded ${
                selectedTeam === t
                  ? "bg-swarm-accent text-white"
                  : "bg-swarm-border text-swarm-muted hover:text-gray-200"
              }`}
            >
              {t === "all" ? "All" : t.replace("team-", "").toUpperCase()}
            </button>
          ))}
        </div>
      </div>

      <div className="flex gap-1 mt-2 flex-wrap">
        {["all", "research", "build", "critic", "integrator"].map(r => (
          <button
            key={r}
            onClick={() => setSelectedRole(r)}
            className={`px-2 py-0.5 text-[10px] rounded ${
              selectedRole === r
                ? "bg-swarm-accent text-white"
                : "bg-swarm-border text-swarm-muted hover:text-gray-200"
            }`}
          >
            {r}
          </button>
        ))}
      </div>

      <input
        type="text"
        value={search}
        onChange={e => setSearch(e.target.value)}
        placeholder="Search output..."
        className="mt-2 w-full bg-swarm-bg border border-swarm-border rounded px-2 py-1 text-xs text-gray-300 placeholder:text-swarm-muted focus:outline-none focus:border-swarm-accent"
      />

      {handoffs.length === 0 ? (
        <p className="text-swarm-muted text-xs">No agent handoffs recorded yet. Handoffs appear as agents pass work through the research → build → critic → integrator pipeline.</p>
      ) : (
        <div className="space-y-2 max-h-80 overflow-y-auto">
          {[...handoffs].reverse().map((h, i) => (
            <div key={i} className="text-xs border-b border-swarm-border/30 pb-2">
              <div className="flex items-center gap-2 flex-wrap mb-1">
                <span className="text-swarm-muted shrink-0">{new Date(h.ts).toLocaleTimeString()}</span>
                <span className="font-mono text-[10px] text-swarm-muted">{h.teamId.replace("team-", "")}</span>
                <span className="font-medium" style={{ color: ROLE_COLORS[h.fromRole] || "#6b7280" }}>{h.fromRole}</span>
                <span className="text-swarm-muted">→</span>
                <span className="font-medium" style={{ color: ROLE_COLORS[h.toRole] || "#6b7280" }}>{h.toRole}</span>
                <span className={`chip text-[9px] ${h.status === "completed" ? "chip-normal" : "chip-elevated"}`}>{h.status}</span>
              </div>
              {h.outputPreview && (
                <p className="text-swarm-muted pl-2 truncate">{h.outputPreview.slice(0, 150)}</p>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
