import { useApi } from "../hooks/useApi";
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer } from "recharts";

interface Round {
  objectiveId: string;
  objective: string;
  startedAt: string;
  status: string;
  winner: string | null;
  alphaScore: number | null;
  betaScore: number | null;
  category: string | null;
  durationMs: number | null;
  changedFiles?: number;
}

interface RoundsResponse {
  rounds: Round[];
}

const TEAM_COLORS: Record<string, string> = {
  "team-alpha": "#3b82f6",
  "team-beta": "#a855f7",
  "team-gamma": "#f59e0b",
};

export default function RoundHistoryChart() {
  const { data } = useApi<RoundsResponse>("/api/competitive/rounds", 10000);
  const rounds = (data?.rounds || []).slice(0, 10).reverse();

  if (rounds.length === 0) {
    return (
      <div className="panel">
        <h3 className="text-sm font-semibold mb-2">Round History</h3>
        <p className="text-swarm-muted text-xs">No competitive rounds completed yet.</p>
      </div>
    );
  }

  const chartData = rounds.map((r, i) => ({
    name: `R${i + 1}`,
    alpha: r.alphaScore ?? 0,
    beta: r.betaScore ?? 0,
    winner: r.winner,
    category: r.category || "?",
    objective: r.objective.slice(0, 60),
    duration: r.durationMs ? Math.round(r.durationMs / 1000) : null,
    files: r.changedFiles ?? 0,
  }));

  const winCounts: Record<string, number> = { "team-alpha": 0, "team-beta": 0 };
  for (const r of rounds) {
    if (r.winner && winCounts[r.winner] !== undefined) winCounts[r.winner]++;
  }

  const CustomTooltip = ({ active, payload, label }: { active?: boolean; payload?: Array<{ name: string; value: number; payload: typeof chartData[0] }>; label?: string }) => {
    if (!active || !payload?.length) return null;
    const d = payload[0]?.payload;
    return (
      <div className="bg-swarm-surface border border-swarm-border rounded p-3 text-xs max-w-xs">
        <p className="font-medium text-gray-100 mb-1">{label} — {d?.category}</p>
        <p className="text-swarm-muted truncate">{d?.objective}...</p>
        {d?.winner && (
          <p className="mt-1 font-medium" style={{ color: TEAM_COLORS[d.winner] || "#10b981" }}>
            Winner: {d.winner.replace("team-", "Team ")}
          </p>
        )}
        <div className="flex gap-3 mt-1">
          <span className="text-blue-400">α: {payload.find(p => p.name === "alpha")?.value ?? 0}</span>
          <span className="text-purple-400">β: {payload.find(p => p.name === "beta")?.value ?? 0}</span>
          {d?.duration && <span className="text-swarm-muted">{d.duration}s</span>}
          {d?.files > 0 && <span className="text-amber-400">{d.files} files</span>}
        </div>
      </div>
    );
  };

  return (
    <div className="panel">
      <div className="flex items-center justify-between mb-4">
        <h3 className="text-sm font-semibold">Round History</h3>
        <div className="flex gap-3 text-xs">
          <span className="text-blue-400">α wins: {winCounts["team-alpha"]}</span>
          <span className="text-purple-400">β wins: {winCounts["team-beta"]}</span>
          <span className="text-swarm-muted">{rounds.length} rounds</span>
        </div>
      </div>
      <div className="h-52">
        <ResponsiveContainer width="100%" height="100%">
          <BarChart data={chartData} margin={{ top: 4, right: 8, left: -20, bottom: 0 }}>
            <CartesianGrid strokeDasharray="3 3" stroke="#1f2937" vertical={false} />
            <XAxis dataKey="name" stroke="#6b7280" tick={{ fontSize: 10 }} />
            <YAxis stroke="#6b7280" tick={{ fontSize: 10 }} />
            <Tooltip content={<CustomTooltip />} />
            <Legend
              iconSize={8}
              formatter={(value) => <span className="text-xs">{value === "alpha" ? "Team Alpha" : "Team Beta"}</span>}
            />
            <Bar dataKey="alpha" fill="#3b82f6" radius={[2, 2, 0, 0]} name="alpha" />
            <Bar dataKey="beta" fill="#a855f7" radius={[2, 2, 0, 0]} name="beta" />
          </BarChart>
        </ResponsiveContainer>
      </div>
      {/* Recent rounds list */}
      <div className="mt-3 space-y-1 max-h-28 overflow-y-auto">
        {[...rounds].reverse().slice(0, 5).map((r, i) => (
          <div key={r.objectiveId} className="flex items-start gap-2 text-xs">
            <span className="text-swarm-muted shrink-0 w-12">{new Date(r.startedAt).toLocaleTimeString()}</span>
            <span className="font-medium shrink-0" style={{ color: TEAM_COLORS[r.winner || ""] || "#6b7280" }}>
              {r.winner ? r.winner.replace("team-", "").toUpperCase() : "?"}
            </span>
            <span className="chip chip-normal text-[9px] shrink-0">{r.category || "?"}</span>
            <span className="text-swarm-muted truncate">{r.objective.slice(0, 80)}</span>
          </div>
        ))}
      </div>
    </div>
  );
}
