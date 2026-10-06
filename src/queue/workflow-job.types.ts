/**
 * Shared contract between the dispatcher (this service) and the downstream
 * BullMQ consumer (n8n/Kestra worker). See docs/queue-contract.md.
 * The zero-drift-watchdog verifies these names against src/.
 */
export const WORKFLOW_QUEUE_NAME = 'n8n-workflow-queue';
export const WORKFLOW_JOB_NAME = 'execute-workflow';

export interface WorkflowJobData {
  /** `wf_<ts>_<rand>` or `idem_<idempotencyKey>` — unique per logical dispatch. */
  jobId: string;
  workflowId: string;
  name: string;
  nodesCount: number;
  edgesCount: number;
  triggeredBy: string;
  enqueuedAt: string;
  status: 'queued';
  idempotencyKey?: string;
}
