import {
  BadRequestException,
  Body,
  ConflictException,
  Controller,
  Get,
  Injectable,
  Module,
  NotFoundException,
  Param,
  Patch,
  Post,
  Query,
  Req,
  UseGuards,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import {
  createClientSchema,
  DEFAULT_PAYMENT_METHODS,
  PaymentMethodConfig,
  receivablePaymentSchema,
  updateClientSchema,
} from '@shopcontrol/shared';
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
import { ControlPrismaService } from '../../common/database/control-prisma.service';
import { ShopDatabaseManagerService } from '../../common/database/shop-database-manager.service';
import { OperatorGuard } from '../../common/guards/operator.guard';
import { PermissionsGuard } from '../../common/guards/permissions.guard';
import { ShopScopeGuard } from '../../common/guards/shop-scope.guard';
import { ZodValidationPipe } from '../../common/validation/zod-validation.pipe';
import { AuditService } from '../audit/audit.service';
import { CashService } from '../cash/cash.module';
import { RequestMeta } from '../auth/auth.service';

@Injectable()
export class ClientsService {
  constructor(
    private readonly controlPrisma: ControlPrismaService,
    private readonly shopDbManager: ShopDatabaseManagerService,
    private readonly cashService: CashService,
    private readonly auditService: AuditService,
  ) {}

  async listClients(shopId: string, search?: string) {
    const client = await this.shopDbManager.getClientForShop(shopId);
    const where: Record<string, unknown> = {};
    if (search?.trim()) {
      const q = search.trim();
      where.OR = [
        { fullName: { contains: q, mode: 'insensitive' } },
        { phone: { contains: q, mode: 'insensitive' } },
      ];
    }

    const clients = await client.client.findMany({
      where,
      orderBy: { fullName: 'asc' },
      include: {
        receivables: {
          where: { status: { in: ['OPEN', 'PARTIALLY_PAID'] } },
          select: { remainingAmountXof: true },
        },
        _count: { select: { sales: true } },
      },
    });

    return clients.map((c) => ({
      id: c.id,
      fullName: c.fullName,
      phone: c.phone,
      email: c.email,
      address: c.address,
      creditLimitXof: c.creditLimitXof,
      notes: c.notes,
      isBlocked: c.isBlocked,
      salesCount: c._count.sales,
      outstandingDebtXof: c.receivables.reduce((acc, r) => acc + r.remainingAmountXof, 0),
      createdAt: c.createdAt.toISOString(),
    }));
  }

  async createClient(shopId: string, input: any) {
    const client = await this.shopDbManager.getClientForShop(shopId);
    const dup = await client.client.findUnique({ where: { phone: input.phone } });
    if (dup) {
      throw new ConflictException({
        code: 'CLIENT_PHONE_EXISTS',
        message: `Un client utilise déjà le numéro ${input.phone}.`,
      });
    }
    return client.client.create({
      data: {
        fullName: input.fullName,
        phone: input.phone,
        email: input.email || null,
        address: input.address || null,
        creditLimitXof: input.creditLimitXof ?? 0,
        notes: input.notes || null,
      },
    });
  }

  async updateClient(shopId: string, clientId: string, input: any) {
    const client = await this.shopDbManager.getClientForShop(shopId);
    const existing = await client.client.findUnique({ where: { id: clientId } });
    if (!existing) {
      throw new NotFoundException({ code: 'CLIENT_NOT_FOUND', message: 'Client introuvable.' });
    }
    if (input.phone && input.phone !== existing.phone) {
      const dup = await client.client.findUnique({ where: { phone: input.phone } });
      if (dup) {
        throw new ConflictException({
          code: 'CLIENT_PHONE_EXISTS',
          message: `Le numéro ${input.phone} est déjà attribué à un autre client.`,
        });
      }
    }
    return client.client.update({
      where: { id: clientId },
      data: {
        ...(input.fullName !== undefined ? { fullName: input.fullName } : {}),
        ...(input.phone !== undefined ? { phone: input.phone } : {}),
        ...(input.email !== undefined ? { email: input.email || null } : {}),
        ...(input.address !== undefined ? { address: input.address || null } : {}),
        ...(input.creditLimitXof !== undefined ? { creditLimitXof: input.creditLimitXof } : {}),
        ...(input.notes !== undefined ? { notes: input.notes || null } : {}),
        ...(input.isBlocked !== undefined ? { isBlocked: input.isBlocked } : {}),
      },
    });
  }

  async listReceivables(shopId: string, status?: string) {
    const client = await this.shopDbManager.getClientForShop(shopId);
    const rows = await client.receivable.findMany({
      where: status ? { status } : { status: { in: ['OPEN', 'PARTIALLY_PAID'] } },
      orderBy: { createdAt: 'asc' },
      include: {
        client: { select: { id: true, fullName: true, phone: true, creditLimitXof: true } },
        sale: { select: { id: true, saleNumber: true, totalXof: true, createdAt: true } },
        payments: { orderBy: { createdAt: 'desc' } },
      },
    });

    const now = Date.now();
    return rows.map((r) => ({
      id: r.id,
      status: r.status,
      initialAmountXof: r.initialAmountXof,
      paidAmountXof: r.paidAmountXof,
      remainingAmountXof: r.remainingAmountXof,
      ageDays: Math.floor((now - r.createdAt.getTime()) / 86_400_000),
      client: r.client,
      sale: {
        id: r.sale.id,
        saleNumber: r.sale.saleNumber,
        totalXof: r.sale.totalXof,
        createdAt: r.sale.createdAt.toISOString(),
      },
      payments: r.payments.map((p) => ({
        id: p.id,
        amountXof: p.amountXof,
        paymentMethodCode: p.paymentMethodCode,
        transactionRef: p.transactionRef,
        declaredOperatorName: p.declaredOperatorName,
        createdAt: p.createdAt.toISOString(),
      })),
      createdAt: r.createdAt.toISOString(),
    }));
  }

  /**
   * Encaissement partiel ou total d'une créance client (Section 5.7).
   */
  async recordReceivablePayment(
    shopId: string,
    receivableId: string,
    input: { amountXof: number; paymentMethodCode: string; transactionRef?: string; notes?: string },
    actor: AuthenticatedUser,
    operator: DeclaredOperatorContext | undefined,
    meta: RequestMeta,
  ) {
    const shop = await this.controlPrisma.shop.findUniqueOrThrow({ where: { id: shopId } });
    const paymentMethods = (
      Array.isArray(shop.paymentMethods) ? shop.paymentMethods : DEFAULT_PAYMENT_METHODS
    ) as PaymentMethodConfig[];
    const methodCfg = paymentMethods.find((m) => m.code === input.paymentMethodCode && m.enabled);
    if (!methodCfg) {
      throw new BadRequestException({
        code: 'PAYMENT_METHOD_INVALID',
        message: `Moyen de paiement non activé : ${input.paymentMethodCode}.`,
      });
    }

    const ref = input.transactionRef?.trim() || null;
    if (methodCfg.requireReference && !ref) {
      throw new BadRequestException({
        code: 'PAYMENT_REFERENCE_REQUIRED',
        message: `La référence de transaction est obligatoire pour ${methodCfg.label}.`,
      });
    }

    const shopClient = await this.shopDbManager.getClientForShop(shopId);

    const payment = await shopClient.$transaction(async (tx) => {
      const rec = await tx.receivable.findUnique({
        where: { id: receivableId },
        include: { sale: true },
      });
      if (!rec) {
        throw new NotFoundException({ code: 'RECEIVABLE_NOT_FOUND', message: 'Créance introuvable.' });
      }
      if (rec.status === 'PAID' || rec.status === 'CANCELLED') {
        throw new ConflictException({
          code: 'RECEIVABLE_CLOSED',
          message: 'Cette créance est déjà soldée ou annulée.',
        });
      }
      if (input.amountXof > rec.remainingAmountXof) {
        throw new BadRequestException({
          code: 'PAYMENT_EXCEEDS_RECEIVABLE',
          message: `Le montant (${input.amountXof} XOF) dépasse le solde dû (${rec.remainingAmountXof} XOF).`,
        });
      }

      if (ref) {
        const [dupSalePay, dupRecPay] = await Promise.all([
          tx.salePayment.findFirst({
            where: { paymentMethodCode: input.paymentMethodCode, transactionRef: ref },
          }),
          tx.receivablePayment.findFirst({
            where: { paymentMethodCode: input.paymentMethodCode, transactionRef: ref },
          }),
        ]);
        if (dupSalePay || dupRecPay) {
          throw new ConflictException({
            code: 'DUPLICATE_PAYMENT_REFERENCE',
            message: `La référence « ${ref} » a déjà été utilisée pour ${methodCfg.label} dans cette boutique.`,
          });
        }
      }

      let cashMovementId: string | null = null;
      if (methodCfg.affectsCashDrawer) {
        const openSession = await this.cashService.getOpenSessionInTx(tx);
        if (!openSession) {
          throw new BadRequestException({
            code: 'CASH_SESSION_REQUIRED',
            message: 'Ouvrez une session de caisse avant d’encaisser un règlement en espèces.',
          });
        }
        const mv = await this.cashService.recordMovementInTx(tx, {
          sessionId: openSession.id,
          type: 'RECEIVABLE_IN',
          amountXof: input.amountXof,
          referenceType: 'RECEIVABLE',
          referenceId: rec.sale.saleNumber,
          reason: `Règlement créance sur vente ${rec.sale.saleNumber}`,
          actorUserId: actor.userId,
          declaredOperatorId: operator?.id ?? null,
          declaredOperatorName: operator?.firstName ?? null,
        });
        cashMovementId = mv.id;
      }

      const created = await tx.receivablePayment.create({
        data: {
          receivableId: rec.id,
          amountXof: input.amountXof,
          paymentMethodCode: input.paymentMethodCode,
          transactionRef: ref,
          cashMovementId,
          notes: input.notes || null,
          actorUserId: actor.userId,
          declaredOperatorId: operator?.id ?? null,
          declaredOperatorName: operator?.firstName ?? null,
        },
      });

      const nextPaid = rec.paidAmountXof + input.amountXof;
      const nextRemaining = rec.initialAmountXof - nextPaid;
      await tx.receivable.update({
        where: { id: rec.id },
        data: {
          paidAmountXof: nextPaid,
          remainingAmountXof: nextRemaining,
          status: nextRemaining === 0 ? 'PAID' : 'PARTIALLY_PAID',
        },
      });

      await tx.sale.update({
        where: { id: rec.saleId },
        data: {
          paidAmountXof: rec.sale.paidAmountXof + input.amountXof,
          dueAmountXof: Math.max(0, rec.sale.dueAmountXof - input.amountXof),
        },
      });

      return created;
    });

    await this.auditService.recordShop({
      shopId,
      actorUserId: actor.userId,
      actorRole: actor.role,
      declaredOperatorId: operator?.id ?? null,
      declaredOperatorName: operator?.firstName ?? null,
      action: 'RECEIVABLE_PAYMENT_RECORDED',
      entityType: 'ReceivablePayment',
      entityId: payment.id,
      afterData: {
        receivableId,
        amountXof: payment.amountXof,
        paymentMethodCode: payment.paymentMethodCode,
        transactionRef: payment.transactionRef,
      },
      ipAddress: meta.ipAddress,
      userAgent: meta.userAgent,
      correlationId: meta.correlationId,
    });

    return payment;
  }
}

@ApiTags('Clients & Créances')
@ApiBearerAuth()
@Controller('shops/:shopId')
@UseGuards(ShopScopeGuard, PermissionsGuard, OperatorGuard)
export class ClientsController {
  constructor(private readonly clientsService: ClientsService) {}

  @Get('clients')
  @Roles('OWNER', 'AGENT')
  @RequirePermissions('clients:read')
  @ApiOperation({ summary: 'Lister les clients de la boutique avec leur encours de créances' })
  listClients(@Param('shopId') shopId: string, @Query('search') search?: string) {
    return this.clientsService.listClients(shopId, search);
  }

  @Post('clients')
  @Roles('OWNER', 'AGENT')
  @RequirePermissions('clients:create')
  @ApiOperation({ summary: 'Créer une fiche client' })
  createClient(
    @Param('shopId') shopId: string,
    @Body(new ZodValidationPipe(createClientSchema)) body: any,
  ) {
    return this.clientsService.createClient(shopId, body);
  }

  @Patch('clients/:clientId')
  @Roles('OWNER', 'AGENT')
  @RequirePermissions('clients:update')
  @ApiOperation({ summary: 'Modifier une fiche client (y compris plafond de crédit)' })
  updateClient(
    @Param('shopId') shopId: string,
    @Param('clientId') clientId: string,
    @Body(new ZodValidationPipe(updateClientSchema)) body: any,
  ) {
    return this.clientsService.updateClient(shopId, clientId, body);
  }

  @Get('receivables')
  @Roles('OWNER', 'AGENT')
  @RequirePermissions('sales:read')
  @ApiOperation({ summary: 'Lister les créances clients avec ancienneté en jours' })
  listReceivables(@Param('shopId') shopId: string, @Query('status') status?: string) {
    return this.clientsService.listReceivables(shopId, status);
  }

  @Post('receivables/:receivableId/payments')
  @Roles('OWNER', 'AGENT')
  @RequirePermissions('cash:in')
  @RequireOperator()
  @ApiOperation({ summary: 'Encaisser un paiement partiel ou complet sur une créance client' })
  payReceivable(
    @Param('shopId') shopId: string,
    @Param('receivableId') receivableId: string,
    @Body(new ZodValidationPipe(receivablePaymentSchema)) body: any,
    @CurrentUser() user: AuthenticatedUser,
    @CurrentOperator() operator: DeclaredOperatorContext | undefined,
    @Req() req: RequestWithAuth,
  ) {
    return this.clientsService.recordReceivablePayment(shopId, receivableId, body, user, operator, {
      ipAddress: req.ip || null,
      userAgent: req.header('user-agent') || null,
      correlationId: req.correlationId || null,
    });
  }
}

@Module({
  controllers: [ClientsController],
  providers: [ClientsService],
})
export class ClientsModule {}
