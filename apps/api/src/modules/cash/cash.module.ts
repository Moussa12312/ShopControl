import {
  BadRequestException,
  Body,
  ConflictException,
  Controller,
  Get,
  Global,
  Injectable,
  Module,
  NotFoundException,
  Param,
  Post,
  Req,
  UseGuards,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import {
  CashMovementType,
  closeCashSessionSchema,
  createCashRegisterSchema,
  formatXof,
  handoverCashSessionSchema,
  manualCashMovementSchema,
  openCashSessionSchema,
  regularizeCashSessionSchema,
} from '@shopcontrol/shared';
import { Prisma as ShopPrisma } from '../../generated/prisma-shop';
import {
  CurrentOperator,
  CurrentUser,
  RequireOperator,
  RequirePermissions,
  Roles,
} from '../../common/auth/auth.decorators';
import {
  AuthenticatedUser,
  DeclaredOperatorContext,
  RequestWithAuth,
} from '../../common/auth/request-context.types';
import { ShopDatabaseManagerService } from '../../common/database/shop-database-manager.service';
import { OperatorGuard } from '../../common/guards/operator.guard';
import { PermissionsGuard } from '../../common/guards/permissions.guard';
import { ShopScopeGuard } from '../../common/guards/shop-scope.guard';
import { ZodValidationPipe } from '../../common/validation/zod-validation.pipe';
import { AuditService } from '../audit/audit.service';
import { NotificationsService } from '../notifications/notifications.module';
import { RequestMeta } from '../auth/auth.service';

const INFLOW_TYPES = new Set<CashMovementType>([
  'SALE_IN',
  'RECEIVABLE_IN',
  'MANUAL_IN',
  'REGULARIZATION_IN',
]);

@Injectable()
export class CashService {
  constructor(
    private readonly shopDbManager: ShopDatabaseManagerService,
    private readonly auditService: AuditService,
    private readonly notificationsService: NotificationsService,
  ) {}

  async ensureDefaultRegisterInTx(tx: ShopPrisma.TransactionClient) {
    const existing = await tx.cashRegister.findFirst({
      where: { isActive: true },
      orderBy: { createdAt: 'asc' },
    });
    if (existing) return existing;
    return tx.cashRegister.create({
      data: { name: 'Caisse Principale', isActive: true },
    });
  }

  /**
   * Récupère la session de caisse actuellement ouverte (obligatoire pour les opérations espèces).
   */
  async getOpenSessionInTx(tx: ShopPrisma.TransactionClient, registerId?: string) {
    return tx.cashSession.findFirst({
      where: {
        status: 'OPEN',
        ...(registerId ? { registerId } : {}),
      },
      orderBy: { openedAt: 'desc' },
    });
  }

  /**
   * Enregistre un mouvement de caisse dans une transaction et recalcule le solde théorique.
   */
  async recordMovementInTx(
    tx: ShopPrisma.TransactionClient,
    params: {
      sessionId: string;
      type: CashMovementType;
      amountXof: number;
      referenceType?: string | null;
      referenceId?: string | null;
      reason?: string | null;
      actorUserId?: string | null;
      declaredOperatorId?: string | null;
      declaredOperatorName?: string | null;
      allowOnClosedForRegularization?: boolean;
    },
  ) {
    const session = await tx.cashSession.findUnique({ where: { id: params.sessionId } });
    if (!session) {
      throw new NotFoundException({ code: 'CASH_SESSION_NOT_FOUND', message: 'Session de caisse introuvable.' });
    }
    if (session.status !== 'OPEN' && !params.allowOnClosedForRegularization) {
      throw new ConflictException({
        code: 'CASH_SESSION_CLOSED',
        message: 'Cette session de caisse est déjà clôturée et ne peut plus être modifiée.',
      });
    }

    const signedAmountXof =
      params.type === 'HANDOVER_COUNT'
        ? 0
        : INFLOW_TYPES.has(params.type)
          ? Math.abs(params.amountXof)
          : -Math.abs(params.amountXof);

    const movement = await tx.cashMovement.create({
      data: {
        sessionId: session.id,
        type: params.type,
        amountXof: Math.abs(params.amountXof),
        signedAmountXof,
        referenceType: params.referenceType ?? null,
        referenceId: params.referenceId ?? null,
        reason: params.reason ?? null,
        actorUserId: params.actorUserId ?? null,
        declaredOperatorId: params.declaredOperatorId ?? null,
        declaredOperatorName: params.declaredOperatorName ?? null,
      },
    });

    if (signedAmountXof !== 0) {
      const nextTheoretical = session.theoreticalAmountXof + signedAmountXof;
      await tx.cashSession.update({
        where: { id: session.id },
        data: {
          theoreticalAmountXof: nextTheoretical,
          ...(session.status === 'CLOSED' && session.countedAmountXof !== null
            ? { discrepancyXof: session.countedAmountXof - nextTheoretical }
            : {}),
        },
      });
    }

    return movement;
  }

  async listRegisters(shopId: string) {
    const client = await this.shopDbManager.getClientForShop(shopId);
    const regs = await client.cashRegister.findMany({ orderBy: { createdAt: 'asc' } });
    if (regs.length === 0) {
      const def = await client.cashRegister.create({ data: { name: 'Caisse Principale' } });
      return [def];
    }
    return regs;
  }

  async createRegister(shopId: string, name: string) {
    const client = await this.shopDbManager.getClientForShop(shopId);
    const dup = await client.cashRegister.findUnique({ where: { name } });
    if (dup) {
      throw new ConflictException({ code: 'REGISTER_EXISTS', message: 'Cette caisse existe déjà.' });
    }
    return client.cashRegister.create({ data: { name } });
  }

  private canReadTheoreticalCash(user?: AuthenticatedUser, shopId?: string): boolean {
    if (!user) return true;
    if (user.role === 'OWNER' || user.role === 'SUPER_ADMIN') return true;
    const access = user.shopAccesses.find((s) => s.shopId === shopId);
    return Boolean(access?.permissions['finance:read_margins']);
  }

  async getCurrentSession(shopId: string, user?: AuthenticatedUser) {
    const client = await this.shopDbManager.getClientForShop(shopId);
    const session = await client.cashSession.findFirst({
      where: { status: 'OPEN' },
      orderBy: { openedAt: 'desc' },
      include: {
        register: { select: { id: true, name: true } },
        movements: { orderBy: { createdAt: 'desc' }, take: 50 },
      },
    });
    if (!session) return null;

    const canSeeTheoretical = this.canReadTheoreticalCash(user, shopId);
    const hoursOpen = (Date.now() - session.openedAt.getTime()) / 3_600_000;
    return {
      ...session,
      openingAmountXof: canSeeTheoretical ? session.openingAmountXof : null,
      theoreticalAmountXof: canSeeTheoretical ? session.theoreticalAmountXof : null,
      openedAt: session.openedAt.toISOString(),
      closedAt: null,
      overdueAlert24h: hoursOpen > 24,
      movementsCount: session.movements.length,
      movements: canSeeTheoretical
        ? session.movements.map((m) => ({
            ...m,
            createdAt: m.createdAt.toISOString(),
          }))
        : [],
    };
  }

  async listSessions(shopId: string, user?: AuthenticatedUser) {
    const client = await this.shopDbManager.getClientForShop(shopId);
    const sessions = await client.cashSession.findMany({
      orderBy: { openedAt: 'desc' },
      take: 30,
      include: {
        register: { select: { id: true, name: true } },
        _count: { select: { movements: true, sales: true } },
      },
    });
    const canSeeTheoretical = this.canReadTheoreticalCash(user, shopId);
    return sessions.map((s) => ({
      id: s.id,
      registerId: s.registerId,
      registerName: s.register.name,
      status: s.status,
      openingAmountXof: canSeeTheoretical ? s.openingAmountXof : null,
      theoreticalAmountXof: canSeeTheoretical ? s.theoreticalAmountXof : null,
      countedAmountXof: s.countedAmountXof,
      discrepancyXof: canSeeTheoretical ? s.discrepancyXof : null,
      openedByOperatorName: s.openedByOperatorName,
      closedByOperatorName: s.closedByOperatorName,
      movementsCount: s._count.movements,
      salesCount: s._count.sales,
      openedAt: s.openedAt.toISOString(),
      closedAt: s.closedAt?.toISOString() ?? null,
    }));
  }

  async openSession(
    shopId: string,
    input: { registerId?: string; openingAmountXof: number; notes?: string },
    actor: AuthenticatedUser,
    operator: DeclaredOperatorContext | undefined,
    meta: RequestMeta,
  ) {
    const client = await this.shopDbManager.getClientForShop(shopId);

    const created = await client.$transaction(async (tx) => {
      const register = input.registerId
        ? await tx.cashRegister.findUnique({ where: { id: input.registerId } })
        : await this.ensureDefaultRegisterInTx(tx);

      if (!register) {
        throw new NotFoundException({ code: 'REGISTER_NOT_FOUND', message: 'Caisse introuvable.' });
      }

      const alreadyOpen = await tx.cashSession.findFirst({
        where: { registerId: register.id, status: 'OPEN' },
      });
      if (alreadyOpen) {
        throw new ConflictException({
          code: 'CASH_SESSION_ALREADY_OPEN',
          message: `Une session est déjà ouverte sur « ${register.name} ». Clôturez-la avant d’en ouvrir une nouvelle.`,
        });
      }

      return tx.cashSession.create({
        data: {
          registerId: register.id,
          status: 'OPEN',
          openingAmountXof: input.openingAmountXof,
          theoreticalAmountXof: input.openingAmountXof,
          openedByUserId: actor.userId,
          openedByOperatorId: operator?.id ?? null,
          openedByOperatorName: operator?.firstName ?? actor.fullName,
          openingNotes: input.notes || null,
        },
        include: { register: { select: { id: true, name: true } } },
      });
    });

    await this.auditService.recordShop({
      shopId,
      actorUserId: actor.userId,
      actorRole: actor.role,
      declaredOperatorId: operator?.id ?? null,
      declaredOperatorName: operator?.firstName ?? null,
      action: 'CASH_SESSION_OPENED',
      entityType: 'CashSession',
      entityId: created.id,
      afterData: {
        registerName: created.register.name,
        openingAmountXof: created.openingAmountXof,
      },
      ipAddress: meta.ipAddress,
      userAgent: meta.userAgent,
      correlationId: meta.correlationId,
    });

    return created;
  }

  async addManualMovement(
    shopId: string,
    sessionId: string,
    input: { type: 'MANUAL_IN' | 'MANUAL_OUT'; amountXof: number; reason: string },
    actor: AuthenticatedUser,
    operator: DeclaredOperatorContext | undefined,
    meta: RequestMeta,
  ) {
    const client = await this.shopDbManager.getClientForShop(shopId);
    const movement = await client.$transaction((tx) =>
      this.recordMovementInTx(tx, {
        sessionId,
        type: input.type,
        amountXof: input.amountXof,
        referenceType: 'MANUAL',
        reason: input.reason,
        actorUserId: actor.userId,
        declaredOperatorId: operator?.id ?? null,
        declaredOperatorName: operator?.firstName ?? null,
      }),
    );

    await this.auditService.recordShop({
      shopId,
      actorUserId: actor.userId,
      actorRole: actor.role,
      declaredOperatorId: operator?.id ?? null,
      declaredOperatorName: operator?.firstName ?? null,
      action: 'CASH_MANUAL_MOVEMENT',
      entityType: 'CashMovement',
      entityId: movement.id,
      afterData: { type: input.type, amountXof: input.amountXof },
      reason: input.reason,
      ipAddress: meta.ipAddress,
      userAgent: meta.userAgent,
      correlationId: meta.correlationId,
    });

    return movement;
  }

  async recordHandover(
    shopId: string,
    sessionId: string,
    input: { countedAmountXof: number; notes?: string },
    actor: AuthenticatedUser,
    operator: DeclaredOperatorContext | undefined,
    meta: RequestMeta,
  ) {
    const client = await this.shopDbManager.getClientForShop(shopId);
    const result = await client.$transaction(async (tx) => {
      const session = await tx.cashSession.findUnique({ where: { id: sessionId } });
      if (!session || session.status !== 'OPEN') {
        throw new BadRequestException({
          code: 'CASH_SESSION_NOT_OPEN',
          message: 'Passation impossible : la session n’est pas ouverte.',
        });
      }
      const discrepancy = input.countedAmountXof - session.theoreticalAmountXof;
      const mv = await this.recordMovementInTx(tx, {
        sessionId,
        type: 'HANDOVER_COUNT',
        amountXof: input.countedAmountXof,
        referenceType: 'HANDOVER',
        reason: `Passation intermédiaire (théorique: ${session.theoreticalAmountXof}, compté: ${input.countedAmountXof}, écart: ${discrepancy})${input.notes ? ` — ${input.notes}` : ''}`,
        actorUserId: actor.userId,
        declaredOperatorId: operator?.id ?? null,
        declaredOperatorName: operator?.firstName ?? null,
      });
      return { movement: mv, theoreticalAmountXof: session.theoreticalAmountXof, discrepancyXof: discrepancy };
    });

    await this.auditService.recordShop({
      shopId,
      actorUserId: actor.userId,
      actorRole: actor.role,
      declaredOperatorId: operator?.id ?? null,
      declaredOperatorName: operator?.firstName ?? null,
      action: 'CASH_HANDOVER_COUNT',
      entityType: 'CashSession',
      entityId: sessionId,
      afterData: {
        countedAmountXof: input.countedAmountXof,
        theoreticalAmountXof: result.theoreticalAmountXof,
        discrepancyXof: result.discrepancyXof,
      },
      ipAddress: meta.ipAddress,
      userAgent: meta.userAgent,
      correlationId: meta.correlationId,
    });

    return result;
  }

  /**
   * Clôture définitive et immuable d'une session de caisse (Critère #21).
   * Calcule l'écart et notifie immédiatement le Propriétaire en cas d'écart.
   */
  async closeSession(
    shopId: string,
    sessionId: string,
    input: { countedAmountXof: number; notes?: string },
    actor: AuthenticatedUser,
    operator: DeclaredOperatorContext | undefined,
    meta: RequestMeta,
  ) {
    const client = await this.shopDbManager.getClientForShop(shopId);

    const closed = await client.$transaction(async (tx) => {
      const session = await tx.cashSession.findUnique({ where: { id: sessionId } });
      if (!session) {
        throw new NotFoundException({ code: 'CASH_SESSION_NOT_FOUND', message: 'Session introuvable.' });
      }
      if (session.status === 'CLOSED') {
        throw new ConflictException({
          code: 'CASH_SESSION_ALREADY_CLOSED',
          message: 'Cette session de caisse est déjà clôturée et ne peut plus être modifiée.',
        });
      }

      const discrepancyXof = input.countedAmountXof - session.theoreticalAmountXof;
      return tx.cashSession.update({
        where: { id: sessionId },
        data: {
          status: 'CLOSED',
          countedAmountXof: input.countedAmountXof,
          discrepancyXof,
          closedByUserId: actor.userId,
          closedByOperatorId: operator?.id ?? null,
          closedByOperatorName: operator?.firstName ?? actor.fullName,
          closingNotes: input.notes || null,
          closedAt: new Date(),
        },
      });
    });

    await this.auditService.recordShop({
      shopId,
      actorUserId: actor.userId,
      actorRole: actor.role,
      declaredOperatorId: operator?.id ?? null,
      declaredOperatorName: operator?.firstName ?? null,
      action: 'CASH_SESSION_CLOSED',
      entityType: 'CashSession',
      entityId: closed.id,
      afterData: {
        theoreticalAmountXof: closed.theoreticalAmountXof,
        countedAmountXof: closed.countedAmountXof,
        discrepancyXof: closed.discrepancyXof,
      },
      reason: input.notes ?? null,
      ipAddress: meta.ipAddress,
      userAgent: meta.userAgent,
      correlationId: meta.correlationId,
    });

    // Critère #21 : notification obligatoire et non désactivable au Propriétaire en cas d'écart
    if (actor.merchantId && closed.discrepancyXof !== null && closed.discrepancyXof !== 0) {
      await this.notificationsService.notifyMerchantOwners(actor.merchantId, {
        shopId,
        type: 'CASH_FINANCE',
        priority: 'URGENT',
        title: `Écart de caisse détecté (${formatXof(closed.discrepancyXof)})`,
        message: `Clôture enregistrée par ${closed.closedByOperatorName || actor.fullName} : solde théorique ${formatXof(closed.theoreticalAmountXof)}, compté ${formatXof(closed.countedAmountXof ?? 0)}, écart ${formatXof(closed.discrepancyXof)}.`,
        targetPath: '/commerce/cash',
      });
    }

    const canSeeTheoretical = this.canReadTheoreticalCash(actor, shopId);
    return {
      ...closed,
      theoreticalAmountXof: canSeeTheoretical ? closed.theoreticalAmountXof : null,
      discrepancyXof: canSeeTheoretical ? closed.discrepancyXof : null,
    };
  }

  /**
   * Régularisation motivée d'une clôture passée (seule correction autorisée après clôture, Critère #21).
   */
  async regularizeClosedSession(
    shopId: string,
    sessionId: string,
    input: { type: 'REGULARIZATION_IN' | 'REGULARIZATION_OUT'; amountXof: number; reason: string },
    actor: AuthenticatedUser,
    operator: DeclaredOperatorContext | undefined,
    meta: RequestMeta,
  ) {
    const client = await this.shopDbManager.getClientForShop(shopId);

    const movement = await client.$transaction(async (tx) => {
      const session = await tx.cashSession.findUnique({ where: { id: sessionId } });
      if (!session) {
        throw new NotFoundException({ code: 'CASH_SESSION_NOT_FOUND', message: 'Session introuvable.' });
      }
      if (session.status !== 'CLOSED') {
        throw new BadRequestException({
          code: 'CASH_SESSION_STILL_OPEN',
          message: 'La régularisation s’applique uniquement à une session déjà clôturée.',
        });
      }
      return this.recordMovementInTx(tx, {
        sessionId,
        type: input.type,
        amountXof: input.amountXof,
        referenceType: 'REGULARIZATION',
        reason: input.reason,
        actorUserId: actor.userId,
        declaredOperatorId: operator?.id ?? null,
        declaredOperatorName: operator?.firstName ?? null,
        allowOnClosedForRegularization: true,
      });
    });

    await this.auditService.recordShop({
      shopId,
      actorUserId: actor.userId,
      actorRole: actor.role,
      declaredOperatorId: operator?.id ?? null,
      declaredOperatorName: operator?.firstName ?? null,
      action: 'CASH_SESSION_REGULARIZED',
      entityType: 'CashSession',
      entityId: sessionId,
      afterData: { type: input.type, amountXof: input.amountXof },
      reason: input.reason,
      ipAddress: meta.ipAddress,
      userAgent: meta.userAgent,
      correlationId: meta.correlationId,
    });

    return movement;
  }
}

@ApiTags('Caisse & Sessions')
@ApiBearerAuth()
@Controller('shops/:shopId/cash')
@UseGuards(ShopScopeGuard, PermissionsGuard, OperatorGuard)
export class CashController {
  constructor(private readonly cashService: CashService) {}

  @Get('registers')
  @Roles('OWNER', 'AGENT')
  @RequirePermissions('cash:read')
  @ApiOperation({ summary: 'Lister les caisses configurées de la boutique' })
  listRegisters(@Param('shopId') shopId: string) {
    return this.cashService.listRegisters(shopId);
  }

  @Post('registers')
  @Roles('OWNER')
  @ApiOperation({ summary: 'Ajouter une caisse supplémentaire dans la boutique' })
  createRegister(
    @Param('shopId') shopId: string,
    @Body(new ZodValidationPipe(createCashRegisterSchema)) body: { name: string },
  ) {
    return this.cashService.createRegister(shopId, body.name);
  }

  @Get('sessions/current')
  @Roles('OWNER', 'AGENT')
  @RequirePermissions('cash:read')
  @ApiOperation({ summary: 'Consulter la session de caisse actuellement ouverte' })
  current(@Param('shopId') shopId: string, @CurrentUser() user: AuthenticatedUser) {
    return this.cashService.getCurrentSession(shopId, user);
  }

  @Get('sessions')
  @Roles('OWNER', 'AGENT')
  @RequirePermissions('cash:read')
  @ApiOperation({ summary: 'Lister l’historique des sessions et clôtures de caisse' })
  listSessions(@Param('shopId') shopId: string, @CurrentUser() user: AuthenticatedUser) {
    return this.cashService.listSessions(shopId, user);
  }

  @Post('sessions/open')
  @Roles('OWNER', 'AGENT')
  @RequirePermissions('cash:open')
  @RequireOperator()
  @ApiOperation({ summary: 'Ouvrir une session de caisse (une seule ouverte par caisse à la fois)' })
  open(
    @Param('shopId') shopId: string,
    @Body(new ZodValidationPipe(openCashSessionSchema)) body: any,
    @CurrentUser() user: AuthenticatedUser,
    @CurrentOperator() operator: DeclaredOperatorContext | undefined,
    @Req() req: RequestWithAuth,
  ) {
    return this.cashService.openSession(shopId, body, user, operator, {
      ipAddress: req.ip || null,
      userAgent: req.header('user-agent') || null,
      correlationId: req.correlationId || null,
    });
  }

  @Post('sessions/:sessionId/movements')
  @Roles('OWNER', 'AGENT')
  @RequirePermissions('cash:out')
  @RequireOperator(true)
  @ApiOperation({ summary: 'Enregistrer un encaissement ou décaissement manuel motivé' })
  manualMovement(
    @Param('shopId') shopId: string,
    @Param('sessionId') sessionId: string,
    @Body(new ZodValidationPipe(manualCashMovementSchema)) body: any,
    @CurrentUser() user: AuthenticatedUser,
    @CurrentOperator() operator: DeclaredOperatorContext | undefined,
    @Req() req: RequestWithAuth,
  ) {
    return this.cashService.addManualMovement(shopId, sessionId, body, user, operator, {
      ipAddress: req.ip || null,
      userAgent: req.header('user-agent') || null,
      correlationId: req.correlationId || null,
    });
  }

  @Post('sessions/:sessionId/handover')
  @Roles('OWNER', 'AGENT')
  @RequirePermissions('cash:read')
  @RequireOperator()
  @ApiOperation({ summary: 'Enregistrer une passation d’équipe avec comptage intermédiaire' })
  handover(
    @Param('shopId') shopId: string,
    @Param('sessionId') sessionId: string,
    @Body(new ZodValidationPipe(handoverCashSessionSchema)) body: any,
    @CurrentUser() user: AuthenticatedUser,
    @CurrentOperator() operator: DeclaredOperatorContext | undefined,
    @Req() req: RequestWithAuth,
  ) {
    return this.cashService.recordHandover(shopId, sessionId, body, user, operator, {
      ipAddress: req.ip || null,
      userAgent: req.header('user-agent') || null,
      correlationId: req.correlationId || null,
    });
  }

  @Post('sessions/:sessionId/close')
  @Roles('OWNER', 'AGENT')
  @RequirePermissions('cash:close')
  @RequireOperator(true)
  @ApiOperation({ summary: 'Clôturer définitivement la caisse (calcule l’écart et notifie le Propriétaire)' })
  close(
    @Param('shopId') shopId: string,
    @Param('sessionId') sessionId: string,
    @Body(new ZodValidationPipe(closeCashSessionSchema)) body: any,
    @CurrentUser() user: AuthenticatedUser,
    @CurrentOperator() operator: DeclaredOperatorContext | undefined,
    @Req() req: RequestWithAuth,
  ) {
    return this.cashService.closeSession(shopId, sessionId, body, user, operator, {
      ipAddress: req.ip || null,
      userAgent: req.header('user-agent') || null,
      correlationId: req.correlationId || null,
    });
  }

  @Post('sessions/:sessionId/regularize')
  @Roles('OWNER')
  @RequirePermissions('cash:close')
  @RequireOperator(true)
  @ApiOperation({ summary: 'Régulariser une erreur sur une session clôturée par mouvement motivé' })
  regularize(
    @Param('shopId') shopId: string,
    @Param('sessionId') sessionId: string,
    @Body(new ZodValidationPipe(regularizeCashSessionSchema)) body: any,
    @CurrentUser() user: AuthenticatedUser,
    @CurrentOperator() operator: DeclaredOperatorContext | undefined,
    @Req() req: RequestWithAuth,
  ) {
    return this.cashService.regularizeClosedSession(shopId, sessionId, body, user, operator, {
      ipAddress: req.ip || null,
      userAgent: req.header('user-agent') || null,
      correlationId: req.correlationId || null,
    });
  }
}

@Global()
@Module({
  controllers: [CashController],
  providers: [CashService],
  exports: [CashService],
})
export class CashModule {}
