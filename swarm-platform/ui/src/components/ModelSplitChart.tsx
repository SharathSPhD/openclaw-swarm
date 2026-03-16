import { useApi } from "../hooks/useApi";

interface TeamStats {
  modelUsage: Record<string, number>;
  totalTasks: number;
  successCount: number;
}

interface TeamStatsResponse {
  teams: Record<string, TeamStats>;
}

function isVLLMModel(modelName: string): boolean {
  // Identify vLLM models by checking for:
  // - Contains "/" (namespace/model)
  // - Starts with "nvidia"
  // - Starts with "qwen3" (capital Q)
  // - Ends with "NVFP4" or "FP8"
  if (!modelName) return false;
  if (modelName.includes("/")) return true;
  if (modelName.startsWith("nvidia")) return true;
  if (modelName.startsWith("qwen3")) return true;
  if (modelName.endsWith("NVFP4") || modelName.endsWith("FP8")) return true;
  return false;
}

interface ModelCounts {
  vllm: number;
  ollama: number;
}

function countModels(modelUsage: Record<string, number>): ModelCounts {
  const counts: ModelCounts = { vllm: 0, ollama: 0 };
  for (const [model, count] of Object.entries(modelUsage)) {
    if (isVLLMModel(model)) {
      counts.vllm += count;
    } else {
      counts.ollama += count;
    }
  }
  return counts;
}

export default function ModelSplitChart() {
  const { data } = useApi<TeamStatsResponse>("/api/learning/team-stats", 10000);

  if (!data?.teams) {
    return (
      <div className="panel">
        <h3 className="text-sm font-semibold mb-2">Model Backend Split</h3>
        <p className="text-swarm-muted text-xs">Loading...</p>
      </div>
    );
  }

  const teams = ["team-alpha", "team-beta"];
  const noData =
    !teams.some((t) => data.teams[t]?.modelUsage && Object.keys(data.teams[t].modelUsage).length > 0);

  if (noData) {
    return (
      <div className="panel">
        <h3 className="text-sm font-semibold mb-2">Model Backend Split</h3>
        <p className="text-swarm-muted text-xs">No model usage data yet</p>
      </div>
    );
  }

  return (
    <div className="panel">
      <h3 className="text-sm font-semibold mb-3">Model Backend Split</h3>
      <div className="space-y-3">
        {teams.map((teamId) => {
          const teamStats = data.teams[teamId];
          if (!teamStats?.modelUsage || Object.keys(teamStats.modelUsage).length === 0) {
            return null;
          }

          const counts = countModels(teamStats.modelUsage);
          const total = counts.vllm + counts.ollama;
          const vllmPercent = total > 0 ? Math.round((counts.vllm / total) * 100) : 0;
          const ollamaPercent = 100 - vllmPercent;

          const label = teamId === "team-alpha" ? "ALPHA" : "BETA";

          return (
            <div key={teamId}>
              <div className="flex items-center justify-between mb-1.5">
                <span className="text-xs font-semibold text-gray-300">{label}</span>
                <span className="text-[10px] text-swarm-muted">
                  vLLM:{counts.vllm} Ollama:{counts.ollama}
                </span>
              </div>

              {/* Progress bar */}
              <div className="flex gap-1 h-5 rounded-sm overflow-hidden bg-swarm-bg/50">
                {counts.vllm > 0 && (
                  <div
                    className="bg-amber-600/70 flex items-center justify-center text-[9px] font-mono font-bold text-amber-100"
                    style={{ width: `${vllmPercent}%` }}
                    title={`vLLM: ${vllmPercent}%`}
                  >
                    {vllmPercent > 15 && `${vllmPercent}%`}
                  </div>
                )}
                {counts.ollama > 0 && (
                  <div
                    className="bg-emerald-600/70 flex items-center justify-center text-[9px] font-mono font-bold text-emerald-100"
                    style={{ width: `${ollamaPercent}%` }}
                    title={`Ollama: ${ollamaPercent}%`}
                  >
                    {ollamaPercent > 15 && `${ollamaPercent}%`}
                  </div>
                )}
              </div>
            </div>
          );
        })}
      </div>

      {/* Legend */}
      <div className="mt-3 flex gap-3 text-[10px] text-swarm-muted">
        <div className="flex items-center gap-1">
          <div className="w-3 h-3 rounded-sm bg-amber-600/70" />
          <span>vLLM</span>
        </div>
        <div className="flex items-center gap-1">
          <div className="w-3 h-3 rounded-sm bg-emerald-600/70" />
          <span>Ollama</span>
        </div>
      </div>
    </div>
  );
}
