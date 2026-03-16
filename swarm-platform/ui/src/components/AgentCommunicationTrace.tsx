import { useState, useEffect } from "react";

interface AgentMsg {
  id: string;
  ts: string;
  teamId: string;
  role: string;
  content: string;
  objectiveId?: string;
}

export default function AgentCommunicationTrace({ teamId }: { teamId?: string }) {
  const [messages, setMessages] = useState<AgentMsg[]>([]);

  useEffect(() => {
    const url = teamId 
      ? `/api/competitive/agent-messages?teamId=${teamId}&limit=50`
      : `/api/competitive/agent-messages?limit=50`;
    
    fetch(url).then(r => r.json()).then(data => {
      setMessages(data.messages || []);
    }).catch(() => {});
    
    const interval = setInterval(() => {
      fetch(url).then(r => r.json()).then(data => {
        setMessages(data.messages || []);
      }).catch(() => {});
    }, 5000);
    
    return () => clearInterval(interval);
  }, [teamId]);

  const roleColor = (role: string) => ({
    coordinator: "text-purple-400",
    research: "text-blue-400",
    build: "text-green-400",
    critic: "text-yellow-400",
    integrator: "text-orange-400"
  }[role] || "text-gray-400");

  if (messages.length === 0) {
    return (
      <div className="p-4 text-gray-500 text-sm font-mono">
        No agent messages yet. Messages appear as competitive rounds run.
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-1 max-h-96 overflow-y-auto font-mono text-xs p-2">
      {messages.map(msg => (
        <div key={msg.id} className="border border-gray-700 rounded p-2 bg-gray-900">
          <div className="flex gap-2 items-center mb-1">
            <span className="text-gray-500">{new Date(msg.ts).toLocaleTimeString()}</span>
            <span className={`font-bold uppercase ${msg.teamId === 'team-alpha' ? 'text-blue-400' : msg.teamId === 'team-beta' ? 'text-red-400' : 'text-purple-400'}`}>
              [{(msg.teamId || '').replace('team-', '')}]
            </span>
            <span className={`uppercase ${roleColor(msg.role)}`}>{msg.role}</span>
          </div>
          <div className="text-gray-300 leading-relaxed whitespace-pre-wrap break-words">
            {msg.content}
          </div>
        </div>
      ))}
    </div>
  );
}
