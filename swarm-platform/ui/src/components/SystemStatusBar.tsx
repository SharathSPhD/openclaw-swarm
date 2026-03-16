import { useState, useEffect } from "react";

interface SystemStatus {
  vllmOnline: boolean;
  ollamaOnline: boolean;
  uptimeMs: number;
  currentRound: number;
  phase: string;
  wsConnected: boolean;
}

interface Props {
  wsConnected: boolean;
}

export default function SystemStatusBar({ wsConnected }: Props) {
  const [status, setStatus] = useState<SystemStatus>({
    vllmOnline: false,
    ollamaOnline: false,
    uptimeMs: 0,
    currentRound: 0,
    phase: "idle",
    wsConnected: false
  });

  useEffect(() => {
    async function fetchStatus() {
      try {
        const [metrics, competitive] = await Promise.all([
          fetch("/api/metrics/summary").then(r => r.ok ? r.json() : null),
          fetch("/api/competitive/status").then(r => r.ok ? r.json() : null)
        ]);

        setStatus(prev => ({
          ...prev,
          vllmOnline: metrics?.vllm?.available === true,
          ollamaOnline: metrics?.ollamaOk === true,
          uptimeMs: metrics?.uptime || 0,
          currentRound: competitive?.roundsCompleted || 0,
          phase: competitive?.phase || "idle",
          wsConnected
        }));
      } catch { /* ignore */ }
    }

    fetchStatus();
    const interval = setInterval(fetchStatus, 10000);
    return () => clearInterval(interval);
  }, [wsConnected]);

  const formatUptime = (ms: number) => {
    if (!ms) return "0m";
    const h = Math.floor(ms / 3600000);
    const m = Math.floor((ms % 3600000) / 60000);
    return h > 0 ? `${h}h ${m}m` : `${m}m`;
  };

  const Dot = ({ online }: { online: boolean }) => (
    <span
      className={`inline-block w-2 h-2 rounded-full ${online ? "bg-emerald-400" : "bg-red-500"}`}
      style={{ boxShadow: online ? "0 0 4px rgba(52, 211, 153, 0.8)" : "none" }}
    />
  );

  const phaseColors: Record<string, string> = {
    idle: "text-gray-500",
    forking: "text-blue-400",
    evaluating: "text-amber-400",
    implementing: "text-emerald-400",
    merging: "text-purple-400"
  };

  return (
    <div className="flex items-center gap-4 px-4 py-1.5 border-b text-[11px] font-mono"
         style={{ borderColor: "#1f2937", background: "#0d1117" }}>
      <div className="flex items-center gap-1.5">
        <Dot online={status.vllmOnline} />
        <span className={status.vllmOnline ? "text-emerald-400" : "text-red-400"}>vLLM</span>
      </div>
      <div className="flex items-center gap-1.5">
        <Dot online={status.ollamaOnline} />
        <span className={status.ollamaOnline ? "text-emerald-400" : "text-red-400"}>Ollama</span>
      </div>
      <div className="flex items-center gap-1.5">
        <Dot online={wsConnected} />
        <span className={wsConnected ? "text-emerald-400" : "text-red-400"}>WS</span>
      </div>
      <div className="text-gray-600">|</div>
      <div className="text-gray-400">Uptime: <span className="text-gray-300">{formatUptime(status.uptimeMs)}</span></div>
      <div className="text-gray-400">Rounds: <span className="text-blue-400">{status.currentRound}</span></div>
      <div className="text-gray-400">Phase: <span className={phaseColors[status.phase] || "text-gray-400"}>{status.phase.toUpperCase()}</span></div>
      <div className="ml-auto text-gray-600 text-[10px]">OPENCLAW SWARM v4</div>
    </div>
  );
}
