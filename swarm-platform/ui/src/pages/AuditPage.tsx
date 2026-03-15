import { useState, useMemo } from "react";
import { useApi } from "../hooks/useApi";

interface AuditRow {
  id: string;
  ts: string;
  teamId: string;
  type: string;
  taskId: string | null;
  source: string;
  detail: string | null;
}

interface AuditResponse {
  audit: AuditRow[];
}

export default function AuditPage() {
  const { data } = useApi<AuditResponse>("/api/audit", 5000);
  const [teamFilter, setTeamFilter] = useState("");
  const [typeFilter, setTypeFilter] = useState("");

  const audit = data?.audit ?? [];
  const teams = useMemo(() => [...new Set(audit.map((a) => a.teamId))], [audit]);
  const types = useMemo(() => [...new Set(audit.map((a) => a.type))], [audit]);

  const filtered = useMemo(() => {
    return audit.filter((a) => {
      if (teamFilter && a.teamId !== teamFilter) return false;
      if (typeFilter && a.type !== typeFilter) return false;
      return true;
    });
  }, [audit, teamFilter, typeFilter]);

  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-bold">Audit</h1>

      <div className="panel flex flex-wrap gap-4">
        <div>
          <label className="block text-xs text-swarm-muted mb-1">Team</label>
          <select
            value={teamFilter}
            onChange={(e) => setTeamFilter(e.target.value)}
            className="bg-swarm-bg border border-swarm-border rounded px-3 py-2 text-sm"
          >
            <option value="">All</option>
            {teams.map((t) => (
              <option key={t} value={t}>
                {t}
              </option>
            ))}
          </select>
        </div>
        <div>
          <label className="block text-xs text-swarm-muted mb-1">Event Type</label>
          <select
            value={typeFilter}
            onChange={(e) => setTypeFilter(e.target.value)}
            className="bg-swarm-bg border border-swarm-border rounded px-3 py-2 text-sm"
          >
            <option value="">All</option>
            {types.map((t) => (
              <option key={t} value={t}>
                {t}
              </option>
            ))}
          </select>
        </div>
      </div>

      <div className="panel overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="text-left text-swarm-muted border-b border-swarm-border">
              <th className="pb-3 pr-4">Timestamp</th>
              <th className="pb-3 pr-4">Team</th>
              <th className="pb-3 pr-4">Type</th>
              <th className="pb-3 pr-4">Task ID</th>
              <th className="pb-3 pr-4">Source</th>
              <th className="pb-3 pr-4">Detail</th>
            </tr>
          </thead>
          <tbody>
            {filtered.length === 0 ? (
              <tr>
                <td colSpan={6} className="py-8 text-center text-swarm-muted">
                  No audit events
                </td>
              </tr>
            ) : (
              filtered.slice().reverse().map((row) => (
                <tr key={row.id} className="border-b border-swarm-border/50">
                  <td className="py-2 pr-4 text-swarm-muted">{new Date(row.ts).toLocaleString()}</td>
                  <td className="py-2 pr-4">{row.teamId}</td>
                  <td className="py-2 pr-4">
                    <span className="chip chip-elevated">{row.type}</span>
                  </td>
                  <td className="py-2 pr-4 font-mono text-xs truncate max-w-[100px]">{row.taskId || "—"}</td>
                  <td className="py-2 pr-4">{row.source}</td>
                  <td className="py-2 pr-4 truncate max-w-[200px]" title={row.detail || ""}>
                    {row.detail || "—"}
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
