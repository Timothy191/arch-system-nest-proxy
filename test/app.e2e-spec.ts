import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import request from 'supertest';
import { App } from 'supertest/types.js';
import { getQueueToken } from '@nestjs/bullmq';
import { AppModule } from './../src/app.module.js';
import { WORKFLOW_QUEUE_NAME } from './../src/queue/workflow-job.types.js';

/**
 * Deterministic in-memory queue double so e2e never depends on a live Redis.
 * Behavior of `add` / `getJob` is controllable per-test via vi.fn hooks.
 */
function createMockQueue() {
  const jobs = new Map<string, any>();
  return {
    on: () => undefined,
    client: Promise.resolve({
      on: () => undefined,
      status: 'stop',
      ping: async () => 'PONG',
      info: async () => '',
      dbsize: async () => 0,
    }),
    add: async (name: string, data: any, opts: any) => {
      jobs.set(opts.jobId, {
        id: opts.jobId,
        data,
        attemptsMade: 0,
        timestamp: Date.now(),
      });
      return { id: opts.jobId, name };
    },
    getJobCounts: async () => ({
      waiting: 1,
      active: 0,
      completed: 0,
      failed: 0,
    }),
    getJob: async (jobId: string) => {
      const job = jobs.get(jobId);
      if (!job) return undefined;
      return {
        ...job,
        getState: async () => 'waiting',
        finishedOn: null,
      };
    },
    /** test hooks */
    _jobs: jobs,
    _failNextAdd: false,
  };
}

describe('AppController (e2e)', () => {
  let app: INestApplication<App>;
  let mockQueue: ReturnType<typeof createMockQueue>;
  const originalApiKey = process.env.DISPATCH_API_KEY;

  beforeEach(async () => {
    // baseline: dispatch is unauthenticated unless a test opts in
    delete process.env.DISPATCH_API_KEY;
    mockQueue = createMockQueue();
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    })
      .overrideProvider(getQueueToken(WORKFLOW_QUEUE_NAME))
      .useValue(mockQueue)
      .compile();

    app = moduleFixture.createNestApplication();
    app.useGlobalPipes(
      new ValidationPipe({
        whitelist: true,
        transform: true,
      }),
    );
    await app.init();
  });

  afterEach(async () => {
    await app.close();
    // restore auth env between tests
    if (originalApiKey === undefined) {
      delete process.env.DISPATCH_API_KEY;
    } else {
      process.env.DISPATCH_API_KEY = originalApiKey;
    }
  });

  describe('GET /', () => {
    it('should return operational status JSON', () => {
      return request(app.getHttpServer())
        .get('/')
        .expect(200)
        .expect((res) => {
          expect(res.body).toMatchObject({
            status: 'operational',
            service: 'arch-system-nest-proxy',
            version: '1.0.0',
          });
          expect(typeof res.body.timestamp).toBe('string');
        });
    });
  });

  describe('GET /health', () => {
    it('should return service health metadata', () => {
      return request(app.getHttpServer())
        .get('/health')
        .expect(200)
        .expect((res) => {
          expect(res.body).toMatchObject({
            status: 'ok',
          });
          expect(typeof res.body.uptime).toBe('number');
          expect(typeof res.body.timestamp).toBe('string');
        });
    });
  });

  describe('GET /redis/stats', () => {
    it('should return structured redis telemetry and accurate health', () => {
      return request(app.getHttpServer())
        .get('/redis/stats')
        .expect(200)
        .expect((res) => {
          expect(res.body).toHaveProperty('connected');
          expect(typeof res.body.connected).toBe('boolean');
          expect(res.body).toHaveProperty('host');
          expect(res.body).toHaveProperty('port');
          expect(res.body.activeQueues).toContain('n8n-workflow-queue');
          expect(res.body).toHaveProperty('queueCounts');
          expect(['GREEN', 'RED']).toContain(res.body.clusterHealth);
          expect(res.body).toHaveProperty('memoryAllocated');
          expect(res.body).toHaveProperty('peakMemory');
          expect(res.body).toHaveProperty('totalKeys');
          expect(res.body).toHaveProperty('opsPerSecond');
          expect(typeof res.body.lastHeartbeat).toBe('string');
        });
    });
  });

  describe('POST /workflows/dispatch', () => {
    it('should accept valid workflow payload and enqueue job', () => {
      const payload = {
        workflowId: 'wf-test-123',
        name: 'Automated Sync Job',
        nodes: [
          { id: 'node_1', type: 'trigger' },
          { id: 'node_2', type: 'action' },
        ],
        edges: [{ from: 'node_1', to: 'node_2' }],
        triggeredBy: 'tester@enterprise.io',
      };

      return request(app.getHttpServer())
        .post('/workflows/dispatch')
        .send(payload)
        .expect(201)
        .expect((res) => {
          expect(res.body.success).toBe(true);
          expect(res.body.jobId).toMatch(/^wf_/);
          expect(res.body.details).toMatchObject({
            workflowId: 'wf-test-123',
            name: 'Automated Sync Job',
            nodesCount: 2,
            edgesCount: 1,
            triggeredBy: 'tester@enterprise.io',
            status: 'queued',
          });
        });
    });

    it('should apply safe defaults when optional fields are omitted', () => {
      return request(app.getHttpServer())
        .post('/workflows/dispatch')
        .send({})
        .expect(201)
        .expect((res) => {
          expect(res.body.success).toBe(true);
          expect(res.body.details).toMatchObject({
            workflowId: 'custom_workflow',
            name: 'n8n Automated Workflow',
            nodesCount: 0,
            edgesCount: 0,
            triggeredBy: 'system',
            status: 'queued',
          });
          // Ensure personal hardcoded email is not present
          expect(res.body.details.triggeredBy).not.toBe(
            'timothyoniel558@gmail.com',
          );
        });
    });

    it('should reject invalid payloads with 400 Bad Request', () => {
      const invalidPayload = {
        workflowId: 12345, // invalid type, should be string
        nodes: 'not-an-array', // invalid type, should be array
        edges: 'not-an-array', // invalid type, should be array
      };

      return request(app.getHttpServer())
        .post('/workflows/dispatch')
        .send(invalidPayload)
        .expect(400)
        .expect((res) => {
          expect(res.body).toHaveProperty('message');
          expect(Array.isArray(res.body.message)).toBe(true);
          expect(res.body.error).toBe('Bad Request');
        });
    });

    it('should report queueStatus enqueued when queue accepted the job', async () => {
      const res = await request(app.getHttpServer())
        .post('/workflows/dispatch')
        .send({ workflowId: 'wf-enq' })
        .expect(201);
      expect(res.body.queueStatus).toBe('enqueued');
      expect(mockQueue._jobs.has(res.body.jobId)).toBe(true);
    });

    it('should return deterministic idem_ jobId for idempotent retries', async () => {
      const first = await request(app.getHttpServer())
        .post('/workflows/dispatch')
        .send({ workflowId: 'wf-idem', idempotencyKey: 'evt-99' })
        .expect(201);
      const second = await request(app.getHttpServer())
        .post('/workflows/dispatch')
        .send({ workflowId: 'wf-idem', idempotencyKey: 'evt-99' })
        .expect(201);
      expect(first.body.jobId).toBe('idem_evt-99');
      expect(second.body.jobId).toBe('idem_evt-99');
      expect(mockQueue._jobs.size).toBe(1); // deduplicated, not duplicated
    });

    it('should reject malformed idempotencyKey with 400', () => {
      return request(app.getHttpServer())
        .post('/workflows/dispatch')
        .send({ idempotencyKey: 'bad key with spaces!' })
        .expect(400);
    });

    it('should return 503 (not fake success) when enqueue fails', async () => {
      const originalAdd = mockQueue.add;
      mockQueue.add = async () => {
        throw new Error('Redis connection lost');
      };
      try {
        const res = await request(app.getHttpServer())
          .post('/workflows/dispatch')
          .send({ workflowId: 'wf-fail' })
          .expect(503);
        expect(res.body.success).toBe(false);
        expect(res.body.queueStatus).toBe('unavailable');
      } finally {
        mockQueue.add = originalAdd;
      }
    });
  });

  describe('POST /workflows/dispatch auth', () => {
    it('should reject missing bearer token with 401 when DISPATCH_API_KEY set', async () => {
      process.env.DISPATCH_API_KEY = 'test-secret-key';
      await request(app.getHttpServer())
        .post('/workflows/dispatch')
        .send({ workflowId: 'wf-auth' })
        .expect(401);
    });

    it('should reject wrong bearer token with 401', async () => {
      process.env.DISPATCH_API_KEY = 'test-secret-key';
      await request(app.getHttpServer())
        .post('/workflows/dispatch')
        .set('Authorization', 'Bearer wrong-key')
        .send({ workflowId: 'wf-auth' })
        .expect(401);
    });

    it('should accept valid bearer token with 201', async () => {
      process.env.DISPATCH_API_KEY = 'test-secret-key';
      await request(app.getHttpServer())
        .post('/workflows/dispatch')
        .set('Authorization', 'Bearer test-secret-key')
        .send({ workflowId: 'wf-auth' })
        .expect(201);
    });
  });

  describe('GET /workflows/jobs/:jobId', () => {
    it('should return job status for a previously dispatched job', async () => {
      const dispatch = await request(app.getHttpServer())
        .post('/workflows/dispatch')
        .send({ workflowId: 'wf-lookup' })
        .expect(201);

      const res = await request(app.getHttpServer())
        .get(`/workflows/jobs/${dispatch.body.jobId}`)
        .expect(200);
      expect(res.body).toMatchObject({
        found: true,
        queueAvailable: true,
        jobId: dispatch.body.jobId,
        state: 'waiting',
      });
      expect(res.body.details).toMatchObject({ workflowId: 'wf-lookup' });
    });

    it('should return 404 for unknown job id', async () => {
      const res = await request(app.getHttpServer())
        .get('/workflows/jobs/wf_does_not_exist')
        .expect(404);
      expect(res.body).toMatchObject({
        found: false,
        jobId: 'wf_does_not_exist',
      });
    });
  });
});
