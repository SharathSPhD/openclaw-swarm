# Release Checklist

## Pre-Release

- [ ] `npm run check` passes
- [ ] `npm test` passes
- [ ] `./scripts/smoke.sh` passes
- [ ] `./scripts/load_test.sh` completes without crash
- [ ] `./scripts/chaos_test.sh` completes
- [ ] Leaderboard and audit pages render
- [ ] Telegram relay configured and tested
- [ ] No secrets committed in repository

## Functional Gates

- [ ] Real or mock runner emits started/completed or started/failed
- [ ] Policy rejections visible in audit trail
- [ ] Queue behavior visible under high load
- [ ] Score changes deterministic under replay
- [ ] Telegram delivery links include eventId/taskId

## Security Gates

- [ ] Admin API key set for protected endpoints
- [ ] Input validation blocks malformed payloads
- [ ] OpenClaw sandbox remains `non-main`
- [ ] Telegram token is in environment, not source

## Rollout

- [ ] Pilot one team first
- [ ] Enable multi-team after 24h stable run
- [ ] Freeze scoring rules before tournament window
- [ ] Publish runbook and on-call ownership
