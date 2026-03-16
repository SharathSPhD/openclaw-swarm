import { useState, useEffect } from "react";
import type { WsMessage } from "../types";

interface BattleViewProps {
  lastMessage: WsMessage | null;
  competitiveStatus: { phase: string; objective?: { objectiveId?: string; objective?: string; category?: string; phase?: string } | null } | null;
}

interface TeamActivity {
  lastRole: string | null;
  lastOutput: string | null;
  lastModel: string | null;
  lastTs: string | null;
  status: "idle" | "working" | "done" | "failed";
  taskCount: number;
}

const PHASE_CONFIG: Record<string, { label: string; color: string; activeTeams: string[]; order: number }> = {
  idle: { label: "STANDBY", color: "#6b7280", activeTeams: [], order: 0 },
  forking: { label: "COMPETING", color: "#3b82f6", activeTeams: ["team-alpha", "team-beta"], order: 1 },
  evaluating: { label: "EVALUATING", color: "#f59e0b", activeTeams: [], order: 2 },
  implementing: { label: "IMPLEMENTING", color: "#10b981", activeTeams: ["team-gamma"], order: 3 },
  merging: { label: "MERGING", color: "#a855f7", activeTeams: [], order: 4 },
};

const TEAM_CONFIG: Record<string, { label: string; color: string; accentClass: string }> = {
  "team-alpha": { label: "ALPHA", color: "#3b82f6", accentClass: "border-blue-500" },
  "team-beta": { label: "BETA", color: "#a855f7", accentClass: "border-purple-500" },
  "team-gamma": { label: "GAMMA", color: "#f59e0b", accentClass: "border-amber-500" },
};

function PulsingDot({ active, color }: { active: boolean; color: string }) {
  return (
    <span className="relative inline-flex h-3 w-3">
      {active && (
        <span
          className="animate-ping absolute inline-flex h-full w-full rounded-full opacity-75"
          style={{ backgroundColor: color }}
        />
      )}
      <span
        className="relative inline-flex rounded-full h-3 w-3"
        style={{ backgroundColor: active ? color : "#374151" }}
      />
    </span>
  );
}

function PhaseProgressBar({ currentPhase }: { currentPhase: string }) {
  const phases = ["FORK", "EVALUATE", "IMPLEMENT", "MERGE"];
  const phaseKeys = ["forking", "evaluating", "implementing", "merging"];
  const currentIndex = phaseKeys.indexOf(currentPhase);
  const colors = ["#3b82f6", "#f59e0b", "#10b981", "#a855f7"];

  return (
    <div className="flex items-center justify-between gap-2 mt-3">
      {phases.map((phase, idx) => {
        const isActive = idx === currentIndex && currentPhase !== "idle";
        const isComplete = idx < currentIndex;
        return (
          <div key={phase} className="flex flex-col items-center flex-1">
            <div
              className="w-6 h-6 rounded-full flex items-center justify-center text-[10px] font-bold transition-all"
              style={{
                backgroundColor: isActive || isComplete ? colors[idx] : "#374151",
                color: isActive || isComplete ? "white" : "#6b7280",
                boxShadow: isActive ? `0 0 8px ${colors[idx]}` : "none",
              }}
            >
              {isComplete ? "✓" : idx + 1}
            </div>
            <span className="text-[8px] font-mono text-swarm-muted mt-1">{phase}</span>
          </div>
        );
      })}
    </div>
  );
}

export default function CompetitiveBattleView({ lastMessage, competitiveStatus }: BattleViewProps) {
  const [alphaActivity, setAlphaActivity] = useState<TeamActivity>({ lastRole: null, lastOutput: null, lastModel: null, lastTs: null, status: "idle", taskCount: 0 });
  const [betaActivity, setBetaActivity] = useState<TeamActivity>({ lastRole: null, lastOutput: null, lastModel: null, lastTs: null, status: "idle", taskCount: 0 });
  const [gammaActivity, setGammaActivity] = useState<TeamActivity>({ lastRole: null, lastOutput: null, lastModel: null, lastTs: null, status: "idle", taskCount: 0 });
  const [handoffs, setHandoffs] = useState<Array<{ ts: string; teamId: string; fromRole: string; toRole: string; preview: string }>>([]);
  const [lastEvaluation, setLastEvaluation] = useState<{ winner: string; reasoning: string; alphaScore: number; betaScore: number } | null>(null);
  const [scoreFlashKey, setScoreFlashKey] = useState<string>("");

  useEffect(() => {
    if (!lastMessage) return;
    const p = lastMessage.payload as Record<string, unknown>;
    const teamId = String(lastMessage.teamId || p.teamId || "");

    const updateTeam = (setter: typeof setAlphaActivity, update: Partial<TeamActivity>) => {
      setter(prev => ({ ...prev, ...update }));
    };

    if (lastMessage.type === "task.started") {
      const update: Partial<TeamActivity> = { status: "working", lastRole: String(p.role || "?"), lastModel: String(p.model || "?"), lastTs: lastMessage.ts };
      if (teamId === "team-alpha") updateTeam(setAlphaActivity, { ...update, taskCount: alphaActivity.taskCount + 1 });
      if (teamId === "team-beta") updateTeam(setBetaActivity, { ...update, taskCount: betaActivity.taskCount + 1 });
      if (teamId === "team-gamma") updateTeam(setGammaActivity, { ...update, taskCount: gammaActivity.taskCount + 1 });
    } else if (lastMessage.type === "task.completed") {
      const update: Partial<TeamActivity> = { status: "done", lastOutput: (String(p.output || "")).slice(0, 120) };
      if (teamId === "team-alpha") updateTeam(setAlphaActivity, update);
      if (teamId === "team-beta") updateTeam(setBetaActivity, update);
      if (teamId === "team-gamma") updateTeam(setGammaActivity, update);
    } else if (lastMessage.type === "task.failed") {
      const update: Partial<TeamActivity> = { status: "failed" };
      if (teamId === "team-alpha") updateTeam(setAlphaActivity, update);
      if (teamId === "team-beta") updateTeam(setBetaActivity, update);
      if (teamId === "team-gamma") updateTeam(setGammaActivity, update);
    } else if (lastMessage.type === "agent.handoff") {
      setHandoffs(prev => [{
        ts: lastMessage.ts,
        teamId,
        fromRole: String(p.fromRole || "?"),
        toRole: String(p.toRole || "?"),
        preview: (String(p.outputPreview || p.messageContent || "")).slice(0, 100)
      }, ...prev].slice(0, 20));
    } else if (lastMessage.type === "competitive.evaluated") {
      setLastEvaluation({
        winner: String(p.winner || ""),
        reasoning: String(p.reasoning || "").slice(0, 200),
        alphaScore: Number(p.alphaScore ?? 0),
        betaScore: Number(p.betaScore ?? 0),
      });
      setScoreFlashKey(Date.now().toString());
    } else if (lastMessage.type === "competitive.started") {
      // Reset activity for new round
      setAlphaActivity({ lastRole: null, lastOutput: null, lastModel: null, lastTs: null, status: "idle", taskCount: 0 });
      setBetaActivity({ lastRole: null, lastOutput: null, lastModel: null, lastTs: null, status: "idle", taskCount: 0 });
      setGammaActivity({ lastRole: null, lastOutput: null, lastModel: null, lastTs: null, status: "idle", taskCount: 0 });
      setLastEvaluation(null);
    }
  }, [lastMessage, alphaActivity.taskCount, betaActivity.taskCount, gammaActivity.taskCount]);

  const phase = competitiveStatus?.phase || "idle";
  const phaseConfig = PHASE_CONFIG[phase] || PHASE_CONFIG.idle;
  const objective = competitiveStatus?.objective;

  const TeamCard = ({ teamId, activity }: { teamId: string; activity: TeamActivity }) => {
    const config = TEAM_CONFIG[teamId];
    if (!config) return null;
    const isActive = phaseConfig.activeTeams.includes(teamId);
    const isPulsing = isActive && activity.status === "working";
    
    let pulseClass = "";
    if (isPulsing) {
      if (teamId === "team-alpha") pulseClass = "team-card-active-alpha";
      else if (teamId === "team-beta") pulseClass = "team-card-active-beta";
      else if (teamId === "team-gamma") pulseClass = "team-card-active-gamma";
    }
    
    return (
      <div className={`rounded-lg border-2 p-4 transition-all duration-300 ${config.accentClass} ${isActive ? "bg-gray-900" : "bg-swarm-bg opacity-60"} ${pulseClass}`}>
        <div className="flex items-center justify-between mb-3">
          <div className="flex items-center gap-2">
            <PulsingDot active={activity.status === "working"} color={config.color} />
            <span className="font-mono font-bold text-sm" style={{ color: config.color }}>{config.label}</span>
          </div>
          <span className={`text-[10px] font-mono px-2 py-0.5 rounded ${
            activity.status === "working" ? "bg-blue-900/40 text-blue-400" :
            activity.status === "done" ? "bg-emerald-900/40 text-emerald-400" :
            activity.status === "failed" ? "bg-red-900/40 text-red-400" :
            "bg-gray-800 text-gray-500"
          }`}>{activity.status.toUpperCase()}</span>
        </div>
        {activity.lastRole && (
          <div className="text-xs font-mono text-swarm-muted mb-1">
            role: <span style={{ color: config.color }}>{activity.lastRole}</span>
            {activity.lastModel && <span className="ml-2 text-gray-600">({activity.lastModel.split(":")[0]})</span>}
          </div>
        )}
        {activity.lastOutput ? (
          <p className="text-xs text-gray-400 font-mono leading-relaxed line-clamp-2">{activity.lastOutput}</p>
        ) : (
          <p className="text-xs text-gray-600 font-mono">awaiting output...</p>
        )}
        {activity.taskCount > 0 && (
          <div className="mt-2 text-[10px] text-swarm-muted">{activity.taskCount} tasks run</div>
        )}
      </div>
    );
  };

  return (
    <div className="panel" style={{ background: "linear-gradient(135deg, #0a0e17 0%, #0d1321 100%)" }}>
      {/* Header */}
      <div className="flex items-center justify-between mb-4">
        <div className="flex items-center gap-3">
          <span className="font-mono text-sm font-bold tracking-wider text-gray-300">COMPETITIVE ROUND</span>
          <span
            className="font-mono text-xs font-bold px-3 py-1 rounded border"
            style={{ color: phaseConfig.color, borderColor: phaseConfig.color, background: `${phaseConfig.color}15` }}
          >
            {phaseConfig.label}
          </span>
        </div>
        {lastEvaluation && (
          <div key={scoreFlashKey} className="text-xs font-mono">
            <span className={`text-blue-400 ${scoreFlashKey ? "score-flash" : ""}`}>α:{lastEvaluation.alphaScore}</span>
            <span className="text-swarm-muted mx-1">vs</span>
            <span className={`text-purple-400 ${scoreFlashKey ? "score-flash" : ""}`}>β:{lastEvaluation.betaScore}</span>
          </div>
        )}
      </div>

      {/* Phase Progression */}
      {phase !== "idle" && <PhaseProgressBar currentPhase={phase} />}

      {/* Objective */}
      {objective?.objective && (
        <div className="mb-4 p-3 rounded bg-gray-900/50 border border-swarm-border">
          <div className="flex items-center gap-2 mb-1">
            <span className="text-[10px] font-mono text-swarm-muted tracking-wider">OBJECTIVE</span>
            {objective.category && (
              <span className="chip chip-elevated text-[9px] font-mono">{objective.category}</span>
            )}
          </div>
          <p className="text-xs text-gray-300 font-mono leading-relaxed">
            {(objective.objective || "").slice(0, 160)}...
          </p>
        </div>
      )}

      {/* Team Cards */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 mb-4">
        <TeamCard teamId="team-alpha" activity={alphaActivity} />
        <TeamCard teamId="team-beta" activity={betaActivity} />
        <TeamCard teamId="team-gamma" activity={gammaActivity} />
      </div>

      {/* Winner Banner */}
      {lastEvaluation?.winner && phase === "implementing" && (
        <div
          className="mb-4 p-3 rounded border font-mono text-xs"
          style={{
            borderColor: lastEvaluation.winner === "team-alpha" ? "#3b82f6" : "#a855f7",
            background: lastEvaluation.winner === "team-alpha" ? "#1e3a5f20" : "#4a1d9620",
            color: lastEvaluation.winner === "team-alpha" ? "#60a5fa" : "#c084fc"
          }}
        >
          <span className="font-bold">WINNER: {lastEvaluation.winner.replace("team-", "").toUpperCase()}</span>
          {" — "}
          <span className="text-swarm-muted">{lastEvaluation.reasoning.slice(0, 160)}</span>
        </div>
      )}

      {/* Live Handoff Feed */}
      {handoffs.length > 0 && (
        <div>
          <div className="text-[10px] font-mono text-swarm-muted tracking-wider mb-2">PIPELINE FEED</div>
          <div className="space-y-1 max-h-32 overflow-y-auto font-mono text-[10px]">
            {handoffs.slice(0, 8).map((h, i) => (
              <div key={i} className="flex items-start gap-2 text-gray-500">
                <span className="shrink-0 text-gray-600">{new Date(h.ts).toLocaleTimeString()}</span>
                <span className="text-gray-500 shrink-0">{h.teamId.replace("team-", "")}</span>
                <span className="text-blue-400/70 shrink-0">{h.fromRole}</span>
                <span className="text-gray-600">→</span>
                <span className="text-emerald-400/70 shrink-0">{h.toRole}</span>
                <span className="text-gray-600 truncate">{h.preview}</span>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
