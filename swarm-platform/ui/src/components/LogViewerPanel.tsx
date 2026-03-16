import { useState, useEffect, useRef } from "react";

interface Props {
  adminKey?: string;
  lines?: number;
  autoRefresh?: boolean;
}

export default function LogViewerPanel({ adminKey, lines = 50, autoRefresh = true }: Props) {
  const [logLines, setLogLines] = useState<string[]>([]);
  const [logPath, setLogPath] = useState<string | null>(null);
  const [open, setOpen] = useState(false);
  const bottomRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;

    const fetch_logs = () => {
      const headers: Record<string, string> = {};
      if (adminKey) headers["x-api-key"] = adminKey;

      fetch(`/api/admin/log-tail?lines=${lines}`, { headers })
        .then(r => r.ok ? r.json() : null)
        .then(data => {
          if (data?.lines) {
            setLogLines(data.lines);
            setLogPath(data.logPath || null);
          }
        })
        .catch(() => {});
    };

    fetch_logs();
    if (!autoRefresh) return;
    const interval = setInterval(fetch_logs, 3000);
    return () => clearInterval(interval);
  }, [open, adminKey, lines, autoRefresh]);

  useEffect(() => {
    if (open && bottomRef.current) {
      bottomRef.current.scrollIntoView({ behavior: "smooth" });
    }
  }, [logLines, open]);

  return (
    <div className="border border-gray-700 rounded-lg bg-gray-900">
      <button
        onClick={() => setOpen(o => !o)}
        className="w-full flex items-center justify-between px-4 py-2 text-sm font-mono text-gray-400 hover:text-white transition-colors"
      >
        <span>📋 Server Log {logPath ? `(${logPath})` : "(events)"}</span>
        <span>{open ? "▲" : "▼"} {logLines.length} lines</span>
      </button>

      {open && (
        <div className="max-h-64 overflow-y-auto p-2 font-mono text-xs border-t border-gray-700">
          {logLines.length === 0 ? (
            <div className="text-gray-500 p-2">No log lines available</div>
          ) : (
            logLines.map((line, i) => (
              <div
                key={i}
                className={`py-0.5 leading-relaxed break-all ${
                  line.includes("error") || line.includes("Error") || line.includes("ERROR")
                    ? "text-red-400"
                    : line.includes("warn") || line.includes("WARN")
                    ? "text-yellow-400"
                    : line.includes("competitive") || line.includes("gamma")
                    ? "text-purple-300"
                    : "text-gray-400"
                }`}
              >
                {line}
              </div>
            ))
          )}
          <div ref={bottomRef} />
        </div>
      )}
    </div>
  );
}
