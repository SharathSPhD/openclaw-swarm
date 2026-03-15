import { useApi } from "../hooks/useApi";
import type { TelegramProof } from "../types";

interface TelegramResponse {
  enabled: boolean;
  defaultChatId: string;
  proof: TelegramProof[];
}

export default function TelegramPage() {
  const { data } = useApi<TelegramResponse>("/api/telegram", 5000);

  const proof = data?.proof ?? [];
  const enabled = data?.enabled ?? false;

  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-bold">Telegram</h1>

      <div className="panel">
        <div className="flex items-center gap-2 mb-4">
          <span className={`w-3 h-3 rounded-full ${enabled ? "bg-emerald-400" : "bg-red-400"}`}></span>
          <span>{enabled ? "Telegram enabled" : "Telegram disabled"}</span>
        </div>
        <p className="text-sm text-swarm-muted">Default chat: {data?.defaultChatId ?? "—"}</p>
      </div>

      <div className="panel overflow-x-auto">
        <h3 className="text-sm font-semibold mb-3">Delivery Proof</h3>
        <table className="w-full text-sm">
          <thead>
            <tr className="text-left text-swarm-muted border-b border-swarm-border">
              <th className="pb-3 pr-4">Timestamp</th>
              <th className="pb-3 pr-4">Team</th>
              <th className="pb-3 pr-4">Type</th>
              <th className="pb-3 pr-4">Task ID</th>
              <th className="pb-3 pr-4">Chat ID</th>
              <th className="pb-3 pr-4">Msg ID</th>
              <th className="pb-3 pr-4">Reason</th>
            </tr>
          </thead>
          <tbody>
            {proof.length === 0 ? (
              <tr>
                <td colSpan={7} className="py-8 text-center text-swarm-muted">
                  No delivery proof
                </td>
              </tr>
            ) : (
              proof.slice().reverse().map((row) => (
                <tr key={row.id} className="border-b border-swarm-border/50">
                  <td className="py-2 pr-4 text-swarm-muted">{new Date(row.ts).toLocaleString()}</td>
                  <td className="py-2 pr-4">{row.teamId}</td>
                  <td className="py-2 pr-4">
                    <span className={`chip ${row.type === "telegram.sent" ? "chip-normal" : "chip-critical"}`}>
                      {row.type}
                    </span>
                  </td>
                  <td className="py-2 pr-4 font-mono text-xs truncate max-w-[100px]">{row.taskId || "—"}</td>
                  <td className="py-2 pr-4">{row.chatId ?? "—"}</td>
                  <td className="py-2 pr-4">{row.messageId ?? "—"}</td>
                  <td className="py-2 pr-4 truncate max-w-[150px]" title={row.reason || ""}>
                    {row.reason || "—"}
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
