# Queue Contract — `n8n-workflow-queue`

> Producer: `arch-system-nest-proxy` (`POST /workflows/dispatch`).
> Consumer: external BullMQ worker (n8n/Kestra runner) — **not in this repo**.
> This document is the single source of truth for the job payload shape; the
> TypeScript type lives in `src/queue/workflow-job.types.ts` so both sides can
> import it. `Arch-System/tools/zero-drift-watchdog/` verifies these names
> against `arch-system-nest-proxy/src`.

## Names

| Item | Value |
|---|---|
| Queue name | `n8n-workflow-queue` |
| Job name | `execute-workflow` |
| Job ID | `wf_<epochMs>_<5-char-rand>` or `idem_<idempotencyKey>` |

## Payload (`WorkflowJobData`)

| Field | Type | Notes |
|---|---|---|
| `jobId` | `string` | Mirrors the BullMQ job id |
| `workflowId` | `string` | Defaults to `custom_workflow` |
| `name` | `string` | Defaults to `n8n Automated Workflow` |
| `nodesCount` | `number` | `nodes.length` from the dispatch payload |
| `edgesCount` | `number` | `edges.length` from the dispatch payload |
| `triggeredBy` | `string` | Author/actor, defaults to `DEFAULT_TRIGGERED_BY` or `system` |
| `enqueuedAt` | `string` | ISO-8601 timestamp |
| `status` | `'queued'` | Initial status at enqueue time |
| `idempotencyKey` | `string?` | Present only when the caller supplied one |

## Job options (set by the producer)

- `attempts: 3` with exponential backoff (`delay: 5000`, ×2 per retry)
- `removeOnComplete: { age: 3600 }` — completed jobs kept 1h (so `GET /workflows/jobs/:id` can report `completed`)
- `removeOnFail: { age: 86400 }` — failed jobs kept 24h for debugging

## Consumer requirements

1. Listen for job name `execute-workflow` on queue `n8n-workflow-queue`.
2. Treat `jobId` as the idempotency boundary — never execute the same `jobId` twice.
3. Redis connection must use `maxRetriesPerRequest: null` (BullMQ requirement).
4. Report terminal state back via `job.moveToCompleted` / `job.moveToFailed`
   (BullMQ default behavior is fine).

## Dispatch API response contract

| HTTP | `queueStatus` | Meaning |
|---|---|---|
| 201 | `enqueued` | Job durably queued in Redis |
| 201 | `simulated` | No queue wired (test runtime only) |
| 503 | `unavailable` | **Not queued** — Redis unreachable; retry later |

> **Breaking change vs. old contract:** `buffered_locally` was removed. It
> claimed durability that did not exist. Any caller branching on
> `queueStatus === 'buffered_locally'` must switch to treating 503 as retry.
