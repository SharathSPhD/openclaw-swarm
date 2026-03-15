# Swarm Platform Runbook

## Start

```bash
cd /home/sharaths/projects/openclaw_build/swarm-platform
npm install
npm start
```

## Stop

Press `Ctrl+C` in foreground terminal, or kill background process.

## Health Checks

```bash
curl -s http://127.0.0.1:3010/api/health
curl -s http://127.0.0.1:3010/api/system
curl -s http://127.0.0.1:3010/api/queue
```

## Database

```bash
docker compose up -d postgres
```

## Smoke

```bash
./scripts/smoke.sh
```

## Load

```bash
./scripts/load_test.sh http://127.0.0.1:3010 40
```

## Chaos

```bash
./scripts/chaos_test.sh
```

## Incident Steps

1. Check `/api/health` and `/api/system`.
2. Check queue depth and active agent count.
3. If load state is `critical`, temporarily stop external dispatchers.
4. Review recent events from `/api/audit`.
5. Restart service only after queue stabilizes.

## Recovery

1. Ensure events continue in `data/events.jsonl`.
2. If PostgreSQL is unavailable, continue in JSONL fallback mode.
3. Restore database and replay events if needed.
