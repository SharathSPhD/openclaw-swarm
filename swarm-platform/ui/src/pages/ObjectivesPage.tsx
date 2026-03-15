import { useState } from "react";
import { useApi } from "../hooks/useApi";

interface ObjectiveRow {
  objectiveId: string;
  teamId: string;
  objective: string;
  status: string;
  updatedAt: string;
  steps?: Array<{ ts: string; type: string; summary: string }>;
}

interface SwarmSession {
  id: string;
  objectiveId: string;
  teamId: string;
  objective: string;
  status: string;
  iterations: number;
  createdAt: string;
  updatedAt: string;
}

interface TraceEntry {
  id: string;
  ts: string;
  type: string;
  teamId: string;
  source: string;
  role: string | null;
  model: string | null;
  taskId: string | null;
  output: string | null;
  toolCalls: unknown[] | null;
  reasoningTrace: string | null;
  durationMs: number | null;
  correctness: number | null;
  error: string | null;
  feedback: string | null;
  pointsAdded: number | null;
  pointsDeducted: number | null;
  reason: string | null;
}

interface ObjectivesResponse { objectives: ObjectiveRow[] }
interface SessionsResponse { sessions: SwarmSession[] }
interface TracesResponse { objectiveId: string; traces: TraceEntry[] }

function TracePanel({ objectiveId }: { objectiveId: string }) {
  const { data } = useApi<TracesResponse>(`/api/agent-traces/${objectiveId}`, 8000);
  const traces = data?.traces ?? [];

  if (traces.length === 0) return <p className="text-xs text-swarm-muted">No traces</p>;

  return (
    <div className="space-y-1 max-h-96 overflow-y-auto">
      {traces.map((t) => (
        <div key={t.id} className="text-xs border-l-2 border-swarm-border pl-2 py-1">
          <div className="flex gap-2 text-swarm-muted">
            <span>{new Date(t.ts).toLocaleTimeString()}</span>
            <span className="font-mono">{t.type}</span>
            {t.role && <span className="chip chip-normal text-[10px]">{t.role}</span>}
            {t.model && <span className="text-blue-400">{t.model}</span>}
            {t.durationMs != null && <span>{(t.durationMs / 1000).toFixed(1)}s</span>}
            {t.correctness != null && <span className="text-green-400">{(t.correctness * 100).toFixed(0)}%</span>}
          </div>
          {t.error && <p className="text-red-400 mt-0.5">Error: {t.error}</p>}
          {t.feedback && <p className="text-yellow-400 mt-0.5">Feedback: {t.feedback}</p>}
          {t.pointsAdded != null && <p className="text-green-400 mt-0.5">+{t.pointsAdded} pts: {t.reason}</p>}
          {t.pointsDeducted != null && <p className="text-red-400 mt-0.5">-{t.pointsDeducted} pts: {t.reason}</p>}
          {t.output && (
            <details className="mt-1">
              <summary className="cursor-pointer text-swarm-muted">Output</summary>
              <pre className="mt-1 text-[10px] whitespace-pre-wrap bg-swarm-bg p-2 rounded max-h-40 overflow-y-auto">
                {t.output}
              </pre>
            </details>
          )}
          {t.toolCalls && Array.isArray(t.toolCalls) && t.toolCalls.length > 0 && (
            <p className="text-swarm-muted mt-0.5">Tools: {t.toolCalls.map((tc: any) => tc.name).join(", ")}</p>
          )}
        </div>
      ))}
    </div>
  );
}

function ObjectiveCard({
  obj,
  sessions,
  expanded,
  onToggle,
}: {
  obj: ObjectiveRow;
  sessions: SwarmSession[];
  expanded: boolean;
  onToggle: () => void;
}) {
  const session = sessions.find((s) => s.objectiveId === obj.objectiveId);
  const statusClass =
    obj.status === "completed"
      ? "chip-normal"
      : obj.status === "failed"
        ? "chip-critical"
        : "chip-elevated";

  return (
    <div className="panel cursor-pointer" onClick={onToggle}>
      <div className="flex justify-between items-start">
        <div className="flex-1 min-w-0">
          <p className="text-sm font-medium truncate">{obj.objective || obj.objectiveId}</p>
          <p className="text-xs text-swarm-muted mt-1">
            {obj.teamId} &bull; {obj.objectiveId}
          </p>
        </div>
        <span className={`chip ${statusClass} shrink-0 ml-2`}>{obj.status}</span>
      </div>
      {expanded && (
        <div className="mt-3 pt-3 border-t border-swarm-border text-xs space-y-2" onClick={(e) => e.stopPropagation()}>
          {session && (
            <div className="flex gap-4">
              <span><span className="text-swarm-muted">Iterations:</span> {session.iterations}</span>
              <span><span className="text-swarm-muted">Status:</span> {session.status}</span>
              <span><span className="text-swarm-muted">Created:</span> {new Date(session.createdAt).toLocaleString()}</span>
            </div>
          )}
          {obj.steps?.length ? (
            <div>
              <span className="text-swarm-muted">Steps:</span>
              <ul className="list-disc list-inside mt-1">
                {obj.steps.slice(-5).map((s, i) => (
                  <li key={i}>
                    {s.type} — {s.summary || "—"}
                  </li>
                ))}
              </ul>
            </div>
          ) : null}
          <div className="mt-2 pt-2 border-t border-swarm-border">
            <h4 className="text-xs font-semibold text-swarm-muted mb-2">Agent Traces</h4>
            <TracePanel objectiveId={obj.objectiveId} />
          </div>
        </div>
      )}
    </div>
  );
}

export default function ObjectivesPage() {
  const { data: objectivesData } = useApi<ObjectivesResponse>("/api/objectives", 5000);
  const { data: sessionsData } = useApi<SessionsResponse>("/api/swarm-sessions", 5000);
  const [expandedId, setExpandedId] = useState<string | null>(null);

  const objectives = objectivesData?.objectives ?? [];
  const sessions = sessionsData?.sessions ?? [];

  const active = objectives.filter((o) => o.status !== "completed" && o.status !== "failed");
  const completed = objectives.filter((o) => o.status === "completed");
  const failed = objectives.filter((o) => o.status === "failed");

  const renderColumn = (title: string, items: ObjectiveRow[]) => (
    <div className="flex-1 min-w-0">
      <h3 className="text-sm font-semibold mb-3 text-swarm-muted">{title} ({items.length})</h3>
      <div className="space-y-2">
        {items.length === 0 ? (
          <p className="text-sm text-swarm-muted">None</p>
        ) : (
          items.map((obj) => (
            <ObjectiveCard
              key={obj.objectiveId}
              obj={obj}
              sessions={sessions}
              expanded={expandedId === obj.objectiveId}
              onToggle={() => setExpandedId(expandedId === obj.objectiveId ? null : obj.objectiveId)}
            />
          ))
        )}
      </div>
    </div>
  );

  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-bold">Objectives</h1>
      <div className="flex gap-6 flex-wrap">
        {renderColumn("Active", active)}
        {renderColumn("Completed", completed)}
        {renderColumn("Failed", failed)}
      </div>
    </div>
  );
}
