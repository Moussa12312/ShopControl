import 'reflect-metadata';
import { Logger } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import { json, urlencoded } from 'express';
import cookieParser from 'cookie-parser';
import helmet from 'helmet';
import compression from 'compression';
import { getEnv } from './common/config/env.config';
import { GlobalHttpExceptionFilter } from './common/filters/http-exception.filter';
import { AppModule } from './app.module';

async function bootstrap(): Promise<void> {
  const env = getEnv();
  const app = await NestFactory.create(AppModule);

  // Arrêt gracieux (SIGTERM/SIGINT) pour purger les pools PostgreSQL sans couper de requêtes
  app.enableShutdownHooks();

  // Trust proxy derrière Nginx / Caddy / Cloudflare / Traefik pour extraire la véritable IP client
  const expressApp = app.getHttpAdapter().getInstance();
  expressApp.set('trust proxy', 1);

  // Compression gzip / deflate pour optimiser les performances réseau
  app.use(compression());

  app.use(json({ limit: '8mb' }));
  app.use(urlencoded({ extended: true, limit: '8mb' }));
  app.use(helmet({ crossOriginResourcePolicy: { policy: 'cross-origin' } }));
  app.use(cookieParser());

  const allowedOrigins = env.CORS_ORIGINS.split(',')
    .map((o) => o.trim())
    .filter(Boolean);

  app.enableCors({
    origin: (
      origin: string | undefined,
      callback: (err: Error | null, allow?: boolean) => void,
    ) => {
      // Autorise les requêtes sans origine (curl, outils mobiles, même domaine)
      if (!origin) return callback(null, true);
      // En production, vérifie strictement les domaines autorisés
      if (allowedOrigins.includes(origin) || (env.NODE_ENV !== 'production' && origin.startsWith('http://localhost:'))) {
        return callback(null, true);
      }
      return callback(new Error('Origine non autorisée par la politique CORS ShopControl.'), false);
    },
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

  // Swagger activé en développement ou si explicitement requis
  if (env.NODE_ENV !== 'production' || env.ENABLE_SWAGGER) {
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
    Logger.log(`Documentation Swagger disponible sur http://localhost:${env.API_PORT}/api/docs`);
  } else {
    Logger.log('Documentation Swagger désactivée en production.');
  }

  await app.listen(env.API_PORT, '0.0.0.0');
  Logger.log(`ShopControl API démarrée sur http://0.0.0.0:${env.API_PORT}/api/v1 [${env.NODE_ENV}]`);
}

void bootstrap();
