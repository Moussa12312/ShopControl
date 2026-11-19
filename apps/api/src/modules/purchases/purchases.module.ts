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
  calculateWeightedAverageCost,
  createPurchaseOrderSchema,
  createSupplierSchema,
  receivePurchaseOrderSchema,
  supplierPaymentSchema,
  updateSupplierSchema,
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
import { ShopDatabaseManagerService } from '../../common/database/shop-database-manager.service';
import { OperatorGuard } from '../../common/guards/operator.guard';
import { PermissionsGuard } from '../../common/guards/permissions.guard';
import { ShopScopeGuard } from '../../common/guards/shop-scope.guard';
import { ZodValidationPipe } from '../../common/validation/zod-validation.pipe';
import { AuditService } from '../audit/audit.service';
import { CashService } from '../cash/cash.module';
import { InventoryService } from '../inventory/inventory.module';
import { RequestMeta } from '../auth/auth.service';

@Injectable()
export class PurchasesService {
  constructor(
    private readonly shopDbManager: ShopDatabaseManagerService,
    private readonly inventoryService: InventoryService,
    private readonly cashService: CashService,
    private readonly auditService: AuditService,
  ) {}

  async listSuppliers(shopId: string) {
    const client = await this.shopDbManager.getClientForShop(shopId);
    const suppliers = await client.supplier.findMany({
      orderBy: [{ isActive: 'desc' }, { name: 'asc' }],
      include: {
        purchaseOrders: {
          where: { status: { not: 'CANCELLED' } },
          select: { totalReceivedXof: true, totalPaidXof: true },
        },
      },
    });

    return suppliers.map((s) => {
      const totalReceivedXof = s.purchaseOrders.reduce((acc, po) => acc + po.totalReceivedXof, 0);
      const totalPaidXof = s.purchaseOrders.reduce((acc, po) => acc + po.totalPaidXof, 0);
      return {
        id: s.id,
        name: s.name,
        phone: s.phone,
        email: s.email,
        address: s.address,
        notes: s.notes,
        isActive: s.isActive,
        totalReceivedXof,
        totalPaidXof,
        debtBalanceXof: Math.max(0, totalReceivedXof - totalPaidXof),
        createdAt: s.createdAt.toISOString(),
      };
    });
  }

  async createSupplier(shopId: string, input: any) {
    const client = await this.shopDbManager.getClientForShop(shopId);
    return client.supplier.create({
      data: {
        name: input.name,
        phone: input.phone || null,
        email: input.email || null,
        address: input.address || null,
        notes: input.notes || null,
      },
    });
  }

  async updateSupplier(shopId: string, supplierId: string, input: any) {
    const client = await this.shopDbManager.getClientForShop(shopId);
    const existing = await client.supplier.findUnique({ where: { id: supplierId } });
    if (!existing) {
      throw new NotFoundException({ code: 'SUPPLIER_NOT_FOUND', message: 'Fournisseur introuvable.' });
    }
    return client.supplier.update({
      where: { id: supplierId },
      data: {
        ...(input.name !== undefined ? { name: input.name } : {}),
        ...(input.phone !== undefined ? { phone: input.phone || null } : {}),
        ...(input.email !== undefined ? { email: input.email || null } : {}),
        ...(input.address !== undefined ? { address: input.address || null } : {}),
        ...(input.notes !== undefined ? { notes: input.notes || null } : {}),
        ...(input.isActive !== undefined ? { isActive: input.isActive } : {}),
      },
    });
  }

  async listPurchaseOrders(shopId: string, status?: string) {
    const client = await this.shopDbManager.getClientForShop(shopId);
    const orders = await client.purchaseOrder.findMany({
      where: status ? { status } : undefined,
      orderBy: { createdAt: 'desc' },
      take: 50,
      include: {
        supplier: { select: { id: true, name: true, phone: true } },
        items: true,
        receipts: { orderBy: { createdAt: 'desc' } },
        payments: { orderBy: { createdAt: 'desc' } },
      },
    });

    return orders.map((po) => ({
      id: po.id,
      poNumber: po.poNumber,
      supplier: po.supplier,
      status: po.status,
      expectedDate: po.expectedDate?.toISOString() ?? null,
      notes: po.notes,
      totalOrderedXof: po.totalOrderedXof,
      totalReceivedXof: po.totalReceivedXof,
      totalPaidXof: po.totalPaidXof,
      debtDueXof: Math.max(0, po.totalReceivedXof - po.totalPaidXof),
      items: po.items,
      receiptsCount: po.receipts.length,
      paymentsCount: po.payments.length,
      createdAt: po.createdAt.toISOString(),
    }));
  }

  /**
   * Critère #4 : Créer une commande fournisseur NE MODIFIE PAS le stock.
   * Le stock n'est crédité qu'à l'étape de réception (`receivePurchaseOrder`).
   */
  async createPurchaseOrder(
    shopId: string,
    input: any,
    actor: AuthenticatedUser,
    operator: DeclaredOperatorContext | undefined,
    meta: RequestMeta,
  ) {
    const client = await this.shopDbManager.getClientForShop(shopId);

    const created = await client.$transaction(async (tx) => {
      const supplier = await tx.supplier.findUnique({ where: { id: input.supplierId } });
      if (!supplier) {
        throw new NotFoundException({ code: 'SUPPLIER_NOT_FOUND', message: 'Fournisseur introuvable.' });
      }

      const seqRows = await tx.$queryRaw<Array<{ nextval: bigint }>>`SELECT nextval('po_number_seq')`;
      const seqNum = Number(seqRows[0].nextval);
      const poNumber = `ACH-${String(seqNum).padStart(6, '0')}`;

      const enrichedItems: Array<{
        productId: string;
        variantId: string | null;
        productName: string;
        orderedQty: number;
        unitCostXof: number;
      }> = [];

      let totalOrderedXof = 0;
      for (const line of input.items) {
        const product = await tx.product.findUnique({ where: { id: line.productId } });
        if (!product) {
          throw new NotFoundException({
            code: 'PRODUCT_NOT_FOUND',
            message: `Produit introuvable (${line.productId}).`,
          });
        }
        enrichedItems.push({
          productId: product.id,
          variantId: line.variantId ?? null,
          productName: product.name,
          orderedQty: line.orderedQty,
          unitCostXof: line.unitCostXof,
        });
        totalOrderedXof += line.orderedQty * line.unitCostXof;
      }

      return tx.purchaseOrder.create({
        data: {
          poNumber,
          supplierId: supplier.id,
          status: input.submitImmediately ? 'ORDERED' : 'DRAFT',
          expectedDate: input.expectedDate ? new Date(input.expectedDate) : null,
          notes: input.notes || null,
          totalOrderedXof,
          actorUserId: actor.userId,
          declaredOperatorName: operator?.firstName ?? null,
          items: { create: enrichedItems },
        },
        include: { items: true, supplier: { select: { id: true, name: true } } },
      });
    });

    await this.auditService.recordShop({
      shopId,
      actorUserId: actor.userId,
      actorRole: actor.role,
      declaredOperatorId: operator?.id ?? null,
      declaredOperatorName: operator?.firstName ?? null,
      action: 'PURCHASE_ORDER_CREATED',
      entityType: 'PurchaseOrder',
      entityId: created.id,
      afterData: {
        poNumber: created.poNumber,
        supplierName: created.supplier.name,
        totalOrderedXof: created.totalOrderedXof,
      },
      ipAddress: meta.ipAddress,
      userAgent: meta.userAgent,
      correlationId: meta.correlationId,
    });

    return created;
  }

  /**
   * Réception partielle ou totale (Section 6.3, 6.5 & Critère #4) :
   * - Crédite uniquement les quantités réellement reçues
   * - Recalcule le Coût Moyen Pondéré (CMP) et journalise l'historique des coûts
   * - Met à jour le statut (`PARTIALLY_RECEIVED` ou `RECEIVED`)
   */
  async receivePurchaseOrder(
    shopId: string,
    poId: string,
    input: {
      notes?: string;
      items: Array<{
        purchaseOrderItemId: string;
        receivedQty: number;
        unitCostXof?: number;
        receivedInBulk?: boolean;
        expiryDate?: string | null;
        batchNumber?: string | null;
      }>;
    },
    actor: AuthenticatedUser,
    operator: DeclaredOperatorContext | undefined,
    meta: RequestMeta,
  ) {
    const client = await this.shopDbManager.getClientForShop(shopId);

    const receipt = await client.$transaction(async (tx) => {
      const po = await tx.purchaseOrder.findUnique({
        where: { id: poId },
        include: { items: true },
      });
      if (!po) {
        throw new NotFoundException({ code: 'PO_NOT_FOUND', message: 'Commande fournisseur introuvable.' });
      }
      if (po.status === 'CANCELLED' || po.status === 'RECEIVED') {
        throw new ConflictException({
          code: 'PO_NOT_RECEIVABLE',
          message: `Impossible de réceptionner une commande au statut ${po.status}.`,
        });
      }

      const seqRows = await tx.$queryRaw<Array<{ nextval: bigint }>>`SELECT nextval('receipt_number_seq')`;
      const receiptNumber = `REC-${String(Number(seqRows[0].nextval)).padStart(6, '0')}`;

      let receiptTotalCostXof = 0;
      const receiptLinesData: Array<{
        purchaseOrderItemId: string;
        productId: string;
        variantId: string | null;
        receivedQty: number;
        unitCostXof: number;
      }> = [];

      for (const reqLine of input.items) {
        const poItem = po.items.find((i) => i.id === reqLine.purchaseOrderItemId);
        if (!poItem) {
          throw new BadRequestException({
            code: 'PO_ITEM_NOT_FOUND',
            message: 'Ligne de commande introuvable.',
          });
        }
        const remaining = poItem.orderedQty - poItem.receivedQty;
        if (reqLine.receivedQty > remaining) {
          throw new BadRequestException({
            code: 'OVER_RECEIPT',
            message: `Quantité reçue (${reqLine.receivedQty}) supérieure au reliquat attendu (${remaining}) pour ${poItem.productName}.`,
          });
        }

        const product = await tx.product.findUniqueOrThrow({ where: { id: poItem.productId } });
        const unitCost = reqLine.unitCostXof ?? poItem.unitCostXof;
        receiptTotalCostXof += reqLine.receivedQty * unitCost;

        let unitsToCredit = reqLine.receivedQty;
        let retailUnitCost = unitCost;
        let bulkReasonSuffix = '';

        if (reqLine.receivedInBulk) {
          if (!product.unitsPerBulk || product.unitsPerBulk < 2) {
            throw new BadRequestException({
              code: 'BULK_NOT_CONFIGURED',
              message: `Le conditionnement de gros (unités par carton/sac) n’est pas configuré sur « ${product.name} ».`,
            });
          }
          unitsToCredit = reqLine.receivedQty * product.unitsPerBulk;
          retailUnitCost = Math.round(unitCost / product.unitsPerBulk);
          bulkReasonSuffix = ` (${reqLine.receivedQty} ${product.bulkUnitLabel || 'gros'} × ${product.unitsPerBulk} ${product.unit})`;
        }

        // Crédite le stock en unités de base (détail) via mouvement tracé
        const moveResult = await this.inventoryService.applyMovementInTx(tx, {
          productId: poItem.productId,
          variantId: poItem.variantId,
          movementType: 'PURCHASE_RECEIPT',
          quantityDelta: unitsToCredit,
          unitCostXof: retailUnitCost,
          referenceType: 'PURCHASE_RECEIPT',
          referenceId: receiptNumber,
          reason: `Réception ${po.poNumber}${bulkReasonSuffix}`,
          actorUserId: actor.userId,
          declaredOperatorId: operator?.id ?? null,
          declaredOperatorName: operator?.firstName ?? null,
        });

        // Recalcul du Coût Moyen Pondéré par unité de détail (CMP — Arbitrage #5)
        const previousCost = product.costPriceXof;
        const newCmp = calculateWeightedAverageCost(
          moveResult.qtyBefore,
          previousCost,
          unitsToCredit,
          retailUnitCost,
        );

        await tx.product.update({
          where: { id: poItem.productId },
          data: { costPriceXof: newCmp },
        });

        await tx.productCostHistory.create({
          data: {
            productId: poItem.productId,
            variantId: poItem.variantId,
            previousCostXof: previousCost,
            newCostXof: newCmp,
            receivedQty: unitsToCredit,
            receivedUnitCostXof: retailUnitCost,
            sourceType: 'PURCHASE_RECEIPT',
            sourceId: receiptNumber,
          },
        });

        // Création automatique du lot DLC si date de péremption fournie à la réception (Lot 10)
        if (reqLine.expiryDate) {
          const parsedExpiry = new Date(reqLine.expiryDate);
          await tx.productBatch.create({
            data: {
              productId: poItem.productId,
              batchNumber: reqLine.batchNumber?.trim() || receiptNumber,
              expiryDate: parsedExpiry,
              initialQty: unitsToCredit,
              remainingQty: unitsToCredit,
              status: 'ACTIVE',
              notes: `Réception fournisseur ${po.poNumber} (${receiptNumber})`,
            },
          });
          await this.inventoryService.syncProductEarliestExpiryInTx(tx, poItem.productId);
        }

        await tx.purchaseOrderItem.update({
          where: { id: poItem.id },
          data: { receivedQty: poItem.receivedQty + reqLine.receivedQty },
        });

        receiptLinesData.push({
          purchaseOrderItemId: poItem.id,
          productId: poItem.productId,
          variantId: poItem.variantId,
          receivedQty: reqLine.receivedQty,
          unitCostXof: unitCost,
        });
      }

      const createdReceipt = await tx.purchaseReceipt.create({
        data: {
          purchaseOrderId: po.id,
          receiptNumber,
          notes: input.notes || null,
          totalCostXof: receiptTotalCostXof,
          actorUserId: actor.userId,
          declaredOperatorId: operator?.id ?? null,
          declaredOperatorName: operator?.firstName ?? null,
          items: { create: receiptLinesData },
        },
        include: { items: true },
      });

      const refreshedItems = await tx.purchaseOrderItem.findMany({
        where: { purchaseOrderId: po.id },
      });
      const allReceived = refreshedItems.every((i) => i.receivedQty >= i.orderedQty);

      await tx.purchaseOrder.update({
        where: { id: po.id },
        data: {
          status: allReceived ? 'RECEIVED' : 'PARTIALLY_RECEIVED',
          totalReceivedXof: po.totalReceivedXof + receiptTotalCostXof,
        },
      });

      return createdReceipt;
    });

    await this.auditService.recordShop({
      shopId,
      actorUserId: actor.userId,
      actorRole: actor.role,
      declaredOperatorId: operator?.id ?? null,
      declaredOperatorName: operator?.firstName ?? null,
      action: 'PURCHASE_RECEIVED',
      entityType: 'PurchaseReceipt',
      entityId: receipt.id,
      afterData: {
        receiptNumber: receipt.receiptNumber,
        totalCostXof: receipt.totalCostXof,
        linesCount: receipt.items.length,
      },
      ipAddress: meta.ipAddress,
      userAgent: meta.userAgent,
      correlationId: meta.correlationId,
    });

    return receipt;
  }

  async paySupplier(
    shopId: string,
    poId: string,
    input: {
      amountXof: number;
      paymentMethodCode: string;
      transactionRef?: string;
      paidFromCashDrawer: boolean;
      notes?: string;
    },
    actor: AuthenticatedUser,
    operator: DeclaredOperatorContext | undefined,
    meta: RequestMeta,
  ) {
    const client = await this.shopDbManager.getClientForShop(shopId);

    const payment = await client.$transaction(async (tx) => {
      const po = await tx.purchaseOrder.findUnique({ where: { id: poId } });
      if (!po) {
        throw new NotFoundException({ code: 'PO_NOT_FOUND', message: 'Commande fournisseur introuvable.' });
      }
      const debtDue = Math.max(0, po.totalReceivedXof - po.totalPaidXof);
      if (input.amountXof > debtDue) {
        throw new BadRequestException({
          code: 'PAYMENT_EXCEEDS_DEBT',
          message: `Le montant (${input.amountXof} XOF) dépasse la dette restante sur cette commande (${debtDue} XOF).`,
        });
      }

      let cashMovementId: string | null = null;
      if (input.paidFromCashDrawer) {
        const openSession = await this.cashService.getOpenSessionInTx(tx);
        if (!openSession) {
          throw new BadRequestException({
            code: 'CASH_SESSION_REQUIRED',
            message: 'Aucune session de caisse ouverte pour un paiement espèces depuis la caisse.',
          });
        }
        const mv = await this.cashService.recordMovementInTx(tx, {
          sessionId: openSession.id,
          type: 'SUPPLIER_OUT',
          amountXof: input.amountXof,
          referenceType: 'PURCHASE_ORDER',
          referenceId: po.poNumber,
          reason: `Règlement fournisseur ${po.poNumber}`,
          actorUserId: actor.userId,
          declaredOperatorId: operator?.id ?? null,
          declaredOperatorName: operator?.firstName ?? null,
        });
        cashMovementId = mv.id;
      }

      const created = await tx.supplierPayment.create({
        data: {
          supplierId: po.supplierId,
          purchaseOrderId: po.id,
          amountXof: input.amountXof,
          paymentMethodCode: input.paymentMethodCode,
          transactionRef: input.transactionRef?.trim() || null,
          paidFromCashDrawer: input.paidFromCashDrawer,
          cashMovementId,
          notes: input.notes || null,
          actorUserId: actor.userId,
          declaredOperatorName: operator?.firstName ?? null,
        },
      });

      await tx.purchaseOrder.update({
        where: { id: po.id },
        data: { totalPaidXof: po.totalPaidXof + input.amountXof },
      });

      return created;
    });

    await this.auditService.recordShop({
      shopId,
      actorUserId: actor.userId,
      actorRole: actor.role,
      declaredOperatorId: operator?.id ?? null,
      declaredOperatorName: operator?.firstName ?? null,
      action: 'SUPPLIER_PAYMENT_RECORDED',
      entityType: 'SupplierPayment',
      entityId: payment.id,
      afterData: {
        purchaseOrderId: poId,
        amountXof: payment.amountXof,
        paymentMethodCode: payment.paymentMethodCode,
      },
      ipAddress: meta.ipAddress,
      userAgent: meta.userAgent,
      correlationId: meta.correlationId,
    });

    return payment;
  }
}

@ApiTags('Achats & Fournisseurs')
@ApiBearerAuth()
@Controller('shops/:shopId')
@UseGuards(ShopScopeGuard, PermissionsGuard, OperatorGuard)
export class PurchasesController {
  constructor(private readonly purchasesService: PurchasesService) {}

  @Get('suppliers')
  @Roles('OWNER', 'AGENT')
  @RequirePermissions('purchases:read')
  @ApiOperation({ summary: 'Lister les fournisseurs avec solde de dettes en cours' })
  listSuppliers(@Param('shopId') shopId: string) {
    return this.purchasesService.listSuppliers(shopId);
  }

  @Post('suppliers')
  @Roles('OWNER', 'AGENT')
  @RequirePermissions('purchases:create')
  @ApiOperation({ summary: 'Créer un fournisseur' })
  createSupplier(
    @Param('shopId') shopId: string,
    @Body(new ZodValidationPipe(createSupplierSchema)) body: any,
  ) {
    return this.purchasesService.createSupplier(shopId, body);
  }

  @Patch('suppliers/:supplierId')
  @Roles('OWNER', 'AGENT')
  @RequirePermissions('purchases:create')
  @ApiOperation({ summary: 'Modifier un fournisseur' })
  updateSupplier(
    @Param('shopId') shopId: string,
    @Param('supplierId') supplierId: string,
    @Body(new ZodValidationPipe(updateSupplierSchema)) body: any,
  ) {
    return this.purchasesService.updateSupplier(shopId, supplierId, body);
  }

  @Get('purchases')
  @Roles('OWNER', 'AGENT')
  @RequirePermissions('purchases:read')
  @ApiOperation({ summary: 'Lister les commandes fournisseurs' })
  listOrders(@Param('shopId') shopId: string, @Query('status') status?: string) {
    return this.purchasesService.listPurchaseOrders(shopId, status);
  }

  @Post('purchases')
  @Roles('OWNER', 'AGENT')
  @RequirePermissions('purchases:create')
  @ApiOperation({ summary: 'Créer une commande fournisseur (sans modifier le stock avant réception)' })
  createOrder(
    @Param('shopId') shopId: string,
    @Body(new ZodValidationPipe(createPurchaseOrderSchema)) body: any,
    @CurrentUser() user: AuthenticatedUser,
    @CurrentOperator() operator: DeclaredOperatorContext | undefined,
    @Req() req: RequestWithAuth,
  ) {
    return this.purchasesService.createPurchaseOrder(shopId, body, user, operator, {
      ipAddress: req.ip || null,
      userAgent: req.header('user-agent') || null,
      correlationId: req.correlationId || null,
    });
  }

  @Post('purchases/:poId/receive')
  @Roles('OWNER', 'AGENT')
  @RequirePermissions('purchases:receive')
  @RequireOperator()
  @ApiOperation({ summary: 'Réceptionner (partiellement ou totalement) une commande et recalculer le CMP' })
  receive(
    @Param('shopId') shopId: string,
    @Param('poId') poId: string,
    @Body(new ZodValidationPipe(receivePurchaseOrderSchema)) body: any,
    @CurrentUser() user: AuthenticatedUser,
    @CurrentOperator() operator: DeclaredOperatorContext | undefined,
    @Req() req: RequestWithAuth,
  ) {
    return this.purchasesService.receivePurchaseOrder(shopId, poId, body, user, operator, {
      ipAddress: req.ip || null,
      userAgent: req.header('user-agent') || null,
      correlationId: req.correlationId || null,
    });
  }

  @Post('purchases/:poId/payments')
  @Roles('OWNER')
  @ApiOperation({ summary: 'Enregistrer un règlement (partiel ou complet) de dette fournisseur' })
  paySupplier(
    @Param('shopId') shopId: string,
    @Param('poId') poId: string,
    @Body(new ZodValidationPipe(supplierPaymentSchema)) body: any,
    @CurrentUser() user: AuthenticatedUser,
    @CurrentOperator() operator: DeclaredOperatorContext | undefined,
    @Req() req: RequestWithAuth,
  ) {
    return this.purchasesService.paySupplier(shopId, poId, body, user, operator, {
      ipAddress: req.ip || null,
      userAgent: req.header('user-agent') || null,
      correlationId: req.correlationId || null,
    });
  }
}

@Module({
  controllers: [PurchasesController],
  providers: [PurchasesService],
})
export class PurchasesModule {}
