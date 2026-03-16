import { useApi } from "../hooks/useApi";

interface GpuMetrics {
  utilization: number;
  memoryUsed: number;
  memoryTotal: number;
}

interface LatencyMetrics {
  byModel: Record<string, number>;
  recentAvg: number;
  p95: number;
  sampleCount: number;
}

interface ThroughputMetrics {
  perHour: number;
  perMinute: number;
  successRate: number;
  queueDepth: number;
}

interface VllmInfo {
  available: boolean;
  models: string[];
  url: string;
  error: string | null;
}

interface MetricsSummary {
  gpu: GpuMetrics | null;
  runningModels: string[];
  ollamaOk: boolean;
  latency: LatencyMetrics;
  throughput: ThroughputMetrics;
  vllm?: VllmInfo | null;
}

function getSuccessRateChip(successRate: number): string {
  if (successRate >= 0.8) return "chip-normal";
  if (successRate >= 0.6) return "chip-elevated";
  return "chip-high";
}

function getSuccessRateColor(successRate: number): string {
  if (successRate >= 0.8) return "text-emerald-400";
  if (successRate >= 0.6) return "text-yellow-400";
  return "text-orange-400";
}

export default function MetricsPanel() {
  const { data } = useApi<MetricsSummary>("/api/metrics/summary", 10000);

  if (!data) {
    return (
      <div className="panel">
        <h3 className="text-sm font-semibold mb-3">Real-time Metrics</h3>
        <p className="text-swarm-muted text-xs">Loading metrics...</p>
      </div>
    );
  }

  const gpu = data.gpu;
  const latency = data.latency;
  const throughput = data.throughput;

  return (
    <div className="panel">
      <h3 className="text-sm font-semibold mb-4">Real-time Metrics</h3>

      <div className="space-y-4">
        {/* GPU Status */}
        <div>
          <div className="flex items-center justify-between mb-2">
            <span className="text-xs font-medium text-swarm-muted">GPU Status</span>
            {gpu ? (
              <span className="chip chip-normal text-[10px]">
                {data.ollamaOk ? "OK" : "Offline"}
              </span>
            ) : null}
          </div>
          {gpu ? (
            <div className="space-y-2">
              <div className="flex items-center justify-between text-xs">
                <span className="text-swarm-muted">Utilization</span>
                <span className="text-gray-100">{gpu.utilization.toFixed(1)}%</span>
              </div>
              <div className="w-full bg-swarm-bg rounded-full h-2">
                <div
                  className="bg-blue-500 h-2 rounded-full"
                  style={{ width: `${Math.min(gpu.utilization, 100)}%` }}
                />
              </div>
              <div className="flex items-center justify-between text-xs">
                <span className="text-swarm-muted">Memory</span>
                <span className="text-gray-100">
                  {gpu.memoryUsed.toFixed(0)} / {gpu.memoryTotal.toFixed(0)} MB
                </span>
              </div>
              <div className="w-full bg-swarm-bg rounded-full h-2">
                <div
                  className="bg-purple-500 h-2 rounded-full"
                  style={{
                    width: `${Math.min((gpu.memoryUsed / gpu.memoryTotal) * 100, 100)}%`,
                  }}
                />
              </div>
            </div>
          ) : (
            <p className="text-xs text-swarm-muted">GPU: N/A</p>
          )}
        </div>

        {/* Running Models */}
        {data.runningModels && data.runningModels.length > 0 && (
          <div>
            <span className="text-xs font-medium text-swarm-muted block mb-2">
              Running Models
            </span>
            <div className="flex flex-wrap gap-1">
              {data.runningModels.map((model) => (
                <span key={model} className="chip chip-normal text-[10px]">
                  {model}
                </span>
              ))}
            </div>
          </div>
        )}

        {/* vLLM Status */}
        <div className="border-t border-swarm-border pt-3">
          <div className="flex items-center justify-between mb-2">
            <span className="text-xs font-medium text-swarm-muted">vLLM Inference</span>
            {data.vllm != null ? (
              <span className={`chip text-[10px] ${data.vllm.available ? "chip-normal" : "chip-critical"}`}>
                {data.vllm.available ? "Online" : "Offline"}
              </span>
            ) : (
              <span className="chip chip-elevated text-[10px]">Unknown</span>
            )}
          </div>
          {data.vllm?.available && data.vllm.models.length > 0 && (
            <div className="flex flex-wrap gap-1">
              {data.vllm.models.map(m => (
                <span key={m} className="chip chip-elevated text-[10px]">{m.split("/").pop()}</span>
              ))}
            </div>
          )}
          {data.vllm?.error && (
            <p className="text-xs text-red-400">{data.vllm.error}</p>
          )}
          {data.vllm == null && (
            <p className="text-xs text-swarm-muted">Checking http://127.0.0.1:8000...</p>
          )}
        </div>

        {/* Throughput */}
        <div className="border-t border-swarm-border pt-3">
          <div className="text-xs font-medium text-swarm-muted mb-2">Throughput</div>
          <div className="grid grid-cols-2 gap-3">
            <div className="flex flex-col">
              <span className="text-swarm-muted text-[10px]">Per Hour</span>
              <span className="text-sm font-medium">{throughput.perHour}</span>
            </div>
            <div className="flex flex-col">
              <span className="text-swarm-muted text-[10px]">Per Minute</span>
              <span className="text-sm font-medium">{throughput.perMinute}</span>
            </div>
            <div className="flex flex-col">
              <span className="text-swarm-muted text-[10px]">Queue Depth</span>
              <span className="text-sm font-medium">{throughput.queueDepth}</span>
            </div>
            <div className="flex flex-col">
              <span className="text-swarm-muted text-[10px]">Success Rate</span>
              <span
                className={`text-sm font-medium ${getSuccessRateColor(
                  throughput.successRate
                )}`}
              >
                {(throughput.successRate * 100).toFixed(1)}%
              </span>
            </div>
          </div>
        </div>

        {/* Latency */}
        <div className="border-t border-swarm-border pt-3">
          <div className="text-xs font-medium text-swarm-muted mb-2">Latency</div>
          <div className="grid grid-cols-2 gap-3">
            <div className="flex flex-col">
              <span className="text-swarm-muted text-[10px]">Average</span>
              <span className="text-sm font-medium">{latency.recentAvg.toFixed(0)}ms</span>
            </div>
            <div className="flex flex-col">
              <span className="text-swarm-muted text-[10px]">P95</span>
              <span className="text-sm font-medium">{latency.p95.toFixed(0)}ms</span>
            </div>
          </div>
          {latency.sampleCount > 0 && (
            <p className="text-[10px] text-swarm-muted mt-2">
              Samples: {latency.sampleCount}
            </p>
          )}
        </div>
      </div>
    </div>
  );
}
