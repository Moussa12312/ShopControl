import { Injectable, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { PrismaClient as ControlPrismaClient } from '../../generated/prisma-control';
import { getEnv } from '../config/env.config';

@Injectable()
export class ControlPrismaService
  extends ControlPrismaClient
  implements OnModuleInit, OnModuleDestroy
{
  constructor() {
    const env = getEnv();
    super({
      datasources: {
        db: {
          url: env.DATABASE_URL,
        },
      },
    });
  }

  async onModuleInit(): Promise<void> {
    await this.$connect();
  }

  async onModuleDestroy(): Promise<void> {
    await this.$disconnect();
  }
}
