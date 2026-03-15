import { useApi } from "../hooks/useApi";
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer } from "recharts";
import type { LeaderboardRow } from "../types";

interface LeaderboardResponse {
  leaderboard: LeaderboardRow[];
}

export default function LeaderboardPage() {
  const { data } = useApi<LeaderboardResponse>("/api/leaderboard", 5000);
  const leaderboard = data?.leaderboard ?? [];

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
          <h3 className="text-sm font-semibold mb-3">{row.teamName} — Model Usage</h3>
          <div className="flex flex-wrap gap-2">
            {row.modelUsage && Object.keys(row.modelUsage).length > 0 ? (
              Object.entries(row.modelUsage).map(([model, count]) => (
                <span key={model} className="chip chip-normal text-xs">
                  {model}: {count}
                </span>
              ))
            ) : (
              <span className="text-swarm-muted text-xs">No model usage data</span>
            )}
          </div>
          {row.recentObjectives && row.recentObjectives.length > 0 && (
            <div className="mt-3">
              <h4 className="text-xs font-semibold text-swarm-muted mb-1">Recent Objectives</h4>
              <div className="flex flex-wrap gap-2">
                {row.recentObjectives.map((obj, i) => (
                  <span key={i} className={`chip text-xs ${obj.status === "completed" ? "chip-normal" : "chip-critical"}`}>
                    {obj.id?.slice(0, 16)} ({obj.status})
                  </span>
                ))}
              </div>
            </div>
          )}
        </div>
      ))}
    </div>
  );
}
