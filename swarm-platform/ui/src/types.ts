export interface GpuDevice {
  index: number;
  usedMb: number | null;
  totalMb: number | null;
  utilPct: number | null;
  tempC: number | null;
  powerW: number | null;
}

export interface GpuInfo {
  available: boolean;
  gpus: number;
  usedMb: number | null;
  totalMb: number | null;
  usedPct: number | null;
  utilPct: number | null;
  localGpuBacked: boolean;
  devices: GpuDevice[];
  ollamaRuntime: Array<{ model: string; processor: string; context: string; until: string }>;
  processes: Array<{ pid: string; process: string; usedMb: number; gpu: number }>;
  ollamaRunProcesses: Array<{ pid: string; cmd: string }>;
}

export interface SystemSnapshot {
  gpu: GpuInfo;
}

export interface TeamInfo {
  id: string;
  name: string;
  lead: string;
  roles: string[];
}

export interface LeaderboardRow {
  rank: number;
  teamName: string;
  score: number;
  accuracy: number;
  completed: number;
  failed?: number;
  penalties: number;
  rewards?: number;
  modelUsage?: Record<string, number>;
  avgLatency?: number;
  toolUsage?: number;
  criticApprovalRate?: number;
  recentObjectives?: Array<{ id: string; status: string }>;
}

export interface AgentInfo {
  agentId: string;
  teamId: string;
  taskId: string;
  role: string;
  status: string;
  model: string | null;
  modelTier: string | null;
  estimatedLatencyMs: number | null;
  task: string | null;
  startedAt: string | null;
  updatedAt: string;
}

export interface ChatMessage {
  id: string;
  ts: string;
  teamId: string;
  from: string;
  to: string;
  channel: string;
  text: string;
}

export interface FlowRow {
  taskId: string;
  teamId: string;
  role: string;
  status: string;
  model: string | null;
  modelTier: string | null;
  objective: string;
  task: string;
  internalMessages: number;
  telegramUpdates: number;
  lastUpdate: string;
  durationMs: number | null;
}

export interface ObjectiveRow {
  objectiveId: string;
  teamId: string;
  objective: string;
  status: string;
  updatedAt: string;
}

export interface TelegramProof {
  id: string;
  ts: string;
  teamId: string;
  type: string;
  taskId: string | null;
  chatId: string | null;
  messageId: number | null;
  reason: string | null;
}

export interface ModelRoute {
  tier: string;
  primary: string;
  fallback: string[];
}

export interface ModelInfo {
  id: string;
  size: string;
  modified: string;
}

export interface SnapshotResponse {
  leaderboard: LeaderboardRow[];
  teams: TeamInfo[];
  system: SystemSnapshot;
  loadState: string;
  queueDepth: number;
  activeAgents: number;
  maxActiveAgents: number;
  runnerMode: string;
  modelInventory: { available: boolean; models: ModelInfo[] };
  modelRouting: { roleRoutes: Record<string, ModelRoute> };
  events: SwarmEvent[];
  adminKeyRequired: boolean;
}

export interface SwarmEvent {
  id: string;
  ts: string;
  type: string;
  teamId: string;
  source: string;
  payload: Record<string, unknown>;
}

export interface AgentOutput {
  taskId: string;
  teamId: string;
  role: string;
  model: string;
  outputText: string | null;
  toolCalls: unknown[];
  reasoningTrace: string | null;
  metrics: Record<string, number>;
  rawOutput: string | null;
  createdAt: string;
}

export interface SwarmSession {
  id: string;
  objectiveId: string;
  teamId: string;
  objective: string;
  plan: unknown;
  subTasks: unknown[];
  status: string;
  finalOutput: string | null;
  iterations: number;
  createdAt: string;
  updatedAt: string;
}

export interface WsMessage {
  type: string;
  payload: unknown;
  ts: string;
}
