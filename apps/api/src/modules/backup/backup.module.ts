import { Controller, Injectable, Logger, Module, OnModuleDestroy, OnModuleInit, Get, Post, BadRequestException } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { execFile } from 'child_process';
import { gzipSync } from 'zlib';
import { promisify } from 'util';
import { Roles } from '../../common/auth/auth.decorators';
import { getEnv } from '../../common/config/env.config';
import { ControlPrismaService } from '../../common/database/control-prisma.service';

const execFileAsync = promisify(execFile);
const HOUR_MS = 3_600_000;
const BACKUP_HOUR_UTC = 2;

/**
 * Sauvegarde quotidienne (02h UTC) : pg_dump de la base de contrôle et de chaque base boutique,
 * compressé en gzip puis envoyé vers un canal Telegram privé (Bot API sendDocument).
 */
@Injectable()
export class BackupService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(BackupService.name);
  private timer: NodeJS.Timeout | null = null;
  private lastRunDay = '';
  lastResult: { at: string; ok: boolean; message: string } | null = null;

  constructor(private readonly controlPrisma: ControlPrismaService) {}

  onModuleInit(): void {
    const env = getEnv();
    if (env.NODE_ENV === 'test' || !env.BACKUP_ENABLED) return;
    this.timer = setInterval(() => void this.tick(), HOUR_MS / 4);
    this.timer.unref();
  }

  onModuleDestroy(): void {
    if (this.timer) clearInterval(this.timer);
  }

  isConfigured(): boolean {
    const env = getEnv();
    return Boolean(env.BACKUP_TELEGRAM_BOT_TOKEN && env.BACKUP_TELEGRAM_CHAT_ID);
  }

  private async tick(): Promise<void> {
    const now = new Date();
    const day = now.toISOString().slice(0, 10);
    if (now.getUTCHours() !== BACKUP_HOUR_UTC || this.lastRunDay === day) return;
    this.lastRunDay = day;
    await this.runBackup();
  }

  private async dump(dbName: string): Promise<Buffer> {
    const env = getEnv();
    const { stdout } = await execFileAsync(
      env.PG_DUMP_PATH,
      ['-h', env.POSTGRES_HOST, '-p', String(env.POSTGRES_PORT), '-U', env.POSTGRES_USER, '--no-owner', '-d', dbName],
      { env: { ...process.env, PGPASSWORD: env.POSTGRES_PASSWORD }, maxBuffer: 512 * 1024 * 1024, encoding: 'buffer' },
    );
    return gzipSync(stdout as unknown as Buffer);
  }

  private async sendToTelegram(fileName: string, data: Buffer, caption: string): Promise<void> {
    const env = getEnv();
    const form = new FormData();
    form.append('chat_id', env.BACKUP_TELEGRAM_CHAT_ID as string);
    form.append('caption', caption.slice(0, 1000));
    form.append('document', new Blob([new Uint8Array(data)]), fileName);
    const res = await fetch(`https://api.telegram.org/bot${env.BACKUP_TELEGRAM_BOT_TOKEN}/sendDocument`, {
      method: 'POST',
      body: form,
      signal: AbortSignal.timeout(120_000),
    });
    if (!res.ok) throw new Error(`Telegram a répondu ${res.status}`);
  }

  async runBackup(): Promise<{ ok: boolean; message: string }> {
    if (!this.isConfigured()) throw new BadRequestException('Telegram non configuré (BACKUP_TELEGRAM_BOT_TOKEN / CHAT_ID).');
    const env = getEnv();
    const stamp = new Date().toISOString().slice(0, 10);
    try {
      const shops = await this.controlPrisma.shop.findMany({
        where: { dbStatus: 'READY' },
        select: { dbName: true, name: true },
      });
      const targets = [{ db: env.POSTGRES_CONTROL_DB, label: 'control' }, ...shops.map((s) => ({ db: s.dbName, label: s.name }))];
      for (const t of targets) {
        const data = await this.dump(t.db);
        await this.sendToTelegram(`${t.db}-${stamp}.sql.gz`, data, `ShopControl • ${t.label} • ${stamp}`);
      }
      this.lastResult = { at: new Date().toISOString(), ok: true, message: `${targets.length} base(s) sauvegardée(s).` };
    } catch (err) {
      this.logger.error(`Sauvegarde en échec : ${(err as Error).message}`);
      this.lastResult = { at: new Date().toISOString(), ok: false, message: (err as Error).message };
    }
    return this.lastResult as { ok: boolean; message: string };
  }
}

@ApiTags('Sauvegarde')
@ApiBearerAuth()
@Controller('backup')
export class BackupController {
  constructor(private readonly backup: BackupService) {}

  @Get('status')
  @Roles('OWNER', 'SUPER_ADMIN')
  @ApiOperation({ summary: 'État de la sauvegarde automatique Telegram' })
  status() {
    const env = getEnv();
    return { enabled: env.BACKUP_ENABLED, configured: this.backup.isConfigured(), last: this.backup.lastResult };
  }

  @Post('run')
  @Roles('SUPER_ADMIN')
  @ApiOperation({ summary: 'Lancer une sauvegarde immédiate vers Telegram' })
  run() {
    return this.backup.runBackup();
  }
}

@Module({
  controllers: [BackupController],
  providers: [BackupService],
})
export class BackupModule {}
