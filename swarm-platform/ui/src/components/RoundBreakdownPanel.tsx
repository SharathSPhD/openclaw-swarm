import { useApi } from "../hooks/useApi";

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

const TEAM_COLORS: Record<string, { badge: string; text: string }> = {
  "team-alpha": { badge: "bg-blue-900/40 text-blue-400", text: "text-blue-400" },
  "team-beta": { badge: "bg-purple-900/40 text-purple-400", text: "text-purple-400" },
};

export default function RoundBreakdownPanel() {
  const { data } = useApi<RoundsResponse>("/api/competitive/rounds", 8000);
  const rounds = (data?.rounds || []).slice(0, 5).reverse();

  if (rounds.length === 0) {
    return (
      <div className="panel">
        <h3 className="text-sm font-semibold mb-2">Recent Rounds</h3>
        <p className="text-swarm-muted text-xs">No rounds yet</p>
      </div>
    );
  }

  const formatDuration = (ms: number | null) => {
    if (!ms) return "—";
    const seconds = Math.round(ms / 1000);
    return `${seconds}s`;
  };

  return (
    <div className="panel">
      <h3 className="text-sm font-semibold mb-3">Recent Rounds</h3>
      <div className="space-y-2">
        {rounds.map((round) => {
          const winnerColors = round.winner ? TEAM_COLORS[round.winner] : null;
          const winnerLabel = round.winner
            ? round.winner.replace("team-", "").toUpperCase()
            : "TIE";

          return (
            <div key={round.objectiveId} className="rounded border border-swarm-border p-2.5 bg-swarm-bg/50">
              {/* Row 1: Objective + Category */}
              <div className="flex items-start justify-between gap-2 mb-1.5">
                <span className="text-xs text-gray-300 truncate flex-1">
                  {round.objective.slice(0, 70)}
                </span>
                {round.category && (
                  <span className="chip chip-normal text-[9px] shrink-0">{round.category}</span>
                )}
              </div>

              {/* Row 2: Winner + Scores + Duration */}
              <div className="flex items-center gap-2">
                <span
                  className={`text-[10px] font-mono px-2 py-0.5 rounded shrink-0 ${
                    winnerColors?.badge || "bg-gray-700/40 text-gray-400"
                  }`}
                >
                  {winnerLabel}
                </span>
                <span className="text-[10px] font-mono text-gray-400">
                  <span className="text-blue-400">α:{round.alphaScore ?? 0}</span>
                  <span className="mx-1">β:{round.betaScore ?? 0}</span>
                </span>
                <span className="text-[10px] text-swarm-muted">
                  {formatDuration(round.durationMs)}
                </span>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
