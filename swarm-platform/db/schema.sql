-- Existing tables (no changes)
CREATE TABLE IF NOT EXISTS events (
  id TEXT PRIMARY KEY,
  ts TIMESTAMPTZ NOT NULL,
  type TEXT NOT NULL,
  team_id TEXT NOT NULL,
  source TEXT NOT NULL,
  payload JSONB NOT NULL
);
CREATE INDEX IF NOT EXISTS events_team_ts_idx ON events(team_id, ts DESC);
CREATE INDEX IF NOT EXISTS events_type_idx ON events(type);

CREATE TABLE IF NOT EXISTS score_snapshots (
  id SERIAL PRIMARY KEY,
  ts TIMESTAMPTZ NOT NULL,
  team_id TEXT NOT NULL,
  score BIGINT NOT NULL,
  accuracy NUMERIC(6,3) NOT NULL,
  completed INTEGER NOT NULL,
  failed INTEGER NOT NULL,
  penalties BIGINT NOT NULL
);
CREATE INDEX IF NOT EXISTS score_snapshots_team_ts_idx ON score_snapshots(team_id, ts DESC);

CREATE TABLE IF NOT EXISTS audit_logs (
  id TEXT PRIMARY KEY,
  ts TIMESTAMPTZ NOT NULL,
  actor TEXT NOT NULL,
  action TEXT NOT NULL,
  resource TEXT NOT NULL,
  payload JSONB NOT NULL
);

CREATE TABLE IF NOT EXISTS telegram_deliveries (
  id TEXT PRIMARY KEY,
  ts TIMESTAMPTZ NOT NULL,
  team_id TEXT NOT NULL,
  task_id TEXT,
  event_id TEXT,
  chat_id TEXT NOT NULL,
  status TEXT NOT NULL,
  response JSONB
);
CREATE INDEX IF NOT EXISTS telegram_deliveries_team_ts_idx ON telegram_deliveries(team_id, ts DESC);

-- New tables
CREATE TABLE IF NOT EXISTS agent_outputs (
  id SERIAL PRIMARY KEY,
  task_id TEXT NOT NULL,
  team_id TEXT NOT NULL,
  role TEXT NOT NULL,
  model TEXT NOT NULL,
  output_text TEXT,
  tool_calls JSONB DEFAULT '[]',
  reasoning_trace TEXT,
  metrics JSONB DEFAULT '{}',
  raw_output TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS agent_outputs_task_id_idx ON agent_outputs(task_id);
CREATE INDEX IF NOT EXISTS agent_outputs_team_created_idx ON agent_outputs(team_id, created_at DESC);

CREATE TABLE IF NOT EXISTS swarm_sessions (
  id TEXT PRIMARY KEY,
  objective_id TEXT NOT NULL UNIQUE,
  team_id TEXT NOT NULL,
  objective_text TEXT NOT NULL,
  coordinator_plan JSONB,
  sub_tasks JSONB DEFAULT '[]',
  status TEXT NOT NULL CHECK (status IN ('created', 'decomposed', 'decomposing', 'dispatching', 'executing', 'reviewing', 'aggregating', 'completed', 'failed')),
  final_output TEXT,
  iteration_count INT DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS swarm_sessions_team_ts_idx ON swarm_sessions(team_id, created_at DESC);
CREATE INDEX IF NOT EXISTS swarm_sessions_status_idx ON swarm_sessions(status) WHERE status NOT IN ('completed', 'failed');
CREATE INDEX IF NOT EXISTS swarm_sessions_objective_id_idx ON swarm_sessions(objective_id);

CREATE TABLE IF NOT EXISTS model_metrics (
  id SERIAL PRIMARY KEY,
  model_id TEXT NOT NULL,
  role TEXT NOT NULL,
  latency_ms INT NOT NULL,
  success BOOLEAN NOT NULL DEFAULT true,
  tokens_in INT,
  tokens_out INT,
  gpu_memory_mb INT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS model_metrics_model_role_idx ON model_metrics(model_id, role);
CREATE INDEX IF NOT EXISTS model_metrics_created_idx ON model_metrics(created_at DESC);

CREATE TABLE IF NOT EXISTS telegram_messages (
  id SERIAL PRIMARY KEY,
  direction TEXT NOT NULL CHECK (direction IN ('inbound', 'outbound')),
  chat_id TEXT NOT NULL,
  message_text TEXT,
  command TEXT,
  objective_id TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS telegram_messages_chat_ts_idx ON telegram_messages(chat_id, created_at DESC);

CREATE TABLE IF NOT EXISTS gpu_snapshots (
  id SERIAL PRIMARY KEY,
  ts TIMESTAMPTZ NOT NULL,
  devices JSONB NOT NULL DEFAULT '[]',
  total_memory_pct NUMERIC(5,2),
  total_util_pct NUMERIC(5,2),
  active_agents INT DEFAULT 0
);
CREATE INDEX IF NOT EXISTS gpu_snapshots_ts_idx ON gpu_snapshots(ts DESC);
