import { useApi } from "../hooks/useApi";
import { AreaChart, Area, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer } from "recharts";
import type { SnapshotResponse } from "../types";

interface OpsPageProps {
  snapshot: SnapshotResponse | null;
}

interface GpuSnapshot {
  ts: string;
  total_memory_pct: number | null;
  total_util_pct: number | null;
  active_agents: number;
}

interface GpuHistoryResponse {
  snapshots: GpuSnapshot[];
}

interface ModelsResponse {
  inventory: { models: Array<{ id: string; size?: string }>; available: boolean };
  routing: { roleRoutes?: Record<string, { tier: string; primary: string; fallback: string[] }> };
}

interface QueueResponse {
  depth: number;
  items: Array<{ taskId: string; teamId: string; task: string; role: string }>;
}

export default function OpsPage({ snapshot }: OpsPageProps) {
  const { data: gpuData } = useApi<GpuHistoryResponse>("/api/gpu-history?limit=100", 5000);
  const { data: modelsData } = useApi<ModelsResponse>("/api/models", 5000);
  const { data: queueData } = useApi<QueueResponse>("/api/queue", 5000);

  const snapshots = (gpuData?.snapshots ?? []).slice().reverse();
  const chartData = snapshots.map((s) => ({
    ts: new Date(s.ts).toLocaleTimeString(),
    memory: s.total_memory_pct ?? 0,
    util: s.total_util_pct ?? 0,
  }));

  const routing = modelsData?.routing?.roleRoutes ?? {};
  const queueItems = queueData?.items ?? [];
  const queueDepth = queueData?.depth ?? 0;

  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-bold">Ops</h1>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <div className="panel">
          <h3 className="text-sm font-semibold mb-3">GPU Memory %</h3>
          {chartData.length > 0 ? (
            <div className="h-48">
              <ResponsiveContainer width="100%" height="100%">
                <AreaChart data={chartData}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#374151" />
                  <XAxis dataKey="ts" stroke="#6b7280" tick={{ fontSize: 10 }} />
                  <YAxis stroke="#6b7280" tick={{ fontSize: 10 }} domain={[0, 100]} />
                  <Tooltip contentStyle={{ backgroundColor: "#111827", border: "1px solid #1f2937" }} />
                  <Area type="monotone" dataKey="memory" stroke="#3b82f6" fill="#3b82f6/20" />
                </AreaChart>
              </ResponsiveContainer>
            </div>
          ) : (
            <p className="text-swarm-muted text-sm">No GPU history (DB may be disabled)</p>
          )}
        </div>

        <div className="panel">
          <h3 className="text-sm font-semibold mb-3">GPU Utilization %</h3>
          {chartData.length > 0 ? (
            <div className="h-48">
              <ResponsiveContainer width="100%" height="100%">
                <AreaChart data={chartData}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#374151" />
                  <XAxis dataKey="ts" stroke="#6b7280" tick={{ fontSize: 10 }} />
                  <YAxis stroke="#6b7280" tick={{ fontSize: 10 }} domain={[0, 100]} />
                  <Tooltip contentStyle={{ backgroundColor: "#111827", border: "1px solid #1f2937" }} />
                  <Area type="monotone" dataKey="util" stroke="#10b981" fill="#10b981/20" />
                </AreaChart>
              </ResponsiveContainer>
            </div>
          ) : (
            <p className="text-swarm-muted text-sm">No GPU history</p>
          )}
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <div className="panel">
          <h3 className="text-sm font-semibold mb-3">Model Matrix (Role → Model)</h3>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left text-swarm-muted border-b border-swarm-border">
                  <th className="pb-2 pr-4">Role</th>
                  <th className="pb-2 pr-4">Tier</th>
                  <th className="pb-2 pr-4">Primary</th>
                  <th className="pb-2 pr-4">Fallback</th>
                </tr>
              </thead>
              <tbody>
                {Object.entries(routing).length === 0 ? (
                  <tr>
                    <td colSpan={4} className="py-4 text-center text-swarm-muted">
                      No role routes
                    </td>
                  </tr>
                ) : (
                  Object.entries(routing).map(([role, route]) => (
                    <tr key={role} className="border-b border-swarm-border/50">
                      <td className="py-2 pr-4">{role}</td>
                      <td className="py-2 pr-4">{route.tier}</td>
                      <td className="py-2 pr-4">{route.primary}</td>
                      <td className="py-2 pr-4">{Array.isArray(route.fallback) ? route.fallback.join(", ") : "—"}</td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </div>

        <div className="panel">
          <h3 className="text-sm font-semibold mb-3">Queue ({queueDepth})</h3>
          <div className="space-y-2 max-h-48 overflow-y-auto">
            {queueItems.length === 0 ? (
              <p className="text-swarm-muted text-sm">Queue empty</p>
            ) : (
              queueItems.slice(0, 20).map((item) => (
                <div key={item.taskId} className="text-sm border-b border-swarm-border/50 pb-2">
                  <span className="font-mono text-xs">{item.taskId}</span>
                  <p className="truncate text-swarm-muted">{item.task}</p>
                </div>
              ))
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
