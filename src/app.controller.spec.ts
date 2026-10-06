import { Test, TestingModule } from '@nestjs/testing';
import { AppController } from './app.controller.js';
import { AppService } from './app.service.js';

describe('AppController', () => {
  let appController: AppController;

  beforeEach(async () => {
    const app: TestingModule = await Test.createTestingModule({
      controllers: [AppController],
      providers: [AppService],
    }).compile();

    appController = app.get<AppController>(AppController);
  });

  describe('root', () => {
    it('should return operational status object', () => {
      const res = appController.getHello();
      expect(res).toHaveProperty('status', 'operational');
      expect(res).toHaveProperty('service', 'arch-system-nest-proxy');
      expect(res).toHaveProperty('version', '1.0.0');
      expect(res).toHaveProperty('timestamp');
    });
  });

  describe('health', () => {
    it('should return health status object', () => {
      const res = appController.getHealth();
      expect(res).toHaveProperty('status', 'ok');
      expect(res).toHaveProperty('uptime');
      expect(res).toHaveProperty('timestamp');
    });
  });

  describe('redis/stats', () => {
    it('should return redis telemetry stats without hardcoded fake values', async () => {
      const res = await appController.getRedisStats();
      expect(res).toHaveProperty('connected', false);
      expect(res).toHaveProperty('activeQueues', ['n8n-workflow-queue']);
      expect(res).toHaveProperty('clusterHealth', 'RED');
      expect(res).toHaveProperty('memoryAllocated', '0 MB');
    });
  });

  describe('workflows/dispatch', () => {
    it('should dispatch workflow using default system sender when omitted', async () => {
      const res = await appController.dispatchWorkflow({
        workflowId: 'test_wf',
        name: 'Test Workflow',
        nodes: [{ id: '1' }],
        edges: [],
      });
      expect(res.success).toBe(true);
      expect(res.details.triggeredBy).toBe('system');
      expect(res.details.nodesCount).toBe(1);
      expect(res.queueStatus).toBe('simulated');
    });

    it('should preserve provided triggeredBy author', async () => {
      const res = await appController.dispatchWorkflow({
        workflowId: 'test_wf',
        triggeredBy: 'operator@company.com',
      });
      expect(res.success).toBe(true);
      expect(res.details.triggeredBy).toBe('operator@company.com');
    });

    it('should derive deterministic idem_ jobId from idempotencyKey', async () => {
      const first = await appController.dispatchWorkflow({
        workflowId: 'test_wf',
        idempotencyKey: 'portal-event-42',
      });
      const second = await appController.dispatchWorkflow({
        workflowId: 'test_wf',
        idempotencyKey: 'portal-event-42',
      });
      expect(first.jobId).toBe('idem_portal-event-42');
      expect(second.jobId).toBe(first.jobId);
      expect(first.details.idempotencyKey).toBe('portal-event-42');
    });
  });

  describe('workflows/jobs/:jobId', () => {
    it('should report queueAvailable=false when no queue is wired (unit runtime)', async () => {
      const res = await appController.getJobStatus('wf_missing');
      expect(res).toHaveProperty('found', false);
      expect(res).toHaveProperty('queueAvailable', false);
      expect(res).toHaveProperty('jobId', 'wf_missing');
    });
  });
});
