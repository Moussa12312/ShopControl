import 'reflect-metadata';
import { Logger } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import cookieParser from 'cookie-parser';
import helmet from 'helmet';
import { getEnv } from './common/config/env.config';
import { GlobalHttpExceptionFilter } from './common/filters/http-exception.filter';
import { AppModule } from './app.module';

async function bootstrap(): Promise<void> {
  const env = getEnv();
  const app = await NestFactory.create(AppModule);

  app.use(helmet());
  app.use(cookieParser());

  const allowedOrigins = env.CORS_ORIGINS.split(',')
    .map((o) => o.trim())
    .filter(Boolean);

  app.enableCors({
    origin: allowedOrigins,
    credentials: true,
    methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
    allowedHeaders: [
      'Content-Type',
      'Authorization',
      'X-Shop-Id',
      'X-Operator-Id',
      'X-Operator-Pin',
      'X-Support-Grant-Id',
      'X-Idempotency-Key',
      'X-Correlation-Id',
    ],
  });

  app.setGlobalPrefix('api/v1');
  app.useGlobalFilters(new GlobalHttpExceptionFilter());

  const swaggerConfig = new DocumentBuilder()
    .setTitle('ShopControl API')
    .setDescription(
      'API SaaS multi-boutiques ShopControl (Control Plane DB + Base de données PostgreSQL dédiée par boutique).',
    )
    .setVersion('1.0.0-lot1')
    .addBearerAuth()
    .build();

  const document = SwaggerModule.createDocument(app, swaggerConfig);
  SwaggerModule.setup('api/docs', app, document);

  await app.listen(env.API_PORT, '0.0.0.0');
  Logger.log(`ShopControl API démarrée sur http://0.0.0.0:${env.API_PORT}/api/v1`);
  Logger.log(`Documentation Swagger : http://localhost:${env.API_PORT}/api/docs`);
}

void bootstrap();
