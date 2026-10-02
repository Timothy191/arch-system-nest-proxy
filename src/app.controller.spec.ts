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
    });
  });
});
