import { useState, useEffect } from "react";

interface ModelRouting {
  [role: string]: { model: string; tier?: string };
}

export default function ConfigPage() {
  const [routing, setRouting] = useState<ModelRouting | null>(null);
  const [inventory, setInventory] = useState<{ models: string[]; total: number } | null>(null);
  const [vllm, setVllm] = useState<{ online: boolean; models?: string[] } | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    async function load() {
      try {
        const [routingRes, inventoryRes, vllmRes] = await Promise.all([
          fetch("/api/models/routing").then(r => r.ok ? r.json() : null),
          fetch("/api/models/inventory").then(r => r.ok ? r.json() : null),
          fetch("/api/metrics/vllm").then(r => r.ok ? r.json() : null)
        ]);
        setRouting(routingRes?.routing || routingRes || null);
        setInventory(inventoryRes || null);
        setVllm(vllmRes || null);
      } finally {
        setLoading(false);
      }
    }
    load();
    const i = setInterval(load, 30000);
    return () => clearInterval(i);
  }, []);

  if (loading) {
    return (
      <div className="p-6 font-mono text-gray-500 text-sm">Loading configuration...</div>
    );
  }

  const Section = ({ title, children }: { title: string; children: React.ReactNode }) => (
    <div className="panel mb-6">
      <h2 className="text-xs font-mono font-bold text-gray-400 tracking-widest uppercase mb-4">{title}</h2>
      {children}
    </div>
  );

  return (
    <div className="p-6 max-w-4xl">
      <h1 className="text-lg font-mono font-bold text-gray-200 mb-6 tracking-wider">SYSTEM CONFIGURATION</h1>

      {/* vLLM Status */}
      <Section title="vLLM Backend">
        <div className="flex items-center gap-3 mb-3">
          <span className={`w-2.5 h-2.5 rounded-full ${vllm?.online ? "bg-emerald-400" : "bg-red-500"}`} />
          <span className="font-mono text-sm">{vllm?.online ? "ONLINE" : "OFFLINE"}</span>
          <span className="text-gray-600 text-xs">nvidia/Qwen3-14B-NVFP4 · port 8000</span>
        </div>
        {vllm?.models && (
          <div className="font-mono text-xs text-gray-500">
            Models: {vllm.models.slice(0, 3).join(", ")}
          </div>
        )}
      </Section>

      {/* Model Routing */}
      <Section title="Model Routing">
        {routing ? (
          <div className="overflow-x-auto">
            <table className="w-full font-mono text-xs">
              <thead>
                <tr className="text-gray-600 border-b border-gray-800">
                  <th className="text-left py-1 pr-4">Role</th>
                  <th className="text-left py-1 pr-4">Model</th>
                  <th className="text-left py-1">Tier</th>
                </tr>
              </thead>
              <tbody>
                {Object.entries(routing).map(([role, cfg]) => (
                  <tr key={role} className="border-b border-gray-900 hover:bg-gray-900/30">
                    <td className="py-1.5 pr-4 text-blue-400">{role}</td>
                    <td className="py-1.5 pr-4 text-gray-300">
                      {typeof cfg === "string" ? cfg : (cfg as { model?: string })?.model || JSON.stringify(cfg)}
                    </td>
                    <td className="py-1.5 text-gray-500">
                      {typeof cfg === "object" ? (cfg as { tier?: string })?.tier || "standard" : "standard"}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <p className="text-gray-600 text-sm">No routing data available</p>
        )}
      </Section>

      {/* Model Inventory */}
      <Section title="Available Models (Ollama)">
        {inventory?.models ? (
          <div className="flex flex-wrap gap-2">
            {inventory.models.slice(0, 20).map((m: string) => (
              <span key={m} className="font-mono text-[11px] px-2 py-0.5 rounded bg-gray-800 text-gray-400 border border-gray-700">
                {m}
              </span>
            ))}
            {(inventory.total || inventory.models.length) > 20 && (
              <span className="font-mono text-[11px] text-gray-600">
                +{(inventory.total || inventory.models.length) - 20} more
              </span>
            )}
          </div>
        ) : (
          <p className="text-gray-600 text-sm">No models discovered</p>
        )}
      </Section>

      {/* Raw JSON viewer */}
      <Section title="Raw Config (model_routing.json)">
        <pre className="font-mono text-[11px] text-gray-500 overflow-x-auto max-h-64 overflow-y-auto p-3 rounded bg-gray-900/50">
          {JSON.stringify(routing, null, 2) || "null"}
        </pre>
      </Section>
    </div>
  );
}
