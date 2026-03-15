import { Routes, Route, NavLink } from "react-router-dom";
import { useWebSocket } from "./hooks/useWebSocket";
import { useApi } from "./hooks/useApi";
import type { SnapshotResponse } from "./types";
import DashboardPage from "./pages/DashboardPage";
import ObjectivesPage from "./pages/ObjectivesPage";
import TimelinePage from "./pages/TimelinePage";
import OpsPage from "./pages/OpsPage";
import AuditPage from "./pages/AuditPage";
import TelegramPage from "./pages/TelegramPage";
import LeaderboardPage from "./pages/LeaderboardPage";

const NAV_ITEMS = [
  { to: "/", label: "Dashboard", icon: "⚡" },
  { to: "/objectives", label: "Objectives", icon: "🎯" },
  { to: "/timeline", label: "Timeline", icon: "📊" },
  { to: "/ops", label: "Ops", icon: "🔧" },
  { to: "/audit", label: "Audit", icon: "📋" },
  { to: "/telegram", label: "Telegram", icon: "💬" },
  { to: "/leaderboard", label: "Leaderboard", icon: "🏆" },
];

export default function App() {
  const { lastMessage, connected } = useWebSocket();
  const { data: snapshot } = useApi<SnapshotResponse>("/api/snapshot", 5000);

  const loadState = snapshot?.loadState || "unknown";
  const chipClass = loadState === "normal" ? "chip-normal" :
    loadState === "elevated" ? "chip-elevated" :
    ["high", "emergency"].includes(loadState) ? "chip-high" : "chip-critical";

  return (
    <div className="flex min-h-screen">
      <aside className="w-56 bg-swarm-surface border-r border-swarm-border flex flex-col p-4 gap-1 shrink-0">
        <div className="text-lg font-bold mb-4 px-2">🦞 OpenClaw Swarm</div>
        {NAV_ITEMS.map(({ to, label, icon }) => (
          <NavLink
            key={to}
            to={to}
            end={to === "/"}
            className={({ isActive }) =>
              `flex items-center gap-2 px-3 py-2 rounded-md text-sm transition-colors ${
                isActive ? "bg-swarm-accent/20 text-swarm-accent" : "text-gray-400 hover:text-gray-200 hover:bg-gray-800"
              }`
            }
          >
            <span>{icon}</span>
            <span>{label}</span>
          </NavLink>
        ))}
        <div className="mt-auto pt-4 border-t border-swarm-border text-xs text-swarm-muted space-y-1 px-2">
          <div className={`chip ${chipClass}`}>Load: {loadState}</div>
          <div>Agents: {snapshot?.activeAgents ?? 0}/{snapshot?.maxActiveAgents ?? 0}</div>
          <div>Queue: {snapshot?.queueDepth ?? 0}</div>
          <div>Runner: {snapshot?.runnerMode ?? "?"}</div>
          <div className={`flex items-center gap-1 ${connected ? "text-emerald-400" : "text-red-400"}`}>
            <span className={`w-2 h-2 rounded-full ${connected ? "bg-emerald-400" : "bg-red-400"}`}></span>
            {connected ? "Connected" : "Disconnected"}
          </div>
        </div>
      </aside>

      <main className="flex-1 p-6 overflow-auto">
        <Routes>
          <Route path="/" element={<DashboardPage snapshot={snapshot} lastMessage={lastMessage} />} />
          <Route path="/objectives" element={<ObjectivesPage />} />
          <Route path="/timeline" element={<TimelinePage />} />
          <Route path="/ops" element={<OpsPage snapshot={snapshot} />} />
          <Route path="/audit" element={<AuditPage />} />
          <Route path="/telegram" element={<TelegramPage />} />
          <Route path="/leaderboard" element={<LeaderboardPage />} />
        </Routes>
      </main>
    </div>
  );
}
