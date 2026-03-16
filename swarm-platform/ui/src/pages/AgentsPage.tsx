import { useApi } from "../hooks/useApi";
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer, PieChart, Pie, Cell } from "recharts";

interface TeamStats {
  totalTasks: number;
  successCount: number;
  failCount: number;
  avgLatencyMs: number;
  avgCorrectness: number;
  modelUsage: Record<string, number>;
  roleUsage: Record<string, number>;
  recentErrors: string[];
  successRate: number;
}

interface TeamStatsResponse {
  teams: Record<string, TeamStats>;
  rounds: number;
  performanceRecords: number;
  winCounts: Record<string, number>;
  recentRounds: Array<{ roundId: string; lessonsCount: number; ts: string }>;
}

interface Lesson {
  id: string;
  lesson: string;
  category: string;
  ts: string;
}

interface Recommendation {
  avoidModels?: string[];
  preferModels?: string[];
  roleOverrides?: Record<string, string>;
}

interface CompetitiveRound {
  objectiveId: string;
  objective: string;
  startedAt: string;
  status: string;
  winner: string | null;
  alphaScore: number | null;
  betaScore: number | null;
  category: string | null;
  durationMs: number | null;
}

interface CompetitiveRoundsResponse {
  rounds: CompetitiveRound[];
}

interface Memory {
  id: string;
  teamId: string;
  content: string;
  category: string;
  ts: string;
  outcome: "success" | "failure" | "partial";
}

interface MemoryStatsResponse {
  totalMemories: number;
  teamBreakdown: Record<string, number>;
  categoryBreakdown: Record<string, number>;
  recentOutcomes: Array<{ outcome: string; count: number }>;
}

interface MemoriesResponse {
  memories: Memory[];
}

export default function AgentsPage() {
  const { data: teamStats } = useApi<TeamStatsResponse>("/api/learning/team-stats", 6000);
  const { data: lessons } = useApi<Lesson[]>("/api/learning/lessons/team-alpha", 6000);
  const { data: recommendations } = useApi<Recommendation>("/api/learning/recommendations/team-alpha", 6000);
  const { data: competitiveRounds } = useApi<CompetitiveRoundsResponse>("/api/competitive/rounds", 6000);
  const { data: memoryStats } = useApi<MemoryStatsResponse>("/api/agents/memory/stats", 6000);
  const { data: recentMemories } = useApi<MemoriesResponse>("/api/agents/memory", 6000);

  // Helper to get team color
  const getTeamColor = (teamId: string): string => {
    if (teamId === "team-alpha") return "#3b82f6"; // blue
    if (teamId === "team-beta") return "#8b5cf6"; // purple
    return "#10b981"; // emerald (gamma)
  };

  const getTeamBgClass = (teamId: string): string => {
    if (teamId === "team-alpha") return "bg-blue-900/20 border-blue-500/20";
    if (teamId === "team-beta") return "bg-purple-900/20 border-purple-500/20";
    return "bg-emerald-900/20 border-emerald-500/20";
  };

  // Helper to calculate win rate percentage
  const calculateWinRate = (teamId: string): number => {
    if (!teamStats?.teams[teamId]) return 0;
    const total = teamStats.teams[teamId].totalTasks;
    const wins = teamStats.teams[teamId].successCount;
    return total > 0 ? Math.round((wins / total) * 100) : 0;
  };

  // Prepare data for model usage charts
  const getModelChartData = (teamId: string) => {
    const team = teamStats?.teams[teamId];
    if (!team || Object.keys(team.modelUsage || {}).length === 0) return [];
    return Object.entries(team.modelUsage).map(([model, count]) => ({
      name: model.slice(0, 20), // truncate long names
      value: count as number,
    }));
  };

  // Prepare data for role usage
  const getRoleChartData = (teamId: string) => {
    const team = teamStats?.teams[teamId];
    if (!team || Object.keys(team.roleUsage || {}).length === 0) return [];
    return Object.entries(team.roleUsage).map(([role, count]) => ({
      name: role,
      count: count as number,
    }));
  };

  const COLORS = ["#3b82f6", "#8b5cf6", "#10b981", "#f59e0b", "#ef4444"];

  // Team comparison section
  const renderTeamCard = (teamId: string) => {
    const team = teamStats?.teams[teamId];
    const teamLessons = Array.isArray(lessons) ? lessons : [];
    const teamRecommendations = recommendations || {};
    const winRate = calculateWinRate(teamId);

    if (!team) {
      return (
        <div className={`panel ${getTeamBgClass(teamId)} border`}>
          <div className="text-center py-8">
            <p className="text-swarm-muted text-sm">No performance data yet</p>
            <p className="text-swarm-muted/60 text-xs mt-1">Data populates after competitive rounds complete</p>
          </div>
        </div>
      );
    }

    const modelData = getModelChartData(teamId);
    const roleData = getRoleChartData(teamId);
    const recentErrs = team.recentErrors?.slice(0, 3) || [];

    return (
      <div className={`panel ${getTeamBgClass(teamId)} border`}>
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-lg font-bold capitalize">{teamId.replace("-", " ")}</h2>
          <div
            className="px-3 py-1 rounded-full text-sm font-semibold"
            style={{ backgroundColor: getTeamColor(teamId), color: "white" }}
          >
            {winRate}% Win Rate
          </div>
        </div>

        {/* Key metrics */}
        <div className="grid grid-cols-2 gap-3 mb-4 text-sm">
          <div>
            <span className="text-swarm-muted">Total Tasks</span>
            <p className="text-lg font-semibold">{team.totalTasks}</p>
          </div>
          <div>
            <span className="text-swarm-muted">Success / Fail</span>
            <p className="text-lg font-semibold">
              {team.successCount} / {team.failCount}
            </p>
          </div>
          <div>
            <span className="text-swarm-muted">Avg Latency</span>
            <p className="text-lg font-semibold">{team.avgLatencyMs}ms</p>
          </div>
          <div>
            <span className="text-swarm-muted">Avg Correctness</span>
            <p className="text-lg font-semibold">{team.avgCorrectness}</p>
          </div>
        </div>

        {/* Model usage breakdown */}
        <div className="mb-4">
          <h4 className="text-sm font-semibold mb-2">Model Usage</h4>
          {modelData.length > 0 ? (
            <div className="h-40">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={modelData}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#374151" />
                  <XAxis dataKey="name" stroke="#6b7280" tick={{ fontSize: 10 }} />
                  <YAxis stroke="#6b7280" tick={{ fontSize: 10 }} />
                  <Tooltip contentStyle={{ backgroundColor: "#111827", border: "1px solid #1f2937" }} />
                  <Bar dataKey="value" fill={getTeamColor(teamId)} />
                </BarChart>
              </ResponsiveContainer>
            </div>
          ) : (
            <p className="text-swarm-muted text-xs">No model data</p>
          )}
        </div>

        {/* Role performance */}
        <div className="mb-4">
          <h4 className="text-sm font-semibold mb-2">Role Performance</h4>
          {roleData.length > 0 ? (
            <div className="space-y-1 text-sm">
              {roleData.map((role, idx) => (
                <div key={role.name} className="flex justify-between">
                  <span className="capitalize text-swarm-muted">{role.name}</span>
                  <span className="font-semibold">{role.count}</span>
                </div>
              ))}
            </div>
          ) : (
            <p className="text-swarm-muted text-xs">No role data</p>
          )}
        </div>

        {/* Recent lessons */}
        <div className="mb-4">
          <h4 className="text-sm font-semibold mb-2">Recent Lessons</h4>
          {Array.isArray(teamLessons) && teamLessons.length > 0 ? (
            <div className="space-y-1 max-h-24 overflow-y-auto text-xs">
              {teamLessons.slice(0, 3).map((lesson: Lesson, idx: number) => (
                <div key={idx} className="border-b border-swarm-border/30 pb-1 text-swarm-muted">
                  {lesson.lesson?.slice(0, 60)}...
                </div>
              ))}
            </div>
          ) : (
            <p className="text-swarm-muted text-xs">No lessons yet</p>
          )}
        </div>

        {/* Recommendations */}
        <div>
          <h4 className="text-sm font-semibold mb-2">Recommendations</h4>
          <div className="text-xs space-y-1">
            {(teamRecommendations?.preferModels?.length || 0) > 0 || (teamRecommendations?.avoidModels?.length || 0) > 0 ? (
              <>
                {teamRecommendations?.preferModels && teamRecommendations.preferModels.length > 0 && (
                  <div>
                    <span className="text-emerald-400">Prefer:</span>
                    <span className="text-swarm-muted ml-1">{teamRecommendations.preferModels.join(", ")}</span>
                  </div>
                )}
                {teamRecommendations?.avoidModels && teamRecommendations.avoidModels.length > 0 && (
                  <div>
                    <span className="text-red-400">Avoid:</span>
                    <span className="text-swarm-muted ml-1">{teamRecommendations.avoidModels.join(", ")}</span>
                  </div>
                )}
              </>
            ) : (
              <p className="text-swarm-muted">No recommendations</p>
            )}
          </div>
        </div>

        {/* Recent errors */}
        {recentErrs.length > 0 && (
          <div className="mt-3 pt-3 border-t border-swarm-border/30">
            <h4 className="text-sm font-semibold mb-1 text-red-400">Recent Errors</h4>
            <div className="text-xs space-y-1">
              {recentErrs.map((err, idx) => (
                <div key={idx} className="text-red-300/70">
                  {err}
                </div>
              ))}
            </div>
          </div>
        )}
      </div>
    );
  };

  // Recent competitive rounds section
  const renderRoundsTable = () => {
    const rounds = competitiveRounds?.rounds?.slice(0, 10) || [];

    if (rounds.length === 0) {
      return <p className="text-swarm-muted text-sm">No competitive rounds yet</p>;
    }

    return (
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="text-left text-swarm-muted border-b border-swarm-border">
              <th className="pb-2 pr-4">Objective</th>
              <th className="pb-2 pr-4">Winner</th>
              <th className="pb-2 pr-4">Alpha Score</th>
              <th className="pb-2 pr-4">Beta Score</th>
              <th className="pb-2 pr-4">Duration</th>
              <th className="pb-2 pr-4">Category</th>
            </tr>
          </thead>
          <tbody>
            {rounds.map((round) => {
              let winnerColor = "text-gray-400";
              if (round.winner === "team-alpha") winnerColor = "text-blue-400";
              else if (round.winner === "team-beta") winnerColor = "text-purple-400";
              else if (round.winner === "tie") winnerColor = "text-yellow-400";

              return (
                <tr key={round.objectiveId} className="border-b border-swarm-border/50">
                  <td className="py-2 pr-4 max-w-xs truncate text-swarm-muted">
                    {round.objective?.slice(0, 80) || "—"}
                  </td>
                  <td className={`py-2 pr-4 font-semibold ${winnerColor}`}>
                    {round.winner || "—"}
                  </td>
                  <td className="py-2 pr-4">
                    {round.alphaScore !== null ? Math.round(round.alphaScore) : "—"}
                  </td>
                  <td className="py-2 pr-4">
                    {round.betaScore !== null ? Math.round(round.betaScore) : "—"}
                  </td>
                  <td className="py-2 pr-4 text-swarm-muted">
                    {round.durationMs ? `${Math.round(round.durationMs / 1000)}s` : "—"}
                  </td>
                  <td className="py-2 pr-4 text-swarm-muted">
                    {round.category || "—"}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    );
  };

  // Memory insights section
  const renderMemoryStats = () => {
    const stats = memoryStats;
    const memories = recentMemories?.memories?.slice(0, 5) || [];

    if (!stats) {
      return <p className="text-swarm-muted text-sm">No memory data yet</p>;
    }

    const outcomeData = stats.recentOutcomes || [];
    const teamBreakdown = Object.entries(stats.teamBreakdown || {}).map(([team, count]) => ({
      name: team,
      value: count as number,
    }));

    return (
      <div className="space-y-4">
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <div>
            <h4 className="text-sm font-semibold mb-3">Total Memories</h4>
            <div className="text-3xl font-bold">{stats.totalMemories}</div>
            <p className="text-xs text-swarm-muted mt-1">Stored across {Object.keys(stats.teamBreakdown || {}).length} teams</p>
          </div>

          {teamBreakdown.length > 0 && (
            <div>
              <h4 className="text-sm font-semibold mb-3">Team Breakdown</h4>
              <div className="h-32">
                <ResponsiveContainer width="100%" height="100%">
                  <PieChart>
                    <Pie
                      data={teamBreakdown}
                      cx="50%"
                      cy="50%"
                      labelLine={false}
                      label={({ name, value }) => `${name}: ${value}`}
                      outerRadius={50}
                      fill="#8884d8"
                      dataKey="value"
                    >
                      {teamBreakdown.map((entry, index) => (
                        <Cell key={`cell-${index}`} fill={COLORS[index % COLORS.length]} />
                      ))}
                    </Pie>
                    <Tooltip />
                  </PieChart>
                </ResponsiveContainer>
              </div>
            </div>
          )}
        </div>

        {outcomeData.length > 0 && (
          <div>
            <h4 className="text-sm font-semibold mb-2">Recent Outcome Distribution</h4>
            <div className="space-y-1 text-sm">
              {outcomeData.map((outcome) => {
                const outcomeColor = outcome.outcome === "success" ? "text-emerald-400" : outcome.outcome === "failure" ? "text-red-400" : "text-yellow-400";
                return (
                  <div key={outcome.outcome} className="flex justify-between">
                    <span className={outcomeColor} style={{ textTransform: "capitalize" }}>
                      {outcome.outcome}
                    </span>
                    <span className="font-semibold">{outcome.count}</span>
                  </div>
                );
              })}
            </div>
          </div>
        )}

        {memories.length > 0 && (
          <div>
            <h4 className="text-sm font-semibold mb-3">Recent 5 Memories</h4>
            <div className="space-y-2 max-h-40 overflow-y-auto text-xs">
              {memories.map((memory) => {
                const outcomeColor = memory.outcome === "success" ? "text-emerald-400" : memory.outcome === "failure" ? "text-red-400" : "text-yellow-400";
                return (
                  <div key={memory.id} className="border-b border-swarm-border/30 pb-2">
                    <div className="flex justify-between items-start mb-1">
                      <span className="text-swarm-muted">{memory.teamId}</span>
                      <span className={`text-xs ${outcomeColor}`} style={{ textTransform: "capitalize" }}>
                        {memory.outcome}
                      </span>
                    </div>
                    <p className="text-swarm-muted/70 line-clamp-2">{memory.content?.slice(0, 80)}...</p>
                  </div>
                );
              })}
            </div>
          </div>
        )}
      </div>
    );
  };

  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-bold">Agents Team Internals</h1>

      {/* Section 1: Team Comparison Cards */}
      <div>
        <h2 className="text-lg font-semibold mb-4">Team Comparison</h2>
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          {renderTeamCard("team-alpha")}
          {renderTeamCard("team-beta")}
        </div>
      </div>

      {/* Section 2: Recent Competitive Rounds */}
      <div className="panel">
        <h2 className="text-lg font-semibold mb-4">Recent Competitive Rounds</h2>
        {renderRoundsTable()}
      </div>

      {/* Section 3: Agent Memory Insights */}
      <div className="panel">
        <h2 className="text-lg font-semibold mb-4">Agent Memory Insights</h2>
        {renderMemoryStats()}
      </div>
    </div>
  );
}
