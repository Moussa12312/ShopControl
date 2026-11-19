import {
  Body,
  Controller,
  Get,
  Injectable,
  Module,
  Param,
  Post,
  Req,
  UseGuards,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { registerTerminalSchema } from '@shopcontrol/shared';
import {
  CurrentOperator,
  CurrentUser,
  RequireOperator,
  Roles,
} from '../../common/auth/auth.decorators';
import {
  AuthenticatedUser,
  DeclaredOperatorContext,
  RequestWithAuth,
} from '../../common/auth/request-context.types';
import { ShopDatabaseManagerService } from '../../common/database/shop-database-manager.service';
import { OperatorGuard } from '../../common/guards/operator.guard';
import { ShopScopeGuard } from '../../common/guards/shop-scope.guard';
import { ZodValidationPipe } from '../../common/validation/zod-validation.pipe';
import { AuditService } from '../audit/audit.service';
import { RequestMeta } from '../auth/auth.service';

const DEFAULT_RANGE_SIZE = 200;

/**
 * Socle Option B (Mode dégradé comptoir, Section 14.3 & 10.1) :
 * Enregistre chaque terminal dans la base dédiée de la boutique et lui réserve des
 * plages séquentielles disjointes pour la numérotation hors-ligne des tickets.
 */
@Injectable()
export class TerminalsService {
  constructor(
    private readonly shopDbManager: ShopDatabaseManagerService,
    private readonly auditService: AuditService,
  ) {}

  async list(shopId: string) {
    const client = await this.shopDbManager.getClientForShop(shopId);
    const terminals = await client.terminal.findMany({
      orderBy: { createdAt: 'asc' },
      include: {
        receiptRanges: {
          orderBy: { rangeStart: 'desc' },
          take: 3,
        },
      },
    });

    return terminals.map((t) => ({
      id: t.id,
      deviceUid: t.deviceUid,
      label: t.label,
      prefix: t.prefix,
      isActive: t.isActive,
      lastSyncAt: t.lastSyncAt?.toISOString() ?? null,
      createdAt: t.createdAt.toISOString(),
      receiptRanges: t.receiptRanges.map((r) => ({
        id: r.id,
        seriesCode: r.seriesCode,
        rangeStart: r.rangeStart,
        rangeEnd: r.rangeEnd,
        currentNumber: r.currentNumber,
        remaining: Math.max(0, r.rangeEnd - r.currentNumber),
        exhaustedAt: r.exhaustedAt?.toISOString() ?? null,
      })),
    }));
  }

  async registerOrRefresh(
    shopId: string,
    input: { deviceUid: string; label: string },
    actor: AuthenticatedUser,
    operator: DeclaredOperatorContext | undefined,
    meta: RequestMeta,
  ) {
    const client = await this.shopDbManager.getClientForShop(shopId);

    const result = await client.$transaction(async (tx) => {
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(7049003)`;

      let terminal = await tx.terminal.findUnique({
        where: { deviceUid: input.deviceUid },
        include: {
          receiptRanges: {
            where: { exhaustedAt: null },
            orderBy: { rangeStart: 'desc' },
          },
        },
      });

      let isNew = false;
      if (!terminal) {
        const count = await tx.terminal.count();
        const prefix = `T${String(count + 1).padStart(2, '0')}`;
        terminal = await tx.terminal.create({
          data: {
            deviceUid: input.deviceUid,
            label: input.label,
            prefix,
            isActive: true,
            lastSyncAt: new Date(),
          },
          include: { receiptRanges: true },
        });
        isNew = true;
      } else {
        terminal = await tx.terminal.update({
          where: { id: terminal.id },
          data: {
            label: input.label,
            lastSyncAt: new Date(),
          },
          include: {
            receiptRanges: {
              where: { exhaustedAt: null },
              orderBy: { rangeStart: 'desc' },
            },
          },
        });
      }

      let allocatedRange = terminal.receiptRanges[0] ?? null;
      let rangeNewlyAllocated = false;

      if (!allocatedRange) {
        const maxRange = await tx.receiptNumberRange.findFirst({
          where: { seriesCode: 'VTE' },
          orderBy: { rangeEnd: 'desc' },
        });
        const rangeStart = (maxRange?.rangeEnd ?? 0) + 1;
        const rangeEnd = rangeStart + DEFAULT_RANGE_SIZE - 1;
        allocatedRange = await tx.receiptNumberRange.create({
          data: {
            terminalId: terminal.id,
            seriesCode: 'VTE',
            rangeStart,
            rangeEnd,
            currentNumber: rangeStart - 1,
          },
        });
        rangeNewlyAllocated = true;
      }

      return { terminal, allocatedRange, isNew, rangeNewlyAllocated };
    });

    if (result.isNew) {
      await this.auditService.recordShop({
        shopId,
        actorUserId: actor.userId,
        actorRole: actor.role,
        declaredOperatorId: operator?.id ?? null,
        declaredOperatorName: operator?.firstName ?? null,
        action: 'TERMINAL_REGISTERED',
        entityType: 'Terminal',
        entityId: result.terminal.id,
        afterData: {
          label: result.terminal.label,
          prefix: result.terminal.prefix,
          rangeStart: result.allocatedRange.rangeStart,
          rangeEnd: result.allocatedRange.rangeEnd,
        },
        ipAddress: meta.ipAddress,
        userAgent: meta.userAgent,
        correlationId: meta.correlationId,
      });
    }

    return {
      terminal: {
        id: result.terminal.id,
        deviceUid: result.terminal.deviceUid,
        label: result.terminal.label,
        prefix: result.terminal.prefix,
        lastSyncAt: result.terminal.lastSyncAt?.toISOString() ?? null,
      },
      activeReceiptRange: {
        id: result.allocatedRange.id,
        seriesCode: result.allocatedRange.seriesCode,
        rangeStart: result.allocatedRange.rangeStart,
        rangeEnd: result.allocatedRange.rangeEnd,
        currentNumber: result.allocatedRange.currentNumber,
      },
    };
  }
}

@ApiTags('Terminaux Comptoir (Option B)')
@ApiBearerAuth()
@Controller('shops/:shopId/terminals')
@UseGuards(ShopScopeGuard, OperatorGuard)
export class TerminalsController {
  constructor(private readonly terminalsService: TerminalsService) {}

  @Get()
  @Roles('OWNER', 'AGENT')
  @ApiOperation({ summary: 'Lister les terminaux enregistrés et leurs plages de tickets réservées' })
  list(@Param('shopId') shopId: string) {
    return this.terminalsService.list(shopId);
  }

  @Post('register')
  @Roles('OWNER', 'AGENT')
  @RequireOperator(true)
  @ApiOperation({ summary: 'Enregistrer un terminal comptoir et réserver une plage de numérotation hors-ligne' })
  register(
    @Param('shopId') shopId: string,
    @Body(new ZodValidationPipe(registerTerminalSchema))
    body: { deviceUid: string; label: string },
    @CurrentUser() user: AuthenticatedUser,
    @CurrentOperator() operator: DeclaredOperatorContext | undefined,
    @Req() req: RequestWithAuth,
  ) {
    return this.terminalsService.registerOrRefresh(shopId, body, user, operator, {
      ipAddress: req.ip || null,
      userAgent: req.header('user-agent') || null,
      correlationId: req.correlationId || null,
    });
  }
}

@Module({
  controllers: [TerminalsController],
  providers: [TerminalsService],
  exports: [TerminalsService],
})
export class TerminalsModule {}
