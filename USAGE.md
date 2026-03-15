# OpenClaw Usage Guide

OpenClaw v2026.3.13 - Agent framework with Telegram integration, web search, and Docker-based sandboxing.

## Quick Start

### Start Gateway
```bash
systemctl --user start openclaw-gateway
```

### Stop Gateway
```bash
systemctl --user stop openclaw-gateway
```

### Check Status
```bash
systemctl --user status openclaw-gateway
```

### View Logs
```bash
journalctl --user -u openclaw-gateway -f
```

### Prepare Swarm Models (Required)
```bash
cd /home/sharaths/projects/openclaw_build/swarm-platform
./scripts/pull_required_models.sh
./scripts/benchmark_models.sh 3
```

This pulls all required low-latency and quality models used by role routing and generates `data/model_latency.json` for Command Center visibility.

---

## Gateway Management

### Enable Auto-Start on Login
```bash
systemctl --user enable openclaw-gateway
```

### Disable Auto-Start
```bash
systemctl --user disable openclaw-gateway
```

### Restart Gateway (After Config Changes)
```bash
systemctl --user restart openclaw-gateway
```

### Restart with Clean State
```bash
systemctl --user stop openclaw-gateway
rm -rf ~/.openclaw/agents/*/sessions/*
systemctl --user start openclaw-gateway
```

---

## Agent Operations

### Send Message to Agent (CLI)

**Basic syntax:**
```bash
openclaw agent --agent main --message "Your query" --channel telegram --to +<USER_ID> --json
```

**Examples:**

Search the web:
```bash
openclaw agent --agent main --message "Search for Bitcoin price" --channel telegram --to 8679892510 --json
```

With timeout (45 seconds):
```bash
timeout 45 openclaw agent --agent main --message "Search web for latest news" --channel telegram --to 8679892510 --json
```

Extract field from JSON response:
```bash
openclaw agent --agent main --message "Your query" --channel telegram --to 8679892510 --json | jq '.result.payloads[0].text'
```

### Common Query Examples

**Web Search:**
```bash
"Search the web for Bitcoin price and summarize 3 results"
"What is the latest news about AI?"
"Find information about OpenClaw documentation"
```

**Information Retrieval:**
```bash
"List all files in the workspace"
"What tools do you have available?"
"Can you read my configuration file?"
```

**Tool Verification:**
```bash
"Do you have web_search tool available?"
"List all your available tools"
"Can you access the web?"
```

---

## Configuration

### Main Config File
Location: `~/.openclaw/openclaw.json`

**Key sections:**
- `agents.defaults.sandbox` - Sandboxing security settings
- `tools.web` - Web search/fetch configuration
- `channels.telegram` - Telegram bot settings

### Environment Variables

**Brave Search API Key:**
```bash
systemctl --user set-environment BRAVE_API_KEY="<your-key-here>"
systemctl --user restart openclaw-gateway
```

Swarm-platform can also read `BRAVE_API_KEY` from `/home/sharaths/projects/openclaw_build/swarm-platform/.env`.

**Telegram Bot Token for Swarm Platform:**
```bash
export TELEGRAM_BOT_TOKEN="<bot-token>"
```

If `TELEGRAM_BOT_TOKEN` is not provided, swarm-platform falls back to `channels.telegram.botToken` in `~/.openclaw/openclaw.json`.

**Verify Key is Set:**
```bash
systemctl --user show-environment | grep BRAVE
```

### Sandbox Modes

| Mode | Main Session | Telegram Sessions | Use Case |
|------|---|---|---|
| `"off"` | Unsandboxed | Unsandboxed | Development only (unsafe) |
| `"non-main"` | Unsandboxed | Sandboxed | **Production: multi-user DGX** |
| `"all"` | Sandboxed | Sandboxed | Ultra-secure (web tools blocked) |

Current mode: **non-main** (recommended for shared systems)

---

## Tools Available

### Web Tools
- **web_search** - Search the web via Brave Search API
- **web_fetch** - Fetch and parse web page content

### File/Code Tools
- **read** - Read file contents
- **write** - Create/write files
- **edit** - Edit file contents
- **process** - Execute shell commands

### Browser Tools
- **browser** - Automate browser actions (Chrome/Chromium via CDP)

### Model
- **Provider:** Ollama
- **Model:** gpt-oss:120b (131k context window)
- **Location:** Local instance at localhost:11434

---

## Troubleshooting

### Gateway Won't Start
Check logs:
```bash
journalctl --user -u openclaw-gateway -n 50
```

Verify config is valid JSON:
```bash
jq . ~/.openclaw/openclaw.json > /dev/null && echo "Config OK"
```

### Agent Not Responding
**Check gateway status:**
```bash
systemctl --user status openclaw-gateway
```

**Restart gateway:**
```bash
systemctl --user restart openclaw-gateway
sleep 3
```

**Test with simple query:**
```bash
timeout 30 openclaw agent --agent main --message "ping" --channel telegram --to 8679892510 --json
```

### Web Search Not Working
Verify API key is loaded:
```bash
systemctl --user show-environment | grep BRAVE_API_KEY
```

If missing, set it:
```bash
systemctl --user set-environment BRAVE_API_KEY="BSArHMiboO_ExIR332FRHRstGeuSbbJ"
systemctl --user restart openclaw-gateway
```

Then verify from swarm command center:
```bash
curl -s http://127.0.0.1:3010/api/openclaw | jq '.webSearch,.sandbox'
```

`configured: true` means web search and sandbox settings are ready.

### Telegram Proof in Command Center
Run one real task and confirm delivery:
```bash
curl -s -X POST http://127.0.0.1:3010/api/orchestrator/dispatch \
	-H "x-api-key: <ADMIN_API_KEY>" \
	-H "Content-Type: application/json" \
	-d '{"teamId":"team-alpha","task":"Send a telegram proof test","actorRole":"program-lead"}'

curl -s http://127.0.0.1:3010/api/telegram | jq '.enabled,.proof[-1]'
```

If Telegram is still not configured, create token with BotFather and set `TELEGRAM_BOT_TOKEN` (or configure `channels.telegram.botToken` in OpenClaw config).

### Command Timeout (45+ seconds)
- Reduce query complexity
- Check Ollama model availability: `curl localhost:11434/api/tags`
- Check network connectivity: `curl -I https://api.search.brave.com/`

### Docker Sandbox Errors
Verify Docker daemon:
```bash
docker ps
```

Check image availability:
```bash
docker images | grep openclaw-sandbox
```

---

## Performance Tuning

### Adjust Request Timeout
```bash
timeout 60 openclaw agent --agent main --message "Long query" --channel telegram --to +8679892510 --json
```

### Monitor Gateway Memory
```bash
systemctl --user status openclaw-gateway | grep Memory
```

### Clear Old Session Data
```bash
rm -rf ~/.openclaw/agents/main/sessions/*
systemctl --user restart openclaw-gateway
```

---

## Security Notes

### API Keys
- Brave API key stored in systemd environment (not shell history)
- Don't commit keys to version control
- Rotate periodically

### Sandbox Isolation
- User sessions run in Docker container (UID 1000:1000)
- No root access from sandboxed tasks
- Network restricted to web tools only (bridge mode)

### File Access
- Workspace mounted at `/data` inside sandbox
- Host filesystem access limited to workspace directory
- Configuration and secrets protected outside workspace

---

## System Info

- **Installation:** `npm install -g openclaw`
- **Version:** 2026.3.13
- **Node.js:** v22.22.1 (via NVM)
- **Gateway URL:** ws://127.0.0.1:18789
- **Canvas UI:** http://127.0.0.1:18789/__openclaw__/canvas/
- **Ollama:** localhost:11434
- **Docker Network:** bridge (for sandbox)

---

## Useful Commands

**View all agent sessions:**
```bash
ls ~/.openclaw/agents/main/sessions/
```

**Export agent state:**
```bash
cat ~/.openclaw/agents/main/SOUL.md
```

**List workspace skills:**
```bash
ls ~/.openclaw/workspace/skills/
```

**Test Docker sandbox network:**
```bash
docker run --rm --network bridge python:3.11-bookworm bash -c "curl -I https://example.com"
```

**Monitor gateway in real-time:**
```bash
watch -n 2 "systemctl --user status openclaw-gateway | tail -5"
```

---

## Support Resources

- **Config Schema:** `~/.openclaw/openclaw.json` (inline comments in JSON)
- **Agent Workspace:** `~/.openclaw/workspace/AGENTS.md`
- **Skills:** `~/.openclaw/workspace/skills/`
- **Logs:** `/tmp/openclaw/openclaw-*.log`

---

## Swarm Platform (Implementation)

### Start Swarm Platform
```bash
cd /home/sharaths/projects/openclaw_build/swarm-platform
npm install
export ADMIN_API_KEY="<choose-a-key>"
export RUNNER_MODE="mock"   # use real to execute openclaw agent calls
npm start
```

### Stop Swarm Platform
If running in foreground, press `Ctrl+C`.

If running in background terminal, kill that terminal process.

### Swarm Platform URL
- Dashboard: `http://127.0.0.1:3010`
- Leaderboard: `http://127.0.0.1:3010/pages/leaderboard.html`
- Timeline: `http://127.0.0.1:3010/pages/timeline.html`
- Audit: `http://127.0.0.1:3010/pages/audit.html`
- Ops: `http://127.0.0.1:3010/pages/ops.html`
- Health API: `http://127.0.0.1:3010/api/health`
- Leaderboard API: `http://127.0.0.1:3010/api/leaderboard`

### Dispatch Task to Team
```bash
curl -s -X POST http://127.0.0.1:3010/api/orchestrator/dispatch \
	-H "x-api-key: $ADMIN_API_KEY" \
	-H "Content-Type: application/json" \
	-d '{"teamId":"team-alpha","task":"Implement secure queue and test it","actorRole":"team-lead"}'
```

### Emit Manual Penalty Event
```bash
curl -s -X POST http://127.0.0.1:3010/api/events \
	-H "x-api-key: $ADMIN_API_KEY" \
	-H "Content-Type: application/json" \
	-d '{"type":"penalty.applied","teamId":"team-alpha","payload":{"pointsDeducted":30,"reason":"timeout"}}'
```

### Queue, System, and Audit Views
```bash
curl -s http://127.0.0.1:3010/api/system
curl -s http://127.0.0.1:3010/api/queue
curl -s http://127.0.0.1:3010/api/audit
```

### Run Smoke Test
```bash
cd /home/sharaths/projects/openclaw_build/swarm-platform
export ADMIN_API_KEY="<same-key-used-on-server>"
./scripts/smoke.sh
```

### Run Automated Tests
```bash
cd /home/sharaths/projects/openclaw_build/swarm-platform
npm test
```

### Run Load and Chaos Tests
```bash
cd /home/sharaths/projects/openclaw_build/swarm-platform
export ADMIN_API_KEY="<same-key-used-on-server>"
./scripts/load_test.sh http://127.0.0.1:3010 40
./scripts/chaos_test.sh
```

Last Updated: March 15, 2026
