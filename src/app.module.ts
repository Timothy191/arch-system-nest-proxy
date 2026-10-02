import { Module } from '@nestjs/common';
import { AppController } from './app.controller.js';
import { AppService } from './app.service.js';
import { BullModule } from '@nestjs/bullmq';

function getRedisConnectionOptions() {
  const redisUrl = process.env.QUEUE_REDIS_URL || process.env.REDIS_URL;
  const options: Record<string, any> = {
    maxRetriesPerRequest: null,
    enableOfflineQueue: false,
    lazyConnect: true,
    connectTimeout: 5000,
    retryStrategy: () => null,
  };

  if (redisUrl) {
    try {
      const parsed = new URL(redisUrl);
      options.host = parsed.hostname;
      options.port = parseInt(parsed.port || '6379', 10);
      if (parsed.password) options.password = decodeURIComponent(parsed.password);
      if (parsed.username && parsed.username !== 'default') options.username = parsed.username;
      if (parsed.protocol === 'rediss:' || parsed.hostname.includes('upstash.io')) {
        options.tls = { rejectUnauthorized: false };
      }
      return options;
    } catch {
      // Fallback to standard env vars below
    }
  }

  options.host = process.env.REDIS_HOST || 'localhost';
  options.port = parseInt(process.env.REDIS_PORT || '6379', 10);
  options.password = process.env.REDIS_PASSWORD || '';
  if (
    process.env.REDIS_TLS === 'true' ||
    process.env.REDIS_HOST?.includes('upstash.io') ||
    options.port === 6380
  ) {
    options.tls = { rejectUnauthorized: false };
  }
  return options;
}

@Module({
  imports: [
    // Integrate BullMQ + Redis inside the proxy
    BullModule.forRoot({
      connection: getRedisConnectionOptions(),
    }),
    BullModule.registerQueue({
      name: 'n8n-workflow-queue',
    }),
  ],
  controllers: [AppController],
  providers: [AppService],
})
export class AppModule {}
