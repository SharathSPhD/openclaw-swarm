import { useApi } from "../hooks/useApi";

interface GammaInsight {
  ts: string;
  discoveries: string;
  recommendations: string;
}

interface GammaInsightsResponse {
  insights: GammaInsight[];
}

export default function GammaDiscoveriesPanel() {
  const { data } = useApi<GammaInsightsResponse>("/api/competitive/gamma-insights", 15000);
  const insights = data?.insights || [];

  if (insights.length === 0) {
    return (
      <div className="panel">
        <h3 className="text-sm font-semibold mb-2">Gamma Discoveries</h3>
        <p className="text-swarm-muted text-xs">No discoveries yet. Gamma runs after each competitive round.</p>
      </div>
    );
  }

  return (
    <div className="panel">
      <div className="flex items-center justify-between mb-3">
        <h3 className="text-sm font-semibold">Gamma Discoveries</h3>
        <span className="chip chip-elevated text-[10px]">{insights.length} entries</span>
      </div>
      <div className="space-y-3 max-h-72 overflow-y-auto">
        {[...insights].reverse().map((insight, i) => (
          <div key={i} className="border-l-2 border-amber-500 pl-3 text-xs">
            <div className="text-swarm-muted mb-1">{new Date(insight.ts).toLocaleString()}</div>
            {insight.discoveries && (
              <div className="mb-1">
                <span className="text-amber-400 font-medium">Discoveries: </span>
                <span className="text-gray-300">{insight.discoveries.slice(0, 300)}</span>
              </div>
            )}
            {insight.recommendations && (
              <div>
                <span className="text-emerald-400 font-medium">Recommendations: </span>
                <span className="text-gray-300">{insight.recommendations.slice(0, 200)}</span>
              </div>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}
