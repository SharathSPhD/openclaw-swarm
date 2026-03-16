import { useState, useEffect } from "react";

interface ModelEntry {
  model?: string;
  tier?: string;
  fallbacks?: string[];
}

interface VllmInfo {
  available?: boolean;
  online?: boolean;
  models?: Array<{ id: string; owned_by?: string }>;
  url?: string;
  error?: string | null;
}

interface LearningRec {
  avoidModels?: Array<{ model: string; role: string; failRate: number; reason: string }>;
  preferModels?: Array<{ model: string; role: string; avgCorrectness: number; avgLatency: number }>;
  roleOverrides?: Record<string, { avoid: string; prefer: string; reason: string }>;
}

export default function ConfigPage() {
  const [allModels, setAllModels] = useState<Record<string, unknown> | null>(null);
  const [vllm, setVllm] = useState<VllmInfo | null>(null);
  const [learning, setLearning] = useState<LearningRec | null>(null);
  const [autonomy, setAutonomy] = useState<Record<string, unknown> | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    async function load() {
      try {
        const [modelsRes, vllmRes, learnRes, autoRes] = await Promise.all([
          fetch("/api/models").then(r => r.ok ? r.json() : null),
          fetch("/api/metrics/vllm").then(r => r.ok ? r.json() : null),
          fetch("/api/learning/recommendations/team-alpha").then(r => r.ok ? r.json() : null),
          fetch("/api/autonomy/status").then(r => r.ok ? r.json() : null),
        ]);
        setAllModels(modelsRes || null);
        setVllm(vllmRes || null);
        setLearning(learnRes || null);
        setAutonomy(autoRes || null);
      } finally {
        setLoading(false);
      }
    }
    load();
    const i = setInterval(load, 15000);
    return () => clearInterval(i);
  }, []);

  if (loading) {
    return (
      <div className="p-6 font-mono text-gray-500 text-sm">Loading configuration...</div>
    );
  }

  const routing = allModels?.routing as Record<string, ModelEntry> | undefined;
  const inventory = allModels?.inventory as { models?: Array<{ name: string; size?: string }> } | undefined;
  const latency = allModels?.latency as Record<string, unknown> | undefined;

  const vllmOnline = vllm?.available || vllm?.online || false;
  const vllmModels = vllm?.models || [];

  const Section = ({ title, children }: { title: string; children: React.ReactNode }) => (
    <div className="panel mb-6">
      <h2 className="text-xs font-mono font-bold text-gray-400 tracking-widest uppercase mb-4">{title}</h2>
      {children}
    </div>
  );

  const autoRounds = autonomy as { rounds?: { dispatched?: number; completed?: number; failed?: number }; qualityGate?: { passed?: number; failed?: number; reverted?: number }; categories?: { counts?: Record<string, number> }; selfHealing?: { totalFailures?: number }; modelAdaptation?: { swapCount?: number } } | null;

  return (
    <div className="p-6 max-w-5xl">
      <h1 className="text-lg font-mono font-bold text-gray-200 mb-6 tracking-wider">SYSTEM CONFIGURATION</h1>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 mb-6">
        {/* vLLM Status */}
        <Section title="vLLM Backend">
          <div className="flex items-center gap-3 mb-3">
            <span className={`w-2.5 h-2.5 rounded-full ${vllmOnline ? "bg-emerald-400 animate-pulse" : "bg-red-500"}`} />
            <span className="font-mono text-sm font-bold">{vllmOnline ? "ONLINE" : "OFFLINE"}</span>
            <span className="text-gray-500 text-xs">{vllm?.url || "http://127.0.0.1:8000"}</span>
          </div>
          {vllmModels.length > 0 ? (
            <div className="space-y-1">
              {vllmModels.map((m) => (
                <div key={m.id} className="flex items-center gap-2 font-mono text-xs">
                  <span className="text-emerald-400">●</span>
                  <span className="text-gray-300">{m.id}</span>
                  {m.owned_by && <span className="text-gray-600">({m.owned_by})</span>}
                </div>
              ))}
            </div>
          ) : (
            <p className="text-gray-600 text-xs">No vLLM models loaded</p>
          )}
        </Section>

        {/* Autonomy Health */}
        <Section title="Autonomy Health">
          {autoRounds ? (
            <div className="grid grid-cols-2 gap-3 font-mono text-xs">
              <div>
                <span className="text-gray-500">Rounds:</span>{" "}
                <span className="text-emerald-400">{autoRounds.rounds?.completed || 0}</span>
                <span className="text-gray-600"> / {autoRounds.rounds?.dispatched || 0}</span>
              </div>
              <div>
                <span className="text-gray-500">Failed:</span>{" "}
                <span className="text-red-400">{autoRounds.rounds?.failed || 0}</span>
              </div>
              <div>
                <span className="text-gray-500">Quality Gate:</span>{" "}
                <span className="text-emerald-400">{autoRounds.qualityGate?.passed || 0} pass</span>
                <span className="text-gray-600"> / {autoRounds.qualityGate?.failed || 0} fail</span>
              </div>
              <div>
                <span className="text-gray-500">Model Swaps:</span>{" "}
                <span className="text-amber-400">{autoRounds.modelAdaptation?.swapCount || 0}</span>
              </div>
              <div className="col-span-2">
                <span className="text-gray-500">Categories run:</span>{" "}
                {autoRounds.categories?.counts ? (
                  <span className="text-gray-300">
                    {Object.entries(autoRounds.categories.counts).map(([k, v]) => `${k}:${v}`).join(", ")}
                  </span>
                ) : "none"}
              </div>
            </div>
          ) : (
            <p className="text-gray-600 text-sm">Autonomy data unavailable</p>
          )}
        </Section>
      </div>

      {/* Model Learning Overrides */}
      {learning && (learning.avoidModels?.length || learning.preferModels?.length || Object.keys(learning.roleOverrides || {}).length > 0) && (
        <Section title="Model Learning (Active Overrides)">
          {learning.roleOverrides && Object.keys(learning.roleOverrides).length > 0 && (
            <div className="mb-3">
              <h3 className="text-[10px] font-bold text-amber-400 uppercase mb-2">Role Overrides</h3>
              <div className="space-y-1">
                {Object.entries(learning.roleOverrides).map(([role, info]) => (
                  <div key={role} className="font-mono text-xs flex items-center gap-2">
                    <span className="text-blue-400 w-20">{role}</span>
                    <span className="text-red-400 line-through">{info.avoid}</span>
                    <span className="text-gray-600">→</span>
                    <span className="text-emerald-400">{info.prefer}</span>
                    <span className="text-gray-600 text-[10px] ml-2">{info.reason}</span>
                  </div>
                ))}
              </div>
            </div>
          )}
          {learning.avoidModels && learning.avoidModels.length > 0 && (
            <div className="flex flex-wrap gap-2 mb-2">
              {learning.avoidModels.map((m) => (
                <span key={`${m.model}-${m.role}`} className="font-mono text-[11px] px-2 py-0.5 rounded bg-red-900/30 text-red-400 border border-red-900">
                  ✕ {m.model} ({m.role}) — {m.reason}
                </span>
              ))}
            </div>
          )}
          {learning.preferModels && learning.preferModels.length > 0 && (
            <div className="flex flex-wrap gap-2">
              {learning.preferModels.map((m) => (
                <span key={`${m.model}-${m.role}`} className="font-mono text-[11px] px-2 py-0.5 rounded bg-emerald-900/30 text-emerald-400 border border-emerald-900">
                  ✓ {m.model} ({m.role}) — {(m.avgCorrectness * 100).toFixed(0)}% correct, {(m.avgLatency / 1000).toFixed(1)}s
                </span>
              ))}
            </div>
          )}
        </Section>
      )}

      {/* Model Routing */}
      <Section title="Model Routing">
        {routing && Object.keys(routing).length > 0 ? (
          <div className="overflow-x-auto">
            <table className="w-full font-mono text-xs">
              <thead>
                <tr className="text-gray-600 border-b border-gray-800">
                  <th className="text-left py-1 pr-4">Role</th>
                  <th className="text-left py-1 pr-4">Primary Model</th>
                  <th className="text-left py-1 pr-4">Tier</th>
                  <th className="text-left py-1">Fallbacks</th>
                </tr>
              </thead>
              <tbody>
                {Object.entries(routing).filter(([k]) => !["_comment", "version"].includes(k)).map(([role, cfg]) => {
                  const entry = (typeof cfg === "string" ? { model: cfg } : cfg) as ModelEntry;
                  return (
                    <tr key={role} className="border-b border-gray-900 hover:bg-gray-900/30">
                      <td className="py-1.5 pr-4 text-blue-400">{role}</td>
                      <td className="py-1.5 pr-4 text-gray-300">{entry.model || JSON.stringify(cfg)}</td>
                      <td className="py-1.5 pr-4 text-gray-500">{entry.tier || "standard"}</td>
                      <td className="py-1.5 text-gray-600">{entry.fallbacks?.join(", ") || "—"}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        ) : (
          <p className="text-gray-600 text-sm">No routing data available</p>
        )}
      </Section>

      {/* Ollama Models */}
      <Section title="Available Models (Ollama)">
        {inventory?.models && inventory.models.length > 0 ? (
          <div className="flex flex-wrap gap-2">
            {inventory.models.map((m) => (
              <span key={m.name} className="font-mono text-[11px] px-2 py-0.5 rounded bg-gray-800 text-gray-400 border border-gray-700">
                {m.name}
                {m.size && <span className="text-gray-600 ml-1">({m.size})</span>}
              </span>
            ))}
          </div>
        ) : (
          <p className="text-gray-600 text-sm">No Ollama models discovered</p>
        )}
      </Section>

      {/* Latency Data */}
      {latency && Object.keys(latency).length > 0 && (
        <Section title="Model Latency (Benchmarks)">
          <pre className="font-mono text-[11px] text-gray-500 overflow-x-auto max-h-48 overflow-y-auto p-3 rounded bg-gray-900/50">
            {JSON.stringify(latency, null, 2)}
          </pre>
        </Section>
      )}
    </div>
  );
}
