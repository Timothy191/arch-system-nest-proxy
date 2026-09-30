import { Module } from '@nestjs/core';
import { AppController } from './app.controller';
import { AppService } from './app.service';
import { BullModule } from '@nestjs/bullmq';

@Module({
  imports: [
    // Integrate BullMQ + Redis inside the proxy
    BullModule.forRoot({
      connection: {
        host: process.env.REDIS_HOST || 'localhost',
        port: parseInt(process.env.REDIS_PORT || '6379', 10),
        password: process.env.REDIS_PASSWORD || '',
        // HTTP-based redis proxy like Upstash would use different config here
        // This abstracts the queueing layer from the raw NestJS execution
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
