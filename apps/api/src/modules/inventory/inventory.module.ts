import * as crypto from 'crypto';
import {
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
  Query,
  Req,
  UseGuards,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import {
  physicalInventorySchema,
  stockAdjustmentSchema,
  StockMovementType,
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

export interface ApplyStockMovementInput {
  productId: string;
  variantId?: string | null;
  movementType: StockMovementType;
  quantityDelta: number;
  unitCostXof?: number | null;
  referenceType?: string | null;
  referenceId?: string | null;
  reason?: string | null;
  actorUserId?: string | null;
  declaredOperatorId?: string | null;
  declaredOperatorName?: string | null;
  allowNegativeStock?: boolean;
}

export interface ApplyStockMovementResult {
  movementId: string;
  qtyBefore: number;
  qtyAfter: number;
  availableAfter: number;
  becameNegative: boolean;
  isLowStock: boolean;
  productName: string;
  alertThreshold: number;
}

@Injectable()
export class InventoryService {
  constructor(
    private readonly shopDbManager: ShopDatabaseManagerService,
    private readonly auditService: AuditService,
    private readonly notificationsService: NotificationsService,
  ) {}

  /**
   * Point d'entrée UNIQUE pour toute variation de stock dans la base dédiée d'une boutique.
   * Utilise un verrou pessimiste `SELECT ... FOR UPDATE` sur `stock_balances` pour garantir
   * l'atomicité et l'absence de survente concurrente (Critère #17).
   */
  async applyMovementInTx(
    tx: ShopPrisma.TransactionClient,
    input: ApplyStockMovementInput,
  ): Promise<ApplyStockMovementResult> {
    const product = await tx.product.findUnique({
      where: { id: input.productId },
      select: { id: true, name: true, alertThreshold: true },
    });
    if (!product) {
      throw new NotFoundException({
        code: 'PRODUCT_NOT_FOUND',
        message: 'Produit introuvable dans cette boutique.',
      });
    }

    let alertThreshold = product.alertThreshold;
    if (input.variantId) {
      const variant = await tx.productVariant.findFirst({
        where: { id: input.variantId, productId: input.productId },
        select: { id: true, alertThreshold: true },
      });
      if (!variant) {
        throw new NotFoundException({
          code: 'VARIANT_NOT_FOUND',
          message: 'Variante introuvable pour ce produit.',
        });
      }
      alertThreshold = variant.alertThreshold;
    }

    const variantKey = input.variantId ?? 'BASE';
    const balanceId = crypto.randomUUID();

    // Garantit l'existence de la ligne avant verrouillage FOR UPDATE
    await tx.$executeRaw`
      INSERT INTO "stock_balances" ("id", "product_id", "variant_id", "variant_key", "physical_qty", "reserved_qty", "updated_at")
      VALUES (${balanceId}::uuid, ${input.productId}::uuid, ${input.variantId ?? null}::uuid, ${variantKey}, 0, 0, NOW())
      ON CONFLICT ("product_id", "variant_key") DO NOTHING
    `;

    const lockedRows = await tx.$queryRaw<
      Array<{ id: string; physical_qty: number; reserved_qty: number }>
    >`
      SELECT "id", "physical_qty", "reserved_qty"
      FROM "stock_balances"
      WHERE "product_id" = ${input.productId}::uuid AND "variant_key" = ${variantKey}
      FOR UPDATE
    `;

    const balance = lockedRows[0];
    const qtyBefore = balance.physical_qty;
    const availableBefore = balance.physical_qty - balance.reserved_qty;
    const qtyAfter = qtyBefore + input.quantityDelta;
    const availableAfter = availableBefore + input.quantityDelta;

    if (input.quantityDelta < 0 && !input.allowNegativeStock && availableAfter < 0) {
      throw new ConflictException({
        code: 'INSUFFICIENT_STOCK',
        message: `Stock insuffisant pour « ${product.name} » (disponible : ${availableBefore}, demandé : ${Math.abs(input.quantityDelta)}).`,
        errors: [{ path: 'quantity', message: `Stock restant : ${availableBefore}` }],
      });
    }

    await tx.stockBalance.update({
      where: { id: balance.id },
      data: { physicalQty: qtyAfter },
    });

    const movement = await tx.stockMovement.create({
      data: {
        productId: input.productId,
        variantId: input.variantId ?? null,
        movementType: input.movementType,
        quantityDelta: input.quantityDelta,
        qtyBefore,
        qtyAfter,
        unitCostXof: input.unitCostXof ?? null,
        referenceType: input.referenceType ?? null,
        referenceId: input.referenceId ?? null,
        reason: input.reason ?? null,
        actorUserId: input.actorUserId ?? null,
        declaredOperatorId: input.declaredOperatorId ?? null,
        declaredOperatorName: input.declaredOperatorName ?? null,
      },
    });

    return {
      movementId: movement.id,
      qtyBefore,
      qtyAfter,
      availableAfter,
      becameNegative: qtyAfter < 0,
      isLowStock: availableAfter <= alertThreshold,
      productName: product.name,
      alertThreshold,
    };
  }

  async listMovements(
    shopId: string,
    params: { productId?: string; movementType?: string; page?: number; limit?: number },
  ) {
    const client = await this.shopDbManager.getClientForShop(shopId);
    const page = Math.max(1, params.page || 1);
    const limit = Math.min(100, Math.max(1, params.limit || 30));

    const where: Record<string, unknown> = {};
    if (params.productId) where.productId = params.productId;
    if (params.movementType) where.movementType = params.movementType;

    const [total, items] = await Promise.all([
      client.stockMovement.count({ where }),
      client.stockMovement.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        skip: (page - 1) * limit,
        take: limit,
        include: { product: { select: { name: true, sku: true, unit: true } } },
      }),
    ]);

    return {
      items: items.map((m) => ({
        id: m.id,
        productId: m.productId,
        productName: m.product.name,
        sku: m.product.sku,
        unit: m.product.unit,
        variantId: m.variantId,
        movementType: m.movementType,
        quantityDelta: m.quantityDelta,
        qtyBefore: m.qtyBefore,
        qtyAfter: m.qtyAfter,
        unitCostXof: m.unitCostXof,
        referenceType: m.referenceType,
        referenceId: m.referenceId,
        reason: m.reason,
        declaredOperatorName: m.declaredOperatorName,
        createdAt: m.createdAt.toISOString(),
      })),
      total,
      page,
      limit,
    };
  }

  async getAlerts(shopId: string) {
    const client = await this.shopDbManager.getClientForShop(shopId);
    const products = await client.product.findMany({
      where: { status: { not: 'ARCHIVED' } },
      include: { stockBalances: true, category: { select: { name: true } } },
      orderBy: { name: 'asc' },
    });

    const alerts: Array<{
      productId: string;
      name: string;
      sku: string;
      categoryName: string | null;
      physicalQty: number;
      reservedQty: number;
      availableQty: number;
      alertThreshold: number;
      severity: 'NEGATIVE_CONFLICT' | 'OUT_OF_STOCK' | 'LOW_STOCK';
    }> = [];

    for (const p of products) {
      const base = p.stockBalances.find((b) => b.variantKey === 'BASE');
      const physicalQty = base?.physicalQty ?? 0;
      const reservedQty = base?.reservedQty ?? 0;
      const availableQty = physicalQty - reservedQty;

      if (physicalQty < 0) {
        alerts.push({
          productId: p.id,
          name: p.name,
          sku: p.sku,
          categoryName: p.category?.name ?? null,
          physicalQty,
          reservedQty,
          availableQty,
          alertThreshold: p.alertThreshold,
          severity: 'NEGATIVE_CONFLICT',
        });
      } else if (availableQty <= 0) {
        alerts.push({
          productId: p.id,
          name: p.name,
          sku: p.sku,
          categoryName: p.category?.name ?? null,
          physicalQty,
          reservedQty,
          availableQty,
          alertThreshold: p.alertThreshold,
          severity: 'OUT_OF_STOCK',
        });
      } else if (availableQty <= p.alertThreshold) {
        alerts.push({
          productId: p.id,
          name: p.name,
          sku: p.sku,
          categoryName: p.category?.name ?? null,
          physicalQty,
          reservedQty,
          availableQty,
          alertThreshold: p.alertThreshold,
          severity: 'LOW_STOCK',
        });
      }
    }

    return alerts;
  }

  async createManualAdjustment(
    shopId: string,
    input: {
      productId: string;
      variantId?: string | null;
      quantityDelta: number;
      movementType: 'MANUAL_IN' | 'MANUAL_OUT' | 'INVENTORY_ADJUSTMENT' | 'RETURN_DAMAGED_LOSS';
      reason: string;
    },
    actor: AuthenticatedUser,
    operator: DeclaredOperatorContext | undefined,
    meta: RequestMeta,
  ) {
    const client = await this.shopDbManager.getClientForShop(shopId);
    const result = await client.$transaction((tx) =>
      this.applyMovementInTx(tx, {
        productId: input.productId,
        variantId: input.variantId ?? null,
        movementType: input.movementType,
        quantityDelta: input.quantityDelta,
        referenceType: 'MANUAL_ADJUSTMENT',
        reason: input.reason,
        actorUserId: actor.userId,
        declaredOperatorId: operator?.id ?? null,
        declaredOperatorName: operator?.firstName ?? null,
        allowNegativeStock: false,
      }),
    );

    await this.auditService.recordShop({
      shopId,
      actorUserId: actor.userId,
      actorRole: actor.role,
      declaredOperatorId: operator?.id ?? null,
      declaredOperatorName: operator?.firstName ?? null,
      action: 'STOCK_ADJUSTED',
      entityType: 'Product',
      entityId: input.productId,
      beforeData: { physicalQty: result.qtyBefore },
      afterData: {
        physicalQty: result.qtyAfter,
        delta: input.quantityDelta,
        movementType: input.movementType,
      },
      reason: input.reason,
      ipAddress: meta.ipAddress,
      userAgent: meta.userAgent,
      correlationId: meta.correlationId,
    });

    if (actor.merchantId && result.isLowStock) {
      await this.notificationsService.notifyMerchantOwners(actor.merchantId, {
        shopId,
        type: 'STOCK',
        priority: result.availableAfter <= 0 ? 'URGENT' : 'WARNING',
        title: `Alerte stock : ${result.productName}`,
        message: `Stock disponible à ${result.availableAfter} (seuil : ${result.alertThreshold}) suite à un ajustement.`,
        targetPath: '/commerce/stock',
      });
    }

    return result;
  }

  async submitPhysicalInventory(
    shopId: string,
    input: {
      reason: string;
      items: Array<{ productId: string; variantId?: string | null; countedQty: number }>;
    },
    actor: AuthenticatedUser,
    operator: DeclaredOperatorContext | undefined,
    meta: RequestMeta,
  ) {
    const client = await this.shopDbManager.getClientForShop(shopId);
    const discrepancies: Array<{
      productId: string;
      productName: string;
      theoreticalQty: number;
      countedQty: number;
      delta: number;
    }> = [];

    await client.$transaction(async (tx) => {
      for (const item of input.items) {
        const variantKey = item.variantId ?? 'BASE';
        const balance = await tx.stockBalance.findUnique({
          where: { productId_variantKey: { productId: item.productId, variantKey } },
        });
        const theoreticalQty = balance?.physicalQty ?? 0;
        const delta = item.countedQty - theoreticalQty;
        if (delta === 0) continue;

        const applied = await this.applyMovementInTx(tx, {
          productId: item.productId,
          variantId: item.variantId ?? null,
          movementType: 'INVENTORY_ADJUSTMENT',
          quantityDelta: delta,
          referenceType: 'PHYSICAL_INVENTORY',
          reason: input.reason,
          actorUserId: actor.userId,
          declaredOperatorId: operator?.id ?? null,
          declaredOperatorName: operator?.firstName ?? null,
          allowNegativeStock: false,
        });

        discrepancies.push({
          productId: item.productId,
          productName: applied.productName,
          theoreticalQty,
          countedQty: item.countedQty,
          delta,
        });
      }
    });

    await this.auditService.recordShop({
      shopId,
      actorUserId: actor.userId,
      actorRole: actor.role,
      declaredOperatorId: operator?.id ?? null,
      declaredOperatorName: operator?.firstName ?? null,
      action: 'STOCK_INVENTORY_SUBMITTED',
      entityType: 'StockInventory',
      afterData: {
        checkedCount: input.items.length,
        discrepanciesCount: discrepancies.length,
        discrepancies,
      },
      reason: input.reason,
      ipAddress: meta.ipAddress,
      userAgent: meta.userAgent,
      correlationId: meta.correlationId,
    });

    if (actor.merchantId && discrepancies.length > 0) {
      await this.notificationsService.notifyMerchantOwners(actor.merchantId, {
        shopId,
        type: 'STOCK',
        priority: 'WARNING',
        title: `Inventaire avec ${discrepancies.length} écart(s)`,
        message: `Un inventaire physique (${input.reason}) a corrigé ${discrepancies.length} écart(s) de stock.`,
        targetPath: '/commerce/stock',
      });
    }

    return {
      checkedCount: input.items.length,
      discrepanciesCount: discrepancies.length,
      discrepancies,
    };
  }
}

@ApiTags('Stocks & Inventaire')
@ApiBearerAuth()
@Controller('shops/:shopId/stock')
@UseGuards(ShopScopeGuard, PermissionsGuard, OperatorGuard)
export class InventoryController {
  constructor(private readonly inventoryService: InventoryService) {}

  @Get('movements')
  @Roles('OWNER', 'AGENT')
  @RequirePermissions('stock:read')
  @ApiOperation({ summary: 'Consulter l’historique immuable des mouvements de stock' })
  listMovements(
    @Param('shopId') shopId: string,
    @Query('productId') productId?: string,
    @Query('movementType') movementType?: string,
    @Query('page') page?: string,
    @Query('limit') limit?: string,
  ) {
    return this.inventoryService.listMovements(shopId, {
      productId,
      movementType,
      page: page ? Number(page) : 1,
      limit: limit ? Number(limit) : 30,
    });
  }

  @Get('alerts')
  @Roles('OWNER', 'AGENT')
  @RequirePermissions('stock:read')
  @ApiOperation({ summary: 'Lister les ruptures, seuils bas et conflits de stock négatif' })
  alerts(@Param('shopId') shopId: string) {
    return this.inventoryService.getAlerts(shopId);
  }

  @Post('adjustments')
  @Roles('OWNER', 'AGENT')
  @RequirePermissions('stock:adjust')
  @RequireOperator(true)
  @ApiOperation({ summary: 'Enregistrer une correction / perte de stock motivée et tracée' })
  adjust(
    @Param('shopId') shopId: string,
    @Body(new ZodValidationPipe(stockAdjustmentSchema)) body: any,
    @CurrentUser() user: AuthenticatedUser,
    @CurrentOperator() operator: DeclaredOperatorContext | undefined,
    @Req() req: RequestWithAuth,
  ) {
    return this.inventoryService.createManualAdjustment(shopId, body, user, operator, {
      ipAddress: req.ip || null,
      userAgent: req.header('user-agent') || null,
      correlationId: req.correlationId || null,
    });
  }

  @Post('inventory')
  @Roles('OWNER', 'AGENT')
  @RequirePermissions('stock:inventory')
  @RequireOperator(true)
  @ApiOperation({ summary: 'Valider un inventaire physique (comparaison théorique vs compté)' })
  inventory(
    @Param('shopId') shopId: string,
    @Body(new ZodValidationPipe(physicalInventorySchema)) body: any,
    @CurrentUser() user: AuthenticatedUser,
    @CurrentOperator() operator: DeclaredOperatorContext | undefined,
    @Req() req: RequestWithAuth,
  ) {
    return this.inventoryService.submitPhysicalInventory(shopId, body, user, operator, {
      ipAddress: req.ip || null,
      userAgent: req.header('user-agent') || null,
      correlationId: req.correlationId || null,
    });
  }
}

@Global()
@Module({
  controllers: [InventoryController],
  providers: [InventoryService],
  exports: [InventoryService],
})
export class InventoryModule {}
