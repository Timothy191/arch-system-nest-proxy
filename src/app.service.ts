import {
  Injectable,
  NotFoundException,
  OnModuleInit,
  Optional,
  ServiceUnavailableException,
} from '@nestjs/common';
import { InjectQueue } from '@nestjs/bullmq';
import { Queue } from 'bullmq';
import { DispatchWorkflowDto } from './dto/dispatch-workflow.dto.js';
import {
  WORKFLOW_JOB_NAME,
  WORKFLOW_QUEUE_NAME,
  WorkflowJobData,
} from './queue/workflow-job.types.js';
import { log, silenceErrorListeners } from './common/logger.js';
import { withTimeout } from './common/with-timeout.js';

/** Latency budgets (ms) to keep serverless request times bounded. */
const ENQUEUE_TIMEOUT_MS = 3000;
const JOB_LOOKUP_TIMEOUT_MS = 3000;
const REDIS_STATS_TIMEOUT_MS = 4000;

@Injectable()
export class AppService implements OnModuleInit {
  constructor(
    @Optional()
    @InjectQueue(WORKFLOW_QUEUE_NAME)
    private readonly workflowQueue?: Queue,
  ) {}

  async onModuleInit() {
    if (this.workflowQueue) {
      this.workflowQueue.on('error', (err: Error) => {
        // Prevent uncaught BullMQ rejections; logged structurally instead.
        log('warn', 'bullmq_error', { err: err?.message });
      });
      try {
        const client = await this.workflowQueue.client;
        silenceErrorListeners(client, 'bullmq-client');
      } catch {
        // Ignored: Redis offline at boot is tolerated (lazy connect).
      }
    }
  }

  getHello() {
    return {
      status: 'operational',
      service: 'arch-system-nest-proxy',
      version: '1.0.0',
      timestamp: new Date().toISOString(),
    };
  }

  getHealth() {
    return {
      status: 'ok',
      uptime: process.uptime(),
      timestamp: new Date().toISOString(),
    };
  }

  /**
   * Enqueue a workflow job — honest contract:
   * - queue wired + accepted      → success:true, queueStatus:'enqueued'
   * - queue wired + Redis failing → 503 (never a fake success)
   * - no queue injected (tests)   → success:true, queueStatus:'simulated'
   */
  async dispatchWorkflow(payload: DispatchWorkflowDto) {
    const idempotencyKey = payload.idempotencyKey?.trim();
    const jobId = idempotencyKey
      ? `idem_${idempotencyKey}`
      : `wf_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`;

    const jobData: WorkflowJobData = {
      jobId,
      workflowId: payload.workflowId || 'custom_workflow',
      name: payload.name || 'n8n Automated Workflow',
      nodesCount: payload.nodes?.length || 0,
      edgesCount: payload.edges?.length || 0,
      triggeredBy:
        payload.triggeredBy || process.env.DEFAULT_TRIGGERED_BY || 'system',
      enqueuedAt: new Date().toISOString(),
      status: 'queued',
      ...(idempotencyKey ? { idempotencyKey } : {}),
    };

    if (!this.workflowQueue) {
      log('info', 'dispatch_simulated_no_queue', { jobId });
      return {
        success: true,
        jobId,
        queueStatus: 'simulated' as const,
        details: jobData,
        timestamp: new Date().toISOString(),
      };
    }

    try {
      await withTimeout(
        this.workflowQueue.add(WORKFLOW_JOB_NAME, jobData, {
          jobId,
          removeOnComplete: { age: 3600 }, // retain 1h so GET job status works
          removeOnFail: { age: 86400 },
          attempts: 3,
          backoff: { type: 'exponential', delay: 5000 },
        }),
        ENQUEUE_TIMEOUT_MS,
        'queue-add',
      );
      log('info', 'dispatch_enqueued', {
        jobId,
        workflowId: jobData.workflowId,
      });
      return {
        success: true,
        jobId,
        queueStatus: 'enqueued' as const,
        details: jobData,
        timestamp: new Date().toISOString(),
      };
    } catch (err: any) {
      // Honest failure: the job was NOT queued. Callers get 503, not a fake 2xx.
      log('error', 'dispatch_enqueue_failed', {
        jobId,
        err: err?.message ?? String(err),
      });
      throw new ServiceUnavailableException({
        success: false,
        queueStatus: 'unavailable',
        jobId,
        message:
          'Workflow could not be queued: Redis unreachable. Retry later.',
        timestamp: new Date().toISOString(),
      });
    }
  }

  /** Look up a previously dispatched job by its jobId. */
  async getJobStatus(jobId: string) {
    if (!this.workflowQueue) {
      return {
        found: false,
        queueAvailable: false,
        jobId,
        message: 'Queue not wired in this runtime (tests)',
        timestamp: new Date().toISOString(),
      };
    }
    try {
      const job = await withTimeout(
        this.workflowQueue.getJob(jobId),
        JOB_LOOKUP_TIMEOUT_MS,
        'job-lookup',
      );
      if (!job) {
        throw new NotFoundException({
          found: false,
          queueAvailable: true,
          jobId,
          message: 'Job not found (never dispatched or already expired)',
        });
      }
      const state = await job.getState();
      return {
        found: true,
        queueAvailable: true,
        jobId,
        state,
        attemptsMade: job.attemptsMade,
        madeAt: job.timestamp ? new Date(job.timestamp).toISOString() : null,
        finishedOn: job.finishedOn
          ? new Date(job.finishedOn).toISOString()
          : null,
        details: (job.data ?? {}) as WorkflowJobData,
        timestamp: new Date().toISOString(),
      };
    } catch (err: any) {
      if (err instanceof NotFoundException) throw err;
      log('error', 'job_status_lookup_failed', {
        jobId,
        err: err?.message ?? String(err),
      });
      throw new ServiceUnavailableException({
        found: false,
        queueAvailable: false,
        jobId,
        message: 'Job lookup failed: Redis unreachable. Retry later.',
        timestamp: new Date().toISOString(),
      });
    }
  }

  async getRedisStats() {
    const defaults = {
      connected: false,
      queueCounts: { waiting: 0, active: 0, completed: 0, failed: 0 },
      memoryAllocated: '0 MB',
      peakMemory: '0 MB',
      totalKeys: 0,
      opsPerSecond: 0,
    };
    let stats = { ...defaults };

    if (this.workflowQueue) {
      try {
        stats = await withTimeout(
          this.collectRedisStats(defaults),
          REDIS_STATS_TIMEOUT_MS,
          'redis-stats',
        );
      } catch (err: any) {
        // Budget exceeded or Redis offline → honest RED, no hanging request.
        log('warn', 'redis_stats_unavailable', {
          err: err?.message ?? String(err),
        });
        stats = { ...defaults };
      }
    }

    const host =
      process.env.REDIS_HOST ||
      (process.env.REDIS_URL
        ? new URL(process.env.REDIS_URL).hostname
        : 'localhost (in-memory fallback)');

    return {
      connected: stats.connected,
      host: host.includes('localhost') ? host : `${host.substring(0, 12)}...`,
      port: process.env.REDIS_PORT || '6379',
      activeQueues: [WORKFLOW_QUEUE_NAME],
      queueCounts: stats.queueCounts,
      memoryAllocated: stats.memoryAllocated,
      peakMemory: stats.peakMemory,
      totalKeys: stats.totalKeys,
      opsPerSecond: stats.opsPerSecond,
      clusterHealth: stats.connected ? 'GREEN' : 'RED',
      lastHeartbeat: new Date().toISOString(),
    };
  }

  private async collectRedisStats(defaults: {
    connected: boolean;
    queueCounts: {
      waiting: number;
      active: number;
      completed: number;
      failed: number;
    };
    memoryAllocated: string;
    peakMemory: string;
    totalKeys: number;
    opsPerSecond: number;
  }) {
    const result = { ...defaults };
    const client = (await this.workflowQueue!.client) as any;
    silenceErrorListeners(client, 'stats-client');
    if (client.status !== 'ready' && client.status !== 'connect') {
      return result;
    }
    const pingRes = await client.ping();
    if (pingRes !== 'PONG') {
      return result;
    }
    result.connected = true;
    result.queueCounts = (await this.workflowQueue!.getJobCounts(
      'waiting',
      'active',
      'completed',
      'failed',
    )) as typeof defaults.queueCounts;

    try {
      const infoStr = await client.info();
      const memoryMatch = infoStr.match(/used_memory_human:([^\r\n]+)/);
      const peakMatch = infoStr.match(/used_memory_peak_human:([^\r\n]+)/);
      const opsMatch = infoStr.match(/instantaneous_ops_per_sec:([^\r\n]+)/);
      const dbsize = await client.dbsize();

      result.memoryAllocated = memoryMatch ? memoryMatch[1].trim() : 'N/A';
      result.peakMemory = peakMatch ? peakMatch[1].trim() : 'N/A';
      result.totalKeys = typeof dbsize === 'number' ? dbsize : 0;
      result.opsPerSecond = opsMatch ? parseInt(opsMatch[1].trim(), 10) : 0;
    } catch {
      // INFO/DBSIZE might be restricted in some managed Redis environments
    }
    return result;
  }
}
