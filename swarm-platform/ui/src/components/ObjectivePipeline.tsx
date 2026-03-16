import { useState, useEffect } from "react";
import { useApi } from "../hooks/useApi";
import type { WsMessage } from "../types";

interface CompetitiveStatusData {
  phase: string;
  roundsCompleted?: number;
  objective?: {
    objectiveId?: string;
    objective?: string;
    phase?: string;
  } | null;
}

interface ObjectiveData {
  objectiveId: string;
  objective: string;
  status: string;
  createdAt: string;
}

interface AutonomyObjectivesData {
  completed: ObjectiveData[];
}

interface Props {
  lastMessage?: WsMessage | null;
}

const PHASES = [
  { key: "idle", label: "Idle" },
  { key: "forking", label: "Fork Alpha+Beta" },
  { key: "evaluating", label: "Evaluate" },
  { key: "implementing", label: "Gamma Implement" },
  { key: "merging", label: "Merge" },
];

const WS_EVENT_TO_PHASE: Record<string, string> = {
  "competitive.started": "forking",
  "competitive.evaluated": "evaluating",
  "competitive.implementing": "implementing",
  "competitive.merged": "idle",
};

export default function ObjectivePipeline({ lastMessage }: Props) {
  const { data: competitiveStatus } = useApi<CompetitiveStatusData>("/api/competitive/status", 3000);
  const { data: autonomyStatus } = useApi<{ currentObjective: { objective?: string } | null }>(
    "/api/dashboard/autonomy-status",
    4000
  );
  const { data: objectivesData } = useApi<AutonomyObjectivesData>("/api/autonomy/objectives", 5000);

  const [phaseStartTime, setPhaseStartTime] = useState<number>(Date.now());
  const [elapsedSec, setElapsedSec] = useState<number>(0);
  const [lastPhase, setLastPhase] = useState<string>("idle");
  const [wsPhase, setWsPhase] = useState<string | null>(null);

  // Derive phase from WebSocket events for real-time updates
  useEffect(() => {
    if (!lastMessage?.type) return;
    const mapped = WS_EVENT_TO_PHASE[lastMessage.type];
    if (mapped) {
      setWsPhase(mapped);
    }
  }, [lastMessage]);

  const currentPhase = wsPhase || competitiveStatus?.phase || "idle";
  const currentObjective = autonomyStatus?.currentObjective?.objective || competitiveStatus?.objective?.objective;

  // Clear wsPhase when polling catches up
  useEffect(() => {
    if (competitiveStatus?.phase && wsPhase && competitiveStatus.phase === wsPhase) {
      setWsPhase(null);
    }
  }, [competitiveStatus?.phase, wsPhase]);

  // Track phase changes and reset timer
  useEffect(() => {
    if (currentPhase !== lastPhase) {
      setLastPhase(currentPhase);
      setPhaseStartTime(Date.now());
      setElapsedSec(0);
    }
  }, [currentPhase, lastPhase]);

  // Update elapsed time every second
  useEffect(() => {
    const timer = setInterval(() => {
      const now = Date.now();
      const elapsed = Math.floor((now - phaseStartTime) / 1000);
      setElapsedSec(elapsed);
    }, 1000);
    return () => clearInterval(timer);
  }, [phaseStartTime]);

  const completedObjectives = objectivesData?.completed || [];
  const recentObjectives = completedObjectives.slice(0, 5);

  const phaseOrder = PHASES.map(p => p.key);
  const currentIdx = phaseOrder.indexOf(currentPhase);

  const getPhaseState = (phaseKey: string): "active" | "done" | "pending" => {
    const idx = phaseOrder.indexOf(phaseKey);
    if (phaseKey === currentPhase) return "active";
    if (currentPhase === "idle") return "pending";
    if (idx < currentIdx) return "done";
    return "pending";
  };

  return (
    <div className="panel">
      <h3 className="text-sm font-semibold mb-4">Objective Pipeline</h3>

      {/* Current objective */}
      {currentObjective && (
        <div className="mb-4 p-3 rounded bg-swarm-bg border border-swarm-border/50">
          <p className="text-xs text-swarm-muted mb-1">Current Objective</p>
          <p className="text-sm truncate">{currentObjective.slice(0, 100)}...</p>
        </div>
      )}

      {/* Pipeline visualization */}
      <div className="mb-4 overflow-x-auto">
        <div className="flex gap-2 min-w-max">
          {PHASES.map((phase, idx) => {
            const state = getPhaseState(phase.key);
            return (
              <div key={phase.key} className="flex items-center gap-2">
                <div
                  className={`w-20 px-2 py-2 rounded text-center text-[10px] font-medium transition-all ${
                    state === "active"
                      ? "bg-swarm-accent text-white animate-pulse"
                      : state === "done"
                      ? "bg-emerald-900/40 border border-emerald-500/40 text-emerald-400"
                      : "bg-swarm-bg border border-swarm-border text-swarm-muted"
                  }`}
                >
                  {state === "done" ? `${phase.label}` : phase.label}
                </div>
                {idx < PHASES.length - 1 && (
                  <div className={`text-xs ${state === "done" ? "text-emerald-500" : "text-swarm-muted"}`}>→</div>
                )}
              </div>
            );
          })}
        </div>
      </div>

      {/* Elapsed time for current phase */}
      {currentPhase !== "idle" && (
        <div className="text-xs text-swarm-muted mb-4">
          Phase elapsed: <span className="text-gray-100 font-medium">{elapsedSec}s</span>
        </div>
      )}

      {/* Recent completed objectives */}
      {recentObjectives.length > 0 && (
        <div className="border-t border-swarm-border pt-3">
          <p className="text-xs font-medium text-swarm-muted mb-2">Last 5 Completed</p>
          <div className="space-y-1 max-h-32 overflow-y-auto">
            {recentObjectives.map((obj) => (
              <div key={obj.objectiveId} className="text-xs text-swarm-muted border-l-2 border-emerald-500 pl-2 py-0.5 truncate">
                {obj.objective.slice(0, 80)}...
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
