import { Routes, Route, NavLink } from "react-router-dom";
import { useState, useEffect } from "react";
import { useWebSocket } from "./hooks/useWebSocket";
import { useApi } from "./hooks/useApi";
import type { SnapshotResponse } from "./types";
import SystemStatusBar from "./components/SystemStatusBar";
import DashboardPage from "./pages/DashboardPage";
import ObjectivesPage from "./pages/ObjectivesPage";
import TimelinePage from "./pages/TimelinePage";
import OpsPage from "./pages/OpsPage";
import AuditPage from "./pages/AuditPage";
import TelegramPage from "./pages/TelegramPage";
import LeaderboardPage from "./pages/LeaderboardPage";
import ConfigPage from "./pages/ConfigPage";
import RequestsPage from "./pages/RequestsPage";

const NAV_ITEMS = [
  { to: "/", label: "Dashboard", icon: "📊" },
  { to: "/competition", label: "Competition", icon: "⚔️" },
  { to: "/agents", label: "Agents", icon: "🤖" },
  { to: "/requests", label: "Requests", icon: "🔑" },
  { to: "/config", label: "Config", icon: "⚙️" },
];

export default function App() {
  const { lastMessage, connected } = useWebSocket();
  const { data: snapshot } = useApi<SnapshotResponse>("/api/snapshot", 5000);
  const [isDark, setIsDark] = useState(() => {
    const stored = localStorage.getItem("swarm-theme");
    return stored !== null ? stored === "dark" : true; // default to dark
  });

  // Apply dark mode class on mount and when isDark changes
  useEffect(() => {
    if (isDark) {
      document.documentElement.classList.add("dark");
    } else {
      document.documentElement.classList.remove("dark");
    }
  }, [isDark]);

  const toggleDarkMode = () => {
    const newDark = !isDark;
    setIsDark(newDark);
    localStorage.setItem("swarm-theme", newDark ? "dark" : "light");
    if (newDark) {
      document.documentElement.classList.add("dark");
    } else {
      document.documentElement.classList.remove("dark");
    }
  };

  const loadState = snapshot?.loadState || "unknown";
  const chipClass = loadState === "normal" ? "chip-normal" :
    loadState === "elevated" ? "chip-elevated" :
    ["high", "emergency"].includes(loadState) ? "chip-high" : "chip-critical";

  return (
    <div className="flex min-h-screen" style={{ backgroundColor: isDark ? "#0a0e17" : "#f3f4f6" }}>
      <aside className="w-56 border-r border-swarm-border flex flex-col p-4 gap-1 shrink-0" style={{ backgroundColor: isDark ? "#111827" : "#f9fafb" }}>
        <div className="flex items-center justify-between mb-4">
          <div className="text-lg font-bold px-2">🦞 OpenClaw Swarm</div>
          <button
            onClick={toggleDarkMode}
            className="p-2 rounded-md hover:bg-gray-800 dark:hover:bg-gray-700 transition-colors"
            title={isDark ? "Switch to light mode" : "Switch to dark mode"}
          >
            {isDark ? (
              <svg className="w-4 h-4 text-yellow-400" fill="currentColor" viewBox="0 0 20 20">
                <path d="M10 3a1 1 0 011 1v1a1 1 0 11-2 0V4a1 1 0 011-1zm0 12a1 1 0 011 1v1a1 1 0 11-2 0v-1a1 1 0 011-1zm4.657-5.657a1 1 0 000-1.414l-.707-.707a1 1 0 00-1.414 1.414l.707.707a1 1 0 001.414 0zm-9.314 0a1 1 0 001.414-1.414l-.707-.707a1 1 0 00-1.414 1.414l.707.707zM16 10a1 1 0 011 1v1a1 1 0 11-2 0v-1a1 1 0 011-1zM4 10a1 1 0 011 1v1a1 1 0 11-2 0v-1a1 1 0 011-1zm10.657 4.657a1 1 0 00-1.414-1.414l-.707.707a1 1 0 001.414 1.414l.707-.707zM5.343 5.343a1 1 0 00-1.414 1.414l.707.707a1 1 0 001.414-1.414l-.707-.707z" />
              </svg>
            ) : (
              <svg className="w-4 h-4 text-gray-700" fill="currentColor" viewBox="0 0 20 20">
                <path d="M17.293 13.293A8 8 0 016.707 2.707a8.001 8.001 0 1010.586 10.586z" />
              </svg>
            )}
          </button>
        </div>
        {NAV_ITEMS.map(({ to, label, icon }) => (
          <NavLink
            key={to}
            to={to}
            end={to === "/"}
            className={({ isActive }) =>
              `flex items-center gap-2 px-3 py-2 rounded-md text-sm transition-colors ${
                isActive 
                  ? "bg-swarm-accent/20 text-swarm-accent" 
                  : isDark 
                    ? "text-gray-400 hover:text-gray-200 hover:bg-gray-800"
                    : "text-gray-600 hover:text-gray-900 hover:bg-gray-200"
              }`
            }
          >
            <span>{icon}</span>
            <span>{label}</span>
          </NavLink>
        ))}
        <div className="mt-auto pt-4 border-t border-swarm-border text-xs space-y-1 px-2" style={{ color: isDark ? "#6b7280" : "#6b7280" }}>
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

      <main className="flex-1 flex flex-col overflow-hidden" style={{ backgroundColor: isDark ? "#0a0e17" : "#f3f4f6", color: isDark ? "#f3f4f6" : "#1f2937" }}>
        <SystemStatusBar wsConnected={connected} />
        <div className="flex-1 p-6 overflow-auto">
          <Routes>
            <Route path="/" element={<DashboardPage snapshot={snapshot} lastMessage={lastMessage} />} />
            <Route path="/competition" element={<ObjectivesPage />} />
            <Route path="/agents" element={<OpsPage snapshot={snapshot} />} />
            <Route path="/objectives" element={<ObjectivesPage />} />
            <Route path="/timeline" element={<TimelinePage />} />
            <Route path="/ops" element={<OpsPage snapshot={snapshot} />} />
            <Route path="/audit" element={<AuditPage />} />
            <Route path="/requests" element={<RequestsPage />} />
            <Route path="/telegram" element={<TelegramPage />} />
            <Route path="/leaderboard" element={<LeaderboardPage />} />
            <Route path="/config" element={<ConfigPage />} />
          </Routes>
        </div>
      </main>
    </div>
  );
}
