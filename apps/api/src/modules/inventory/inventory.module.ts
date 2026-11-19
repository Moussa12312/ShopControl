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
  createProductBatchSchema,
  physicalInventorySchema,
  stockAdjustmentSchema,
  StockMovementType,
  writeOffBatchSchema,
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
  /** Optionnel : variation exacte en millièmes d'unité (ex: -250 pour 0,25 kg). Prioritaire sur quantityDelta si défini. */
  quantityDeltaMilli?: number;
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
  remainderMilliAfter: number;
  qtyAfterDecimal: number;
  availableAfter: number;
  availableAfterDecimal: number;
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
      INSERT INTO "stock_balances" ("id", "product_id", "variant_id", "variant_key", "physical_qty", "fractional_remainder_milli", "reserved_qty", "updated_at")
      VALUES (${balanceId}::uuid, ${input.productId}::uuid, ${input.variantId ?? null}::uuid, ${variantKey}, 0, 0, 0, NOW())
      ON CONFLICT ("product_id", "variant_key") DO NOTHING
    `;

    const lockedRows = await tx.$queryRaw<
      Array<{
        id: string;
        physical_qty: number;
        fractional_remainder_milli: number;
        reserved_qty: number;
      }>
    >`
      SELECT "id", "physical_qty", "fractional_remainder_milli", "reserved_qty"
      FROM "stock_balances"
      WHERE "product_id" = ${input.productId}::uuid AND "variant_key" = ${variantKey}
      FOR UPDATE
    `;

    const balance = lockedRows[0];
    const qtyBefore = balance.physical_qty;
    const remainderBefore = balance.fractional_remainder_milli ?? 0;
    const totalPhysicalMilliBefore = qtyBefore * 1000 + remainderBefore;
    const availableMilliBefore = totalPhysicalMilliBefore - balance.reserved_qty * 1000;

    const deltaMilli =
      input.quantityDeltaMilli !== undefined
        ? Math.trunc(input.quantityDeltaMilli)
        : Math.trunc(input.quantityDelta) * 1000;

    const totalPhysicalMilliAfter = totalPhysicalMilliBefore + deltaMilli;
    const availableMilliAfter = availableMilliBefore + deltaMilli;

    if (deltaMilli < 0 && !input.allowNegativeStock && availableMilliAfter < 0) {
      const availDisplay = Number((availableMilliBefore / 1000).toFixed(3));
      const reqDisplay = Number((Math.abs(deltaMilli) / 1000).toFixed(3));
      throw new ConflictException({
        code: 'INSUFFICIENT_STOCK',
        message: `Stock insuffisant pour « ${product.name} » (disponible : ${availDisplay}, demandé : ${reqDisplay}).`,
        errors: [{ path: 'quantity', message: `Stock restant : ${availDisplay}` }],
      });
    }

    const qtyAfter = Math.floor(totalPhysicalMilliAfter / 1000);
    const remainderMilliAfter = totalPhysicalMilliAfter - qtyAfter * 1000;
    const availableAfter = Math.floor(availableMilliAfter / 1000);
    const qtyAfterDecimal = Number((totalPhysicalMilliAfter / 1000).toFixed(3));
    const availableAfterDecimal = Number((availableMilliAfter / 1000).toFixed(3));
    const loggedDelta =
      input.quantityDeltaMilli !== undefined ? qtyAfter - qtyBefore : input.quantityDelta;

    await tx.stockBalance.update({
      where: { id: balance.id },
      data: {
        physicalQty: qtyAfter,
        fractionalRemainderMilli: remainderMilliAfter,
      },
    });

    const movement = await tx.stockMovement.create({
      data: {
        productId: input.productId,
        variantId: input.variantId ?? null,
        movementType: input.movementType,
        quantityDelta: loggedDelta,
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
      remainderMilliAfter,
      qtyAfterDecimal,
      availableAfter,
      availableAfterDecimal,
      becameNegative: totalPhysicalMilliAfter < 0,
      isLowStock: availableAfterDecimal <= alertThreshold,
      productName: product.name,
      alertThreshold,
    };
  }

  /**
   * Synchronise `product.expiryDate` sur la date de péremption la plus proche parmi ses lots actifs.
   */
  async syncProductEarliestExpiryInTx(
    tx: ShopPrisma.TransactionClient,
    productId: string,
  ): Promise<void> {
    const earliest = await tx.productBatch.findFirst({
      where: { productId, status: 'ACTIVE', remainingQty: { gt: 0 } },
      orderBy: [{ expiryDate: 'asc' }, { createdAt: 'asc' }],
      select: { expiryDate: true },
    });
    if (earliest) {
      await tx.product.update({
        where: { id: productId },
        data: { expiryDate: earliest.expiryDate },
      });
    }
  }

  /**
   * Déduction FEFO (First Expired, First Out — Lot 10) :
   * Consomme automatiquement les lots actifs dont la DLC est la plus proche lors d'une vente.
   */
  async deductBatchesFefoInTx(
    tx: ShopPrisma.TransactionClient,
    productId: string,
    unitsToDeduct: number,
  ): Promise<void> {
    if (unitsToDeduct <= 0) return;
    const batches = await tx.productBatch.findMany({
      where: { productId, status: 'ACTIVE', remainingQty: { gt: 0 } },
      orderBy: [{ expiryDate: 'asc' }, { createdAt: 'asc' }],
    });
    if (batches.length === 0) return;

    let remaining = unitsToDeduct;
    for (const batch of batches) {
      if (remaining <= 0) break;
      const take = Math.min(batch.remainingQty, remaining);
      const nextRemaining = batch.remainingQty - take;
      await tx.productBatch.update({
        where: { id: batch.id },
        data: {
          remainingQty: nextRemaining,
          status: nextRemaining === 0 ? 'DEPLETED' : 'ACTIVE',
        },
      });
      remaining -= take;
    }

    await this.syncProductEarliestExpiryInTx(tx, productId);
  }

  /**
   * Réintégration inverse de lots lors d'une annulation de vente.
   */
  async restoreBatchesInTx(
    tx: ShopPrisma.TransactionClient,
    productId: string,
    unitsToRestore: number,
  ): Promise<void> {
    if (unitsToRestore <= 0) return;
    const batches = await tx.productBatch.findMany({
      where: { productId, status: { in: ['ACTIVE', 'DEPLETED'] } },
      orderBy: [{ expiryDate: 'desc' }, { createdAt: 'desc' }],
    });
    if (batches.length === 0) return;

    let remaining = unitsToRestore;
    for (const batch of batches) {
      if (remaining <= 0) break;
      const capacity = Math.max(0, batch.initialQty - batch.remainingQty);
      if (capacity <= 0) continue;
      const putBack = Math.min(capacity, remaining);
      await tx.productBatch.update({
        where: { id: batch.id },
        data: {
          remainingQty: batch.remainingQty + putBack,
          status: 'ACTIVE',
        },
      });
      remaining -= putBack;
    }

    await this.syncProductEarliestExpiryInTx(tx, productId);
  }

  /**
   * Alertes DLC / Péremptions (Lot 10) :
   * Classe les lots actifs (et produits avec DLC simple) en : EXPIRED, EXPIRING_7D, EXPIRING_30D, OK.
   */
  async getExpiryAlerts(shopId: string) {
    const client = await this.shopDbManager.getClientForShop(shopId);
    const now = Date.now();
    const dayMs = 86_400_000;

    const [batches, productsWithExpiry] = await Promise.all([
      client.productBatch.findMany({
        where: { status: 'ACTIVE', remainingQty: { gt: 0 } },
        orderBy: [{ expiryDate: 'asc' }, { createdAt: 'asc' }],
        include: {
          product: {
            select: {
              id: true,
              name: true,
              sku: true,
              unit: true,
              costPriceXof: true,
              salePriceXof: true,
              status: true,
            },
          },
        },
      }),
      client.product.findMany({
        where: { status: { not: 'ARCHIVED' }, expiryDate: { not: null } },
        include: {
          stockBalances: { where: { variantKey: 'BASE' } },
          batches: { where: { status: 'ACTIVE', remainingQty: { gt: 0 } }, select: { id: true } },
        },
      }),
    ]);

    type ExpirySeverity = 'EXPIRED' | 'EXPIRING_7D' | 'EXPIRING_30D' | 'OK';
    const classify = (expiryDate: Date): { daysRemaining: number; severity: ExpirySeverity } => {
      const daysRemaining = Math.ceil((expiryDate.getTime() - now) / dayMs);
      if (daysRemaining <= 0) return { daysRemaining, severity: 'EXPIRED' };
      if (daysRemaining <= 7) return { daysRemaining, severity: 'EXPIRING_7D' };
      if (daysRemaining <= 30) return { daysRemaining, severity: 'EXPIRING_30D' };
      return { daysRemaining, severity: 'OK' };
    };

    const items: Array<{
      batchId: string | null;
      productId: string;
      productName: string;
      sku: string;
      unit: string;
      batchNumber: string | null;
      expiryDate: string;
      remainingQty: number;
      initialQty: number;
      daysRemaining: number;
      severity: ExpirySeverity;
      estimatedLossCostXof: number;
      notes: string | null;
    }> = [];

    for (const b of batches) {
      if (b.product.status === 'ARCHIVED') continue;
      const { daysRemaining, severity } = classify(b.expiryDate);
      items.push({
        batchId: b.id,
        productId: b.product.id,
        productName: b.product.name,
        sku: b.product.sku,
        unit: b.product.unit,
        batchNumber: b.batchNumber,
        expiryDate: b.expiryDate.toISOString(),
        remainingQty: b.remainingQty,
        initialQty: b.initialQty,
        daysRemaining,
        severity,
        estimatedLossCostXof: (b.product.costPriceXof ?? 0) * b.remainingQty,
        notes: b.notes,
      });
    }

    // Produits ayant une DLC directe sans lot actif détaillé
    for (const p of productsWithExpiry) {
      if (p.batches.length > 0 || !p.expiryDate) continue;
      const bal = p.stockBalances[0];
      const qty = Math.max(0, bal?.physicalQty ?? 0);
      if (qty <= 0) continue;
      const { daysRemaining, severity } = classify(p.expiryDate);
      items.push({
        batchId: null,
        productId: p.id,
        productName: p.name,
        sku: p.sku,
        unit: p.unit,
        batchNumber: null,
        expiryDate: p.expiryDate.toISOString(),
        remainingQty: qty,
        initialQty: qty,
        daysRemaining,
        severity,
        estimatedLossCostXof: (p.costPriceXof ?? 0) * qty,
        notes: null,
      });
    }

    items.sort((a, b) => a.expiryDate.localeCompare(b.expiryDate));

    return {
      summary: {
        expiredCount: items.filter((i) => i.severity === 'EXPIRED').length,
        expiring7dCount: items.filter((i) => i.severity === 'EXPIRING_7D').length,
        expiring30dCount: items.filter((i) => i.severity === 'EXPIRING_30D').length,
        totalTrackedBatches: items.length,
        expiredEstimatedCostXof: items
          .filter((i) => i.severity === 'EXPIRED')
          .reduce((acc, i) => acc + i.estimatedLossCostXof, 0),
      },
      items,
    };
  }

  async createBatch(
    shopId: string,
    input: {
      productId: string;
      batchNumber?: string;
      expiryDate: string;
      quantity: number;
      notes?: string;
    },
    actor: AuthenticatedUser,
    operator: DeclaredOperatorContext | undefined,
    meta: RequestMeta,
  ) {
    const client = await this.shopDbManager.getClientForShop(shopId);
    const expiryDate = new Date(input.expiryDate);

    const created = await client.$transaction(async (tx) => {
      const product = await tx.product.findUnique({ where: { id: input.productId } });
      if (!product) {
        throw new NotFoundException({ code: 'PRODUCT_NOT_FOUND', message: 'Produit introuvable.' });
      }

      const batch = await tx.productBatch.create({
        data: {
          productId: product.id,
          batchNumber: input.batchNumber?.trim() || null,
          expiryDate,
          initialQty: input.quantity,
          remainingQty: input.quantity,
          status: 'ACTIVE',
          notes: input.notes?.trim() || null,
        },
      });

      await this.applyMovementInTx(tx, {
        productId: product.id,
        movementType: 'MANUAL_IN',
        quantityDelta: input.quantity,
        unitCostXof: product.costPriceXof,
        referenceType: 'PRODUCT_BATCH',
        referenceId: batch.id,
        reason: `Entrée lot${batch.batchNumber ? ` ${batch.batchNumber}` : ''} (DLC ${expiryDate.toISOString().slice(0, 10)})`,
        actorUserId: actor.userId,
        declaredOperatorId: operator?.id ?? null,
        declaredOperatorName: operator?.firstName ?? null,
      });

      await this.syncProductEarliestExpiryInTx(tx, product.id);
      return batch;
    });

    await this.auditService.recordShop({
      shopId,
      actorUserId: actor.userId,
      actorRole: actor.role,
      declaredOperatorId: operator?.id ?? null,
      declaredOperatorName: operator?.firstName ?? null,
      action: 'PRODUCT_BATCH_CREATED',
      entityType: 'ProductBatch',
      entityId: created.id,
      afterData: {
        productId: created.productId,
        batchNumber: created.batchNumber,
        expiryDate: created.expiryDate.toISOString(),
        quantity: created.initialQty,
      },
      ipAddress: meta.ipAddress,
      userAgent: meta.userAgent,
      correlationId: meta.correlationId,
    });

    return {
      ...created,
      expiryDate: created.expiryDate.toISOString(),
      createdAt: created.createdAt.toISOString(),
    };
  }

  /**
   * Mise au rebut atomique d'un lot périmé/endommagé (Lot 10) :
   * Décrémente le stock en `RETURN_DAMAGED_LOSS` et marque le lot `WRITTEN_OFF`.
   */
  async writeOffBatch(
    shopId: string,
    batchId: string,
    input: { reason: string },
    actor: AuthenticatedUser,
    operator: DeclaredOperatorContext | undefined,
    meta: RequestMeta,
  ) {
    const client = await this.shopDbManager.getClientForShop(shopId);

    const result = await client.$transaction(async (tx) => {
      const batch = await tx.productBatch.findUnique({
        where: { id: batchId },
        include: { product: { select: { id: true, name: true, costPriceXof: true } } },
      });
      if (!batch) {
        throw new NotFoundException({ code: 'BATCH_NOT_FOUND', message: 'Lot introuvable.' });
      }
      if (batch.status !== 'ACTIVE' || batch.remainingQty <= 0) {
        throw new ConflictException({
          code: 'BATCH_ALREADY_CLOSED',
          message: 'Ce lot est déjà épuisé ou mis au rebut.',
        });
      }

      const bal = await tx.stockBalance.findUnique({
        where: { productId_variantKey: { productId: batch.productId, variantKey: 'BASE' } },
      });
      const available = Math.max(0, (bal?.physicalQty ?? 0) - (bal?.reservedQty ?? 0));
      const qtyToDeduct = Math.min(batch.remainingQty, available);

      if (qtyToDeduct > 0) {
        await this.applyMovementInTx(tx, {
          productId: batch.productId,
          movementType: 'RETURN_DAMAGED_LOSS',
          quantityDelta: -qtyToDeduct,
          unitCostXof: batch.product.costPriceXof,
          referenceType: 'BATCH_WRITE_OFF',
          referenceId: batch.id,
          reason: `Mise au rebut lot${batch.batchNumber ? ` ${batch.batchNumber}` : ''} (DLC ${batch.expiryDate.toISOString().slice(0, 10)}) : ${input.reason}`,
          actorUserId: actor.userId,
          declaredOperatorId: operator?.id ?? null,
          declaredOperatorName: operator?.firstName ?? null,
          allowNegativeStock: false,
        });
      }

      const writtenOff = await tx.productBatch.update({
        where: { id: batch.id },
        data: {
          remainingQty: 0,
          status: 'WRITTEN_OFF',
          notes: input.reason,
        },
      });

      await this.syncProductEarliestExpiryInTx(tx, batch.productId);
      return {
        batch: writtenOff,
        productName: batch.product.name,
        writtenOffQty: batch.remainingQty,
        stockDeductedQty: qtyToDeduct,
      };
    });

    await this.auditService.recordShop({
      shopId,
      actorUserId: actor.userId,
      actorRole: actor.role,
      declaredOperatorId: operator?.id ?? null,
      declaredOperatorName: operator?.firstName ?? null,
      action: 'BATCH_WRITTEN_OFF',
      entityType: 'ProductBatch',
      entityId: batchId,
      afterData: {
        productName: result.productName,
        writtenOffQty: result.writtenOffQty,
        stockDeductedQty: result.stockDeductedQty,
      },
      reason: input.reason,
      ipAddress: meta.ipAddress,
      userAgent: meta.userAgent,
      correlationId: meta.correlationId,
    });

    return {
      id: result.batch.id,
      status: result.batch.status,
      writtenOffQty: result.writtenOffQty,
      stockDeductedQty: result.stockDeductedQty,
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

  @Get('expiry-alerts')
  @Roles('OWNER', 'AGENT')
  @RequirePermissions('stock:read')
  @ApiOperation({ summary: 'Consulter les alertes de dates de péremption (DLC) et lots actifs' })
  expiryAlerts(@Param('shopId') shopId: string) {
    return this.inventoryService.getExpiryAlerts(shopId);
  }

  @Post('batches')
  @Roles('OWNER', 'AGENT')
  @RequirePermissions('stock:adjust')
  @RequireOperator()
  @ApiOperation({ summary: 'Enregistrer un nouveau lot avec date de péremption (DLC) et créditer le stock' })
  createBatch(
    @Param('shopId') shopId: string,
    @Body(new ZodValidationPipe(createProductBatchSchema)) body: any,
    @CurrentUser() user: AuthenticatedUser,
    @CurrentOperator() operator: DeclaredOperatorContext | undefined,
    @Req() req: RequestWithAuth,
  ) {
    return this.inventoryService.createBatch(shopId, body, user, operator, {
      ipAddress: req.ip || null,
      userAgent: req.header('user-agent') || null,
      correlationId: req.correlationId || null,
    });
  }

  @Post('batches/:batchId/write-off')
  @Roles('OWNER', 'AGENT')
  @RequirePermissions('stock:adjust')
  @RequireOperator(true)
  @ApiOperation({ summary: 'Mettre au rebut un lot périmé/endommagé (sortie en perte tracée)' })
  writeOffBatch(
    @Param('shopId') shopId: string,
    @Param('batchId') batchId: string,
    @Body(new ZodValidationPipe(writeOffBatchSchema)) body: any,
    @CurrentUser() user: AuthenticatedUser,
    @CurrentOperator() operator: DeclaredOperatorContext | undefined,
    @Req() req: RequestWithAuth,
  ) {
    return this.inventoryService.writeOffBatch(shopId, batchId, body, user, operator, {
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
