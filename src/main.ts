import { NestFactory } from '@nestjs/core';
import { ValidationPipe } from '@nestjs/common';
import { AppModule } from './app.module.js';

let cachedApp: any;
let bootstrapPromise: Promise<any> | null = null;

async function bootstrap() {
  if (cachedApp) {
    return cachedApp;
  }
  if (!bootstrapPromise) {
    bootstrapPromise = (async () => {
      const app = await NestFactory.create(AppModule);
      app.useGlobalPipes(
        new ValidationPipe({
          whitelist: true,
          transform: true,
        }),
      );
      // Explicit origin allowlist (no wildcard). Set CORS_ORIGIN to a
      // comma-separated list of allowed origins, e.g.
      // "https://portal.example.com,https://app.example.com".
      const allowedOrigins = (process.env.CORS_ORIGIN || '')
        .split(',')
        .map((o) => o.trim())
        .filter(Boolean);
      app.enableCors({
        origin: allowedOrigins.length > 0 ? allowedOrigins : false,
        methods: 'GET,HEAD,PUT,PATCH,POST,DELETE,OPTIONS',
        allowedHeaders: ['Content-Type', 'Authorization'],
        credentials: true,
      });
      await app.init();
      cachedApp = app.getHttpAdapter().getInstance();
      return cachedApp;
    })();
  }
  return bootstrapPromise;
}

export default async function handler(req: any, res: any) {
  const expressApp = await bootstrap();
  return expressApp(req, res);
}
