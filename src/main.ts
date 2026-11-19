import { ValidationPipe, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { NestFactory } from '@nestjs/core';
import cookieParser from 'cookie-parser';
import helmet from 'helmet';
import compression from 'compression';
import { json, urlencoded } from 'express';
import { AppModule } from './app.module';
import { GlobalExceptionFilter } from './common/filters/global-exception.filter';

async function bootstrap() {
  const logger = new Logger('Bootstrap');
  const app = await NestFactory.create(AppModule);

  const configService = app.get(ConfigService);

  // 1. Trust proxy for rate limiting and real client IP behind load balancers/reverse proxies
  const trustProxy = configService.get<string>('TRUST_PROXY');
  if (trustProxy !== undefined && trustProxy !== '') {
    const expressApp = app.getHttpAdapter().getInstance();
    if (trustProxy === 'true' || trustProxy === '1') {
      expressApp.set('trust proxy', 1);
    } else if (!isNaN(Number(trustProxy))) {
      expressApp.set('trust proxy', Number(trustProxy));
    } else {
      expressApp.set('trust proxy', trustProxy);
    }
  }

  // 2. Security headers via Helmet
  app.use(
    helmet({
      contentSecurityPolicy: false, // Allows Swagger UI to execute if loaded
      crossOriginEmbedderPolicy: false,
    }),
  );

  // 3. Response compression (gzip/deflate)
  app.use(compression());

  // 4. Request body size limit (100kb default)
  app.use(json({ limit: '100kb' }));
  app.use(urlencoded({ extended: true, limit: '100kb' }));

  // 5. Cookie parsing for refresh tokens
  app.use(cookieParser());

  // 6. CORS Configuration
  const corsOriginsEnv = configService.get<string>('CORS_ORIGINS');
  const allowedOrigins = corsOriginsEnv
    ? corsOriginsEnv.split(',').map((o) => o.trim())
    : true; // In dev/test, defaults to reflecting caller origin

  app.enableCors({
    origin: allowedOrigins,
    credentials: true,
    methods: ['GET', 'HEAD', 'PUT', 'PATCH', 'POST', 'DELETE', 'OPTIONS'],
    allowedHeaders: [
      'Content-Type',
      'Authorization',
      'X-Requested-With',
      'x-request-id',
      'Accept',
    ],
    exposedHeaders: ['x-request-id', 'Content-Disposition'],
  });

  // 7. Global ValidationPipe
  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      forbidNonWhitelisted: true,
      transform: true,
    }),
  );

  // 8. Global Exception Filter
  app.useGlobalFilters(new GlobalExceptionFilter(configService));

  // 9. Shutdown hooks
  app.enableShutdownHooks();

  const port = configService.get<number>('PORT', 3000);
  await app.listen(port);
  logger.log(`Leave Management System backend running on port ${port}`);
}

bootstrap();
