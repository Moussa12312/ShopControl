import { Controller, Get, Module } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { Public } from '../../common/auth/auth.decorators';
import { ControlPrismaService } from '../../common/database/control-prisma.service';
import { RedisService } from '../../common/redis/redis.module';

@ApiTags('Santé')
@Controller('health')
export class HealthController {
  constructor(
    private readonly controlPrisma: ControlPrismaService,
    private readonly redis: RedisService,
  ) {}

  @Get()
  @Public()
  @ApiOperation({ summary: 'Vérifier la disponibilité de l’API, PostgreSQL et Redis' })
  async check() {
    let db = 'ok';
    let redis = 'ok';
    try {
      await this.controlPrisma.$queryRaw`SELECT 1`;
    } catch {
      db = 'error';
    }
    try {
      await this.redis.ping();
    } catch {
      redis = 'error';
    }

    return {
      status: db === 'ok' && redis === 'ok' ? 'ok' : 'degraded',
      services: { db, redis },
      timestamp: new Date().toISOString(),
    };
  }
}

@Module({
  controllers: [HealthController],
})
export class HealthModule {}
