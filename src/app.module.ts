import { Module } from '@nestjs/common';
import { AppController } from './app.controller.js';
import { AppService } from './app.service.js';
import { BullModule } from '@nestjs/bullmq';

@Module({
  imports: [
    // Integrate BullMQ + Redis inside the proxy
    BullModule.forRoot({
      connection: {
        host: process.env.REDIS_HOST || 'localhost',
        port: parseInt(process.env.REDIS_PORT || '6379', 10),
        password: process.env.REDIS_PASSWORD || '',
        maxRetriesPerRequest: null,
        enableOfflineQueue: false,
        lazyConnect: true,
        connectTimeout: 2000,
        retryStrategy: () => null,
      },
    }),
    BullModule.registerQueue({
      name: 'n8n-workflow-queue',
    }),
  ],
  controllers: [AppController],
  providers: [AppService],
})
export class AppModule {}
