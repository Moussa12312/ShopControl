import {
  BadRequestException,
  Body,
  ConflictException,
  Controller,
  ForbiddenException,
  Get,
  Injectable,
  Module,
  NotFoundException,
  Param,
  Post,
  Query,
  Req,
  UseGuards,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import {
  cancelExpenseSchema,
  createCompanyExpenseSchema,
  createExpenseCategorySchema,
  createExpenseSchema,
  DEFAULT_EXPENSE_CATEGORY_NAMES,
  formatXof,
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
export class ExpensesService {
  constructor(
    private readonly controlPrisma: ControlPrismaService,
    private readonly shopDbManager: ShopDatabaseManagerService,
    private readonly cashService: CashService,
    private readonly auditService: AuditService,
  ) {}

  async listCategories(shopId: string) {
    const client = await this.shopDbManager.getClientForShop(shopId);
    let cats = await client.expenseCategory.findMany({ orderBy: { name: 'asc' } });
    if (cats.length === 0) {
      for (const name of DEFAULT_EXPENSE_CATEGORY_NAMES) {
        await client.expenseCategory.upsert({
          where: { name },
          create: { name, isActive: true },
          update: {},
        });
      }
      cats = await client.expenseCategory.findMany({ orderBy: { name: 'asc' } });
    }
    return cats;
  }

  async createCategory(shopId: string, name: string) {
    const client = await this.shopDbManager.getClientForShop(shopId);
    const dup = await client.expenseCategory.findUnique({ where: { name } });
    if (dup) {
      throw new ConflictException({
        code: 'EXPENSE_CATEGORY_EXISTS',
        message: `La catégorie de dépense « ${name} » existe déjà.`,
      });
    }
    return client.expenseCategory.create({ data: { name } });
  }

  async listShopExpenses(shopId: string, status?: string) {
    const client = await this.shopDbManager.getClientForShop(shopId);
    const items = await client.expense.findMany({
      where: status ? { status } : undefined,
      orderBy: { expenseDate: 'desc' },
      take: 100,
      include: { category: { select: { id: true, name: true } } },
    });

    const totalActiveXof = items
      .filter((e) => e.status === 'ACTIVE')
      .reduce((acc, e) => acc + e.amountXof, 0);

    return {
      totalActiveXof,
      items: items.map((e) => ({
        id: e.id,
        categoryId: e.categoryId,
        categoryName: e.category.name,
        amountXof: e.amountXof,
        expenseDate: e.expenseDate.toISOString(),
        paymentMethodCode: e.paymentMethodCode,
        paidFromCashDrawer: e.paidFromCashDrawer,
        beneficiary: e.beneficiary,
        note: e.note,
        status: e.status,
        cancelReason: e.cancelReason,
        declaredOperatorName: e.declaredOperatorName,
        createdAt: e.createdAt.toISOString(),
      })),
    };
  }

  async createShopExpense(
    shopId: string,
    input: any,
    actor: AuthenticatedUser,
    operator: DeclaredOperatorContext | undefined,
    meta: RequestMeta,
  ) {
    // Contrôle plafond dépense par Agent (Section 4.3)
    if (actor.role === 'AGENT') {
      const access = actor.shopAccesses.find((s) => s.shopId === shopId);
      const cap = access?.maxExpenseAmountXof ?? 0;
      if (input.amountXof > cap) {
        throw new ForbiddenException({
          code: 'EXPENSE_CAP_EXCEEDED',
          message: `Le montant (${formatXof(input.amountXof)}) dépasse votre plafond autorisé par dépense (${formatXof(cap)}).`,
        });
      }
    }

    const client = await this.shopDbManager.getClientForShop(shopId);
    const created = await client.$transaction(async (tx) => {
      const cat = await tx.expenseCategory.findUnique({ where: { id: input.categoryId } });
      if (!cat) {
        throw new NotFoundException({ code: 'CATEGORY_NOT_FOUND', message: 'Catégorie introuvable.' });
      }

      let cashMovementId: string | null = null;
      if (input.paidFromCashDrawer) {
        const openSession = await this.cashService.getOpenSessionInTx(tx);
        if (!openSession) {
          throw new BadRequestException({
            code: 'CASH_SESSION_REQUIRED',
            message: 'Ouvrez une session de caisse pour payer une dépense depuis la caisse.',
          });
        }
        const mv = await this.cashService.recordMovementInTx(tx, {
          sessionId: openSession.id,
          type: 'EXPENSE_OUT',
          amountXof: input.amountXof,
          referenceType: 'EXPENSE',
          reason: `Dépense ${cat.name}${input.beneficiary ? ` (${input.beneficiary})` : ''}`,
          actorUserId: actor.userId,
          declaredOperatorId: operator?.id ?? null,
          declaredOperatorName: operator?.firstName ?? null,
        });
        cashMovementId = mv.id;
      }

      return tx.expense.create({
        data: {
          categoryId: cat.id,
          amountXof: input.amountXof,
          expenseDate: input.expenseDate ? new Date(input.expenseDate) : new Date(),
          paymentMethodCode: input.paymentMethodCode || 'CASH',
          paidFromCashDrawer: input.paidFromCashDrawer,
          cashMovementId,
          beneficiary: input.beneficiary || null,
          note: input.note || null,
          status: 'ACTIVE',
          actorUserId: actor.userId,
          declaredOperatorId: operator?.id ?? null,
          declaredOperatorName: operator?.firstName ?? null,
        },
        include: { category: { select: { name: true } } },
      });
    });

    await this.auditService.recordShop({
      shopId,
      actorUserId: actor.userId,
      actorRole: actor.role,
      declaredOperatorId: operator?.id ?? null,
      declaredOperatorName: operator?.firstName ?? null,
      action: 'EXPENSE_CREATED',
      entityType: 'Expense',
      entityId: created.id,
      afterData: {
        categoryName: created.category.name,
        amountXof: created.amountXof,
        paidFromCashDrawer: created.paidFromCashDrawer,
      },
      ipAddress: meta.ipAddress,
      userAgent: meta.userAgent,
      correlationId: meta.correlationId,
    });

    return created;
  }

  async cancelShopExpense(
    shopId: string,
    expenseId: string,
    reason: string,
    actor: AuthenticatedUser,
    operator: DeclaredOperatorContext | undefined,
    meta: RequestMeta,
  ) {
    const client = await this.shopDbManager.getClientForShop(shopId);
    const updated = await client.$transaction(async (tx) => {
      const exp = await tx.expense.findUnique({ where: { id: expenseId } });
      if (!exp) {
        throw new NotFoundException({ code: 'EXPENSE_NOT_FOUND', message: 'Dépense introuvable.' });
      }
      if (exp.status === 'CANCELLED') {
        throw new ConflictException({ code: 'EXPENSE_CANCELLED', message: 'Cette dépense est déjà annulée.' });
      }

      if (exp.paidFromCashDrawer) {
        const openSession = await this.cashService.getOpenSessionInTx(tx);
        if (openSession) {
          await this.cashService.recordMovementInTx(tx, {
            sessionId: openSession.id,
            type: 'MANUAL_IN',
            amountXof: exp.amountXof,
            referenceType: 'EXPENSE_CANCEL',
            referenceId: exp.id,
            reason: `Annulation dépense : ${reason}`,
            actorUserId: actor.userId,
            declaredOperatorId: operator?.id ?? null,
            declaredOperatorName: operator?.firstName ?? null,
          });
        }
      }

      return tx.expense.update({
        where: { id: expenseId },
        data: { status: 'CANCELLED', cancelReason: reason, cancelledAt: new Date() },
      });
    });

    await this.auditService.recordShop({
      shopId,
      actorUserId: actor.userId,
      actorRole: actor.role,
      declaredOperatorId: operator?.id ?? null,
      declaredOperatorName: operator?.firstName ?? null,
      action: 'EXPENSE_CANCELLED',
      entityType: 'Expense',
      entityId: expenseId,
      afterData: { amountXof: updated.amountXof },
      reason,
      ipAddress: meta.ipAddress,
      userAgent: meta.userAgent,
      correlationId: meta.correlationId,
    });

    return updated;
  }

  // --- Dépenses communes d'entreprise (vue consolidée Propriétaire — Section 5.6 & 11.2) ---
  async listCompanyExpenses(merchantId: string) {
    const items = await this.controlPrisma.companyExpense.findMany({
      where: { merchantId },
      orderBy: { expenseDate: 'desc' },
      take: 100,
    });
    const totalActiveXof = items
      .filter((e) => e.status === 'ACTIVE')
      .reduce((acc, e) => acc + e.amountXof, 0);
    return {
      totalActiveXof,
      items: items.map((e) => ({
        ...e,
        expenseDate: e.expenseDate.toISOString(),
        cancelledAt: e.cancelledAt?.toISOString() ?? null,
        createdAt: e.createdAt.toISOString(),
      })),
    };
  }

  async createCompanyExpense(
    merchantId: string,
    input: any,
    actor: AuthenticatedUser,
    meta: RequestMeta,
  ) {
    const created = await this.controlPrisma.companyExpense.create({
      data: {
        merchantId,
        categoryName: input.categoryName,
        amountXof: input.amountXof,
        expenseDate: input.expenseDate ? new Date(input.expenseDate) : new Date(),
        paymentMethodCode: input.paymentMethodCode || 'BANK',
        beneficiary: input.beneficiary || null,
        note: input.note || null,
        status: 'ACTIVE',
        actorUserId: actor.userId,
      },
    });

    await this.auditService.recordControl({
      merchantId,
      actorUserId: actor.userId,
      actorRole: actor.role,
      action: 'COMPANY_EXPENSE_CREATED',
      entityType: 'CompanyExpense',
      entityId: created.id,
      afterData: { categoryName: created.categoryName, amountXof: created.amountXof },
      ipAddress: meta.ipAddress,
      userAgent: meta.userAgent,
      correlationId: meta.correlationId,
    });

    return created;
  }

  async cancelCompanyExpense(
    merchantId: string,
    expenseId: string,
    reason: string,
    actor: AuthenticatedUser,
    meta: RequestMeta,
  ) {
    const existing = await this.controlPrisma.companyExpense.findFirst({
      where: { id: expenseId, merchantId },
    });
    if (!existing) {
      throw new NotFoundException({ code: 'EXPENSE_NOT_FOUND', message: 'Dépense introuvable.' });
    }
    const updated = await this.controlPrisma.companyExpense.update({
      where: { id: expenseId },
      data: { status: 'CANCELLED', cancelReason: reason, cancelledAt: new Date() },
    });
    await this.auditService.recordControl({
      merchantId,
      actorUserId: actor.userId,
      actorRole: actor.role,
      action: 'COMPANY_EXPENSE_CANCELLED',
      entityType: 'CompanyExpense',
      entityId: expenseId,
      reason,
      ipAddress: meta.ipAddress,
      userAgent: meta.userAgent,
      correlationId: meta.correlationId,
    });
    return updated;
  }
}

@ApiTags('Dépenses')
@ApiBearerAuth()
@Controller()
export class ExpensesController {
  constructor(private readonly expensesService: ExpensesService) {}

  @Get('shops/:shopId/expense-categories')
  @UseGuards(ShopScopeGuard)
  @Roles('OWNER', 'AGENT')
  @ApiOperation({ summary: 'Lister les catégories de dépenses de la boutique' })
  listCategories(@Param('shopId') shopId: string) {
    return this.expensesService.listCategories(shopId);
  }

  @Post('shops/:shopId/expense-categories')
  @UseGuards(ShopScopeGuard)
  @Roles('OWNER')
  @ApiOperation({ summary: 'Ajouter une catégorie de dépense' })
  createCategory(
    @Param('shopId') shopId: string,
    @Body(new ZodValidationPipe(createExpenseCategorySchema)) body: { name: string },
  ) {
    return this.expensesService.createCategory(shopId, body.name);
  }

  @Get('shops/:shopId/expenses')
  @UseGuards(ShopScopeGuard)
  @Roles('OWNER', 'AGENT')
  @ApiOperation({ summary: 'Lister les dépenses enregistrées sur la boutique' })
  listShopExpenses(@Param('shopId') shopId: string, @Query('status') status?: string) {
    return this.expensesService.listShopExpenses(shopId, status);
  }

  @Post('shops/:shopId/expenses')
  @UseGuards(ShopScopeGuard, PermissionsGuard, OperatorGuard)
  @Roles('OWNER', 'AGENT')
  @RequirePermissions('expenses:create')
  @RequireOperator(true)
  @ApiOperation({ summary: 'Enregistrer une dépense boutique (avec plafond Agent et décaissement caisse optionnel)' })
  createShopExpense(
    @Param('shopId') shopId: string,
    @Body(new ZodValidationPipe(createExpenseSchema)) body: any,
    @CurrentUser() user: AuthenticatedUser,
    @CurrentOperator() operator: DeclaredOperatorContext | undefined,
    @Req() req: RequestWithAuth,
  ) {
    return this.expensesService.createShopExpense(shopId, body, user, operator, {
      ipAddress: req.ip || null,
      userAgent: req.header('user-agent') || null,
      correlationId: req.correlationId || null,
    });
  }

  @Post('shops/:shopId/expenses/:expenseId/cancel')
  @UseGuards(ShopScopeGuard, OperatorGuard)
  @Roles('OWNER')
  @ApiOperation({ summary: 'Annuler une dépense boutique avec motif obligatoire' })
  cancelShopExpense(
    @Param('shopId') shopId: string,
    @Param('expenseId') expenseId: string,
    @Body(new ZodValidationPipe(cancelExpenseSchema)) body: { reason: string },
    @CurrentUser() user: AuthenticatedUser,
    @CurrentOperator() operator: DeclaredOperatorContext | undefined,
    @Req() req: RequestWithAuth,
  ) {
    return this.expensesService.cancelShopExpense(shopId, expenseId, body.reason, user, operator, {
      ipAddress: req.ip || null,
      userAgent: req.header('user-agent') || null,
      correlationId: req.correlationId || null,
    });
  }

  @Get('merchant/expenses')
  @Roles('OWNER')
  @ApiOperation({ summary: 'Lister les dépenses communes d’entreprise (vue consolidée)' })
  listCompanyExpenses(@CurrentUser() user: AuthenticatedUser) {
    if (!user.merchantId) throw new ForbiddenException('Marchand manquant.');
    return this.expensesService.listCompanyExpenses(user.merchantId);
  }

  @Post('merchant/expenses')
  @Roles('OWNER')
  @ApiOperation({ summary: 'Enregistrer une dépense commune d’entreprise' })
  createCompanyExpense(
    @CurrentUser() user: AuthenticatedUser,
    @Body(new ZodValidationPipe(createCompanyExpenseSchema)) body: any,
    @Req() req: RequestWithAuth,
  ) {
    if (!user.merchantId) throw new ForbiddenException('Marchand manquant.');
    return this.expensesService.createCompanyExpense(user.merchantId, body, user, {
      ipAddress: req.ip || null,
      userAgent: req.header('user-agent') || null,
      correlationId: req.correlationId || null,
    });
  }

  @Post('merchant/expenses/:expenseId/cancel')
  @Roles('OWNER')
  @ApiOperation({ summary: 'Annuler une dépense commune d’entreprise avec motif' })
  cancelCompanyExpense(
    @CurrentUser() user: AuthenticatedUser,
    @Param('expenseId') expenseId: string,
    @Body(new ZodValidationPipe(cancelExpenseSchema)) body: { reason: string },
    @Req() req: RequestWithAuth,
  ) {
    if (!user.merchantId) throw new ForbiddenException('Marchand manquant.');
    return this.expensesService.cancelCompanyExpense(user.merchantId, expenseId, body.reason, user, {
      ipAddress: req.ip || null,
      userAgent: req.header('user-agent') || null,
      correlationId: req.correlationId || null,
    });
  }
}

@Module({
  controllers: [ExpensesController],
  providers: [ExpensesService],
})
export class ExpensesModule {}
