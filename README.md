# arch-system-nest-proxy

Serverless **NestJS 12 + BullMQ workflow dispatcher** deployed to Vercel project `arch-system-nest-proxy`. Accepts workflow dispatch requests from portal webhooks and Kestra workflows, enqueues them onto a Redis-backed BullMQ queue, and exposes health/telemetry endpoints.

## Architecture

```
Webhook / Kestra / Portal
        │  POST /workflows/dispatch
        ▼
Vercel serverless function (src/main.ts → cached Nest bootstrap)
        │  ValidationPipe + ApiKeyGuard + CORS allowlist
        ▼
AppController ──► AppService ──► BullMQ queue "n8n-workflow-queue"
                                     │
                                     ▼
                          Redis (Upstash / managed)
                                     │
                                     ▼
                          External BullMQ consumer (n8n/Kestra worker)
```

## API

| Method | Path | Auth | Description |
|---|---|---|---|
| GET | `/` | — | Service identity/status |
| GET | `/health` | — | Liveness probe (uptime) |
| GET | `/redis/stats` | — | Live Redis/queue telemetry (host masked) |
| GET | `/workflows/jobs/:jobId` | — | Job status lookup (`found`, `state`, `attemptsMade`, …) |
| POST | `/workflows/dispatch` | Bearer | Enqueue a workflow job |

### Dispatch

```http
POST /workflows/dispatch
Authorization: Bearer <DISPATCH_API_KEY>
Content-Type: application/json

{
  "workflowId": "wf-sync",
  "name": "Nightly Sync",
  "nodes": [{ "id": "n1" }],
  "edges": [{ "from": "n1", "to": "n2" }],
  "triggeredBy": "portal",
  "idempotencyKey": "portal-event-123"   // optional: dedupes retries
}
```

Responses:

- **201** `queueStatus: "enqueued"` — durably queued (or `"simulated"` in test runtimes without a queue).
- **503** `queueStatus: "unavailable"` — **not queued** (Redis unreachable); retry with the same `idempotencyKey`.
- **401** — missing/invalid bearer token (when `DISPATCH_API_KEY` is set).
- **400** — validation failure (`whitelist: true` strips unknown fields).

Job payload contract for consumers: **[docs/queue-contract.md](docs/queue-contract.md)**.

## Configuration (env)

| Var | Required | Purpose |
|---|---|---|
| `DISPATCH_API_KEY` | recommended | Bearer token guarding `POST /workflows/dispatch` |
| `REQUIRE_API_KEY` | no | `true` → reject dispatch when `DISPATCH_API_KEY` unset |
| `CORS_ORIGIN` | recommended | Comma-separated origin allowlist; **no wildcard** — unset disables CORS |
| `QUEUE_REDIS_URL` / `REDIS_URL` | yes* | Redis connection URL (`rediss://` / Upstash) |
| `REDIS_HOST`/`REDIS_PORT`/`REDIS_PASSWORD`/`REDIS_TLS` | alt | Discrete Redis config fallback |
| `REDIS_TLS_INSECURE` | no | `true` → skip TLS cert verification (self-signed only) |
| `DEFAULT_TRIGGERED_BY` | no | Fallback `triggeredBy` value |

\* Without Redis the service still boots; dispatch returns 503 and stats report `RED`.

## Development

```bash
npm run start:dev   # watch dev server
npm run build       # production build
npm run lint        # oxlint type-aware check
npm run test        # vitest unit suite
npm run test:e2e    # supertest e2e suite (uses a mocked queue; no Redis needed)
npm run format      # prettier
```

Always run npm from this directory (`cd arch-system-nest-proxy`), never the repo root.

## Deployment

Pushes to `master` on the connected GitHub repository auto-deploy to Vercel Production (`vercel.json` routes all paths to `src/main.ts`).

## Operational notes

- **Honest failure contract**: enqueue failures return 503 — there is no in-memory buffering.
- **Idempotency**: supply `idempotencyKey` to make webhook retries safe (job id becomes `idem_<key>`).
- **Bounded latency**: enqueue (3s), job lookup (3s), stats (4s) timeouts prevent hanging requests when Redis is slow.
- **CORS**: set `CORS_ORIGIN` explicitly for browser callers; server-to-server callers are unaffected.
- **Sibling path integrity**: `Arch-System/tools/zero-drift-watchdog/` verifies contracts against `src/` — do not rename this directory or the queue/job names in `src/queue/workflow-job.types.ts`.
