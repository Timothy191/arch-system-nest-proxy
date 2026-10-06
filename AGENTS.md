# AGENTS.md — `arch-system-nest-proxy/`

> **SSoT & Operational Context:** NestJS 12 + BullMQ workflow dispatcher backend. Deployed to Vercel project `arch-system-nest-proxy`.

---

## 1. Role & Wiring Invariants

- **Role**: Serverless BullMQ workflow dispatcher and queue manager consumed by portal webhooks and Kestra workflows.
- **Runtime**: Node `>=24`, NestJS 12, BullMQ, `serverless-http`. Tested with `vitest` + `oxlint` + `prettier`.
- **Sibling Path Integrity**: Do NOT rename or move this directory; `Arch-System/tools/zero-drift-watchdog/` verifies contracts directly against `arch-system-nest-proxy/src`.
- **Never Run From Root**: Always run npm commands inside this directory (`cd arch-system-nest-proxy`).

### 1.1 API & Queue Contracts (SSoT)

- **Endpoints**: `GET /`, `GET /health`, `GET /redis/stats`, `GET /workflows/jobs/:jobId`, `POST /workflows/dispatch`.
- **Auth**: `POST /workflows/dispatch` guarded by `ApiKeyGuard` (`src/common/api-key.guard.ts`). Set `DISPATCH_API_KEY` (bearer); `REQUIRE_API_KEY=true` forces fail-closed.
- **CORS**: origin allowlist from `CORS_ORIGIN` (comma-separated); no wildcard — unset disables CORS.
- **Dispatch contract**: 201 `enqueued`/`simulated` on success; **503 `unavailable` when Redis is down (job NOT queued — never a fake 2xx)**. `buffered_locally` was removed.
- **Idempotency**: optional `idempotencyKey` in the dispatch DTO → deterministic job id `idem_<key>`.
- **Queue/Job names + payload schema**: `src/queue/workflow-job.types.ts` (`n8n-workflow-queue` / `execute-workflow`), documented in `docs/queue-contract.md`. Do not rename — watchdog verifies these.
- **TLS**: cert verification ON by default; `REDIS_TLS_INSECURE=true` is the only opt-out.
- **Latency budgets**: enqueue 3s, job lookup 3s, stats 4s (`src/common/with-timeout.ts`).
- **Logging**: structured JSON via `src/common/logger.ts` — no bare `console.*` calls.

---

## 2. Anti-Bloat Skill & Memory Protocol (`skills-mcp` & `memory-gateway-mcp`)

To prevent token bloat and memory degradation:
- **Skills**: Discover via `list_available_skills`, lease via `acquire_skill(skillName, agentId)`, and ALWAYS call `return_skill` upon task completion to release memory and log execution telemetry.
- **Context Slices**: Pull architectural invariants via `acquire_context("federated-invariants", agentId)` or `acquire_context("quality-gates-and-verification", agentId)` and release with `release_context`.
- **Memory Gateway**: Query past failures and retrospectives via `search_unified_memory(query)` before modifying queues or contracts; append post-mortems via `record_retrospective_incident`.
- **Self-Maintenance Mandate**: Agents working in this directory are REQUIRED to keep this `AGENTS.md` and related documentation updated with any new contract changes, port wiring, or dependencies.

---

## 3. Essential Commands

```bash
npm run start:dev     # Dev server
npm run build         # NestJS production build
npm run lint          # oxlint type-aware check
npm run test          # Vitest suite
npm run test:e2e      # End-to-end tests
```
