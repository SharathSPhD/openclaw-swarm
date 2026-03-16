import { useApi } from "../hooks/useApi";
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer } from "recharts";
import type { LeaderboardRow } from "../types";

interface LeaderboardResponse {
  leaderboard: LeaderboardRow[];
}

export default function LeaderboardPage() {
  const { data } = useApi<LeaderboardResponse>("/api/leaderboard", 5000);
  const allTeams = data?.leaderboard ?? [];
  const competingTeams = allTeams.filter(t => ["team-alpha", "team-beta"].includes(t.teamId || t.teamName));
  const supportTeams = allTeams.filter(t => !["team-alpha", "team-beta"].includes(t.teamId || t.teamName));
  const leaderboard = competingTeams;

  const chartData = leaderboard.map((r) => ({
    name: r.teamName,
    score: r.score,
    completed: r.completed,
  }));

  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-bold">Leaderboard</h1>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <div className="panel">
          <h3 className="text-sm font-semibold mb-3">Team Scores</h3>
          {chartData.length > 0 ? (
            <div className="h-64">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={chartData} layout="vertical" margin={{ left: 80 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#374151" />
                  <XAxis type="number" stroke="#6b7280" tick={{ fontSize: 10 }} />
                  <YAxis type="category" dataKey="name" stroke="#6b7280" tick={{ fontSize: 10 }} width={70} />
                  <Tooltip contentStyle={{ backgroundColor: "#111827", border: "1px solid #1f2937" }} />
                  <Bar dataKey="score" fill="#3b82f6" radius={[0, 4, 4, 0]} />
                </BarChart>
              </ResponsiveContainer>
            </div>
          ) : (
            <p className="text-swarm-muted text-sm">No leaderboard data</p>
          )}
        </div>

        <div className="panel overflow-x-auto">
          <h3 className="text-sm font-semibold mb-3">Rankings</h3>
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-swarm-muted border-b border-swarm-border">
                <th className="pb-3 pr-4">Rank</th>
                <th className="pb-3 pr-4">Team</th>
                <th className="pb-3 pr-4">Score</th>
                <th className="pb-3 pr-4">Accuracy</th>
                <th className="pb-3 pr-4">Completed</th>
                <th className="pb-3 pr-4">Failed</th>
                <th className="pb-3 pr-4">Penalties</th>
                <th className="pb-3 pr-4">Rewards</th>
                <th className="pb-3 pr-4">Avg Latency</th>
                <th className="pb-3 pr-4">Tool Calls</th>
                <th className="pb-3 pr-4">Critic Approval</th>
              </tr>
            </thead>
            <tbody>
              {leaderboard.length === 0 ? (
                <tr>
                  <td colSpan={11} className="py-8 text-center text-swarm-muted">
                    No teams
                  </td>
                </tr>
              ) : (
                leaderboard.map((row) => (
                  <tr key={row.teamName} className="border-b border-swarm-border/50">
                    <td className="py-2 pr-4 font-bold">#{row.rank}</td>
                    <td className="py-2 pr-4">{row.teamName}</td>
                    <td className="py-2 pr-4">{row.score}</td>
                    <td className="py-2 pr-4">{(row.accuracy * 100).toFixed(1)}%</td>
                    <td className="py-2 pr-4">{row.completed}</td>
                    <td className="py-2 pr-4">{row.failed ?? 0}</td>
                    <td className="py-2 pr-4 text-red-400">{row.penalties}</td>
                    <td className="py-2 pr-4 text-green-400">{row.rewards ?? 0}</td>
                    <td className="py-2 pr-4">{row.avgLatency ? `${(row.avgLatency / 1000).toFixed(1)}s` : "—"}</td>
                    <td className="py-2 pr-4">{row.toolUsage ?? 0}</td>
                    <td className="py-2 pr-4">{row.criticApprovalRate != null ? `${(row.criticApprovalRate * 100).toFixed(0)}%` : "—"}</td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>

      {leaderboard.map((row) => (
        <div key={row.teamName} className="panel">
          <h3 className="text-sm font-semibold mb-3">{row.teamName} — Model Usage & Performance</h3>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div>
              <h4 className="text-xs font-semibold text-swarm-muted mb-2">Models Called</h4>
              <div className="flex flex-wrap gap-2">
                {row.modelUsage && Object.keys(row.modelUsage).length > 0 ? (
                  Object.entries(row.modelUsage)
                    .filter(([m]) => m !== "unknown")
                    .sort(([, a], [, b]) => (b as number) - (a as number))
                    .map(([model, count]) => (
                      <span key={model} className="font-mono text-[11px] px-2 py-0.5 rounded bg-blue-900/30 text-blue-400 border border-blue-900/50">
                        {model}: {String(count)}
                      </span>
                    ))
                ) : (
                  <span className="text-swarm-muted text-xs">No model usage data</span>
                )}
              </div>
            </div>
            <div>
              <h4 className="text-xs font-semibold text-swarm-muted mb-2">Agent Roles</h4>
              <div className="flex flex-wrap gap-2">
                {row.byRole && Object.keys(row.byRole).length > 0 ? (
                  Object.entries(row.byRole).map(([role, count]) => (
                    <span key={role} className="font-mono text-[11px] px-2 py-0.5 rounded bg-purple-900/30 text-purple-400 border border-purple-900/50">
                      {role}: {String(count)}
                    </span>
                  ))
                ) : (
                  <span className="text-swarm-muted text-xs">No role data</span>
                )}
              </div>
            </div>
          </div>
          {row.recentObjectives && row.recentObjectives.length > 0 && (
            <div className="mt-3">
              <h4 className="text-xs font-semibold text-swarm-muted mb-1">Recent Objectives</h4>
              <div className="flex flex-wrap gap-2">
                {row.recentObjectives.map((obj, i) => (
                  <span key={i} className={`font-mono text-[11px] px-2 py-0.5 rounded border ${obj.status === "completed" ? "bg-emerald-900/20 text-emerald-400 border-emerald-900/50" : "bg-red-900/20 text-red-400 border-red-900/50"}`}>
                    {obj.id?.slice(0, 20)} ({obj.status})
                  </span>
                ))}
              </div>
            </div>
          )}
        </div>
      ))}

      {/* Support Teams (non-competing) */}
      {supportTeams.length > 0 && (
        <div className="panel mt-4">
          <h3 className="text-sm font-semibold mb-3 text-gray-400">Support Teams (non-competing)</h3>
          <div className="space-y-2">
            {supportTeams.map((row) => (
              <div key={row.teamName} className="flex items-center justify-between py-1 border-b border-swarm-border/30">
                <span className="text-gray-400">{row.teamName}</span>
                <span className="text-xs text-swarm-muted">
                  {row.teamName.includes("gamma") ? "Implements winning solutions" : "Supports program lead"}
                  {" · "}Tasks: {row.completed + (row.failed ?? 0)}
                </span>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
