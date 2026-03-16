import { useApi } from "../hooks/useApi";
import type { SnapshotResponse } from "../types";

interface ModelLatencyData {
  models: Array<{
    name: string;
    p50: number;
    p95?: number;
  }>;
}

function getLatencyColor(ms: number): string {
  if (ms < 5000) return "#10b981"; // green
  if (ms < 30000) return "#f59e0b"; // yellow/amber
  return "#ef4444"; // red
}

export default function ModelLatencyChart({ snapshot }: { snapshot: SnapshotResponse | null }) {
  const { data: latencyData } = useApi<ModelLatencyData>("/api/models/latency", 15000);

  const gpu = snapshot?.system?.gpu;
  const gpuMemPct = gpu?.totalMb ? ((gpu.usedMb ?? 0) / (gpu.totalMb ?? 1)) * 100 : 0;

  if (!latencyData?.models || latencyData.models.length === 0) {
    return (
      <div className="panel">
        <h3 className="text-sm font-semibold mb-2">Model Latency</h3>
        <p className="text-swarm-muted text-xs">No latency data available</p>
      </div>
    );
  }

  const maxLatency = Math.max(...latencyData.models.map(m => m.p50 || 0));

  return (
    <div className="panel">
      <h3 className="text-sm font-semibold mb-4">Model Latency (p50)</h3>

      <div className="space-y-3">
        {latencyData.models.map((model) => {
          const p50 = model.p50 || 0;
          const barWidth = maxLatency > 0 ? (p50 / maxLatency) * 100 : 0;
          const color = getLatencyColor(p50);

          return (
            <div key={model.name}>
              <div className="flex items-center justify-between mb-1">
                <span className="text-xs font-medium text-gray-200">{model.name}</span>
                <span className="text-xs" style={{ color }}>{p50.toFixed(0)}ms</span>
              </div>
              <div className="w-full bg-swarm-bg rounded h-2">
                <div
                  className="h-2 rounded transition-all"
                  style={{
                    width: `${barWidth}%`,
                    backgroundColor: color,
                  }}
                />
              </div>
            </div>
          );
        })}
      </div>

      {gpu && (
        <div className="border-t border-swarm-border mt-4 pt-3">
          <div className="text-xs font-medium text-swarm-muted mb-2">GPU Memory</div>
          <div className="flex items-center justify-between text-xs mb-1">
            <span className="text-swarm-muted">Usage</span>
            <span className="text-gray-100">
              {gpu.usedMb?.toFixed(0) ?? 0} / {gpu.totalMb?.toFixed(0) ?? 0} MB ({gpuMemPct.toFixed(1)}%)
            </span>
          </div>
          <div className="w-full bg-swarm-bg rounded-full h-2">
            <div
              className="bg-purple-500 h-2 rounded-full"
              style={{ width: `${Math.min(gpuMemPct, 100)}%` }}
            />
          </div>
        </div>
      )}
    </div>
  );
}
