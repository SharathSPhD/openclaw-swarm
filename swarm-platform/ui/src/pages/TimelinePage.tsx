import { useApi } from "../hooks/useApi";
import type { FlowRow } from "../types";

interface FlowResponse {
  flow: FlowRow[];
}

function statusChip(status: string) {
  const c =
    status === "completed"
      ? "chip-normal"
      : status === "failed" || status === "rejected"
        ? "chip-critical"
        : status === "running" || status === "assigned"
          ? "chip-elevated"
          : "chip-high";
  return <span className={`chip ${c}`}>{status}</span>;
}

export default function TimelinePage() {
  const { data } = useApi<FlowResponse>("/api/flow", 5000);
  const flow = data?.flow ?? [];

  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-bold">Task Flow Timeline</h1>
      <div className="panel overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="text-left text-swarm-muted border-b border-swarm-border">
              <th className="pb-3 pr-4">Task ID</th>
              <th className="pb-3 pr-4">Objective</th>
              <th className="pb-3 pr-4">Team</th>
              <th className="pb-3 pr-4">Role</th>
              <th className="pb-3 pr-4">Status</th>
              <th className="pb-3 pr-4">Model</th>
              <th className="pb-3 pr-4">Internal</th>
              <th className="pb-3 pr-4">TG</th>
              <th className="pb-3 pr-4">Last Update</th>
            </tr>
          </thead>
          <tbody>
            {flow.length === 0 ? (
              <tr>
                <td colSpan={9} className="py-8 text-center text-swarm-muted">
                  No flow data
                </td>
              </tr>
            ) : (
              flow.map((row) => (
                <tr key={row.taskId} className="border-b border-swarm-border/50">
                  <td className="py-2 pr-4 font-mono text-xs truncate max-w-[120px]">{row.taskId}</td>
                  <td className="py-2 pr-4 truncate max-w-[180px]" title={row.objective}>
                    {row.objective || "—"}
                  </td>
                  <td className="py-2 pr-4">{row.teamId}</td>
                  <td className="py-2 pr-4">{row.role}</td>
                  <td className="py-2 pr-4">{statusChip(row.status)}</td>
                  <td className="py-2 pr-4">{row.model || "—"}</td>
                  <td className="py-2 pr-4">{row.internalMessages ?? 0}</td>
                  <td className="py-2 pr-4">{row.telegramUpdates ?? 0}</td>
                  <td className="py-2 pr-4 text-swarm-muted">
                    {row.lastUpdate ? new Date(row.lastUpdate).toLocaleString() : "—"}
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
