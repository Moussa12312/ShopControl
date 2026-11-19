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
  Req,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import {
  calculateWeightedAverageCost,
  createTransferSchema,
  receiveTransferSchema,
  rejectTransferSchema,
} from '@shopcontrol/shared';
import { CurrentUser, Roles } from '../../common/auth/auth.decorators';
import { AuthenticatedUser, RequestWithAuth } from '../../common/auth/request-context.types';
import { ControlPrismaService } from '../../common/database/control-prisma.service';
import { ShopDatabaseManagerService } from '../../common/database/shop-database-manager.service';
import { ZodValidationPipe } from '../../common/validation/zod-validation.pipe';
import { AuditService } from '../audit/audit.service';
import { InventoryService } from '../inventory/inventory.module';
import { NotificationsService } from '../notifications/notifications.module';
import { RequestMeta } from '../auth/auth.service';

@Injectable()
export class TransfersService {
  constructor(
    private readonly controlPrisma: ControlPrismaService,
    private readonly shopDbManager: ShopDatabaseManagerService,
    private readonly inventoryService: InventoryService,
    private readonly auditService: AuditService,
    private readonly notificationsService: NotificationsService,
  ) {}

  async listTransfers(user: AuthenticatedUser) {
    if (!user.merchantId) {
      throw new ForbiddenException({ code: 'MERCHANT_REQUIRED', message: 'Marchand requis.' });
    }

    const where: Record<string, unknown> = { merchantId: user.merchantId };
    if (user.role === 'AGENT') {
      const shopId = user.shopAccesses[0]?.shopId;
      if (!shopId) return [];
      where.OR = [{ sourceShopId: shopId }, { destShopId: shopId }];
    }

    const transfers = await this.controlPrisma.stockTransfer.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      take: 100,
      include: {
        sourceShop: { select: { id: true, name: true } },
        destShop: { select: { id: true, name: true } },
        items: true,
      },
    });

    return transfers.map((t) => ({
      ...t,
      approvedAt: t.approvedAt?.toISOString() ?? null,
      dispatchedAt: t.dispatchedAt?.toISOString() ?? null,
      receivedAt: t.receivedAt?.toISOString() ?? null,
      createdAt: t.createdAt.toISOString(),
      updatedAt: t.updatedAt.toISOString(),
    }));
  }

  async createTransfer(
    input: {
      sourceShopId: string;
      destShopId: string;
      notes?: string;
      items: Array<{ sourceProductId: string; requestedQty: number }>;
    },
    actor: AuthenticatedUser,
    meta: RequestMeta,
  ) {
    if (!actor.merchantId) {
      throw new ForbiddenException({ code: 'MERCHANT_REQUIRED', message: 'Marchand requis.' });
    }
    if (input.sourceShopId === input.destShopId) {
      throw new BadRequestException({
        code: 'SAME_SHOP_TRANSFER',
        message: 'La boutique source et la boutique destination doivent être différentes.',
      });
    }

    if (actor.role === 'AGENT') {
      const access = actor.shopAccesses[0];
      if (!access?.permissions['transfers:request']) {
        throw new ForbiddenException({
          code: 'PERMISSION_DENIED',
          message: 'Vous n’avez pas la permission de demander un transfert.',
        });
      }
      if (access.shopId !== input.sourceShopId && access.shopId !== input.destShopId) {
        throw new ForbiddenException({
          code: 'SHOP_ACCESS_DENIED',
          message: 'Vous ne pouvez initier un transfert que concernant votre boutique.',
        });
      }
    }

    const [sourceShop, destShop] = await Promise.all([
      this.controlPrisma.shop.findFirst({
        where: { id: input.sourceShopId, merchantId: actor.merchantId },
      }),
      this.controlPrisma.shop.findFirst({
        where: { id: input.destShopId, merchantId: actor.merchantId },
      }),
    ]);

    if (!sourceShop || !destShop) {
      throw new NotFoundException({
        code: 'SHOP_NOT_FOUND',
        message: 'Une des boutiques sélectionnées est introuvable dans votre entreprise.',
      });
    }

    const sourceClient = await this.shopDbManager.getClientForShop(sourceShop.id);
    const resolvedItems: Array<{
      sourceProductId: string;
      productSku: string;
      productName: string;
      salePriceXof: number;
      unitCostXof: number | null;
      requestedQty: number;
    }> = [];

    for (const reqItem of input.items) {
      const prod = await sourceClient.product.findUnique({ where: { id: reqItem.sourceProductId } });
      if (!prod) {
        throw new NotFoundException({
          code: 'PRODUCT_NOT_FOUND',
          message: 'Un produit source est introuvable.',
        });
      }
      resolvedItems.push({
        sourceProductId: prod.id,
        productSku: prod.sku,
        productName: prod.name,
        salePriceXof: prod.salePriceXof,
        unitCostXof: prod.costPriceXof,
        requestedQty: reqItem.requestedQty,
      });
    }

    const seqRows = await this.controlPrisma.$queryRaw<Array<{ nextval: bigint }>>`SELECT nextval('transfer_number_seq')`;
    const transferNumber = `TRF-${String(Number(seqRows[0].nextval)).padStart(6, '0')}`;

    const created = await this.controlPrisma.stockTransfer.create({
      data: {
        merchantId: actor.merchantId,
        transferNumber,
        sourceShopId: sourceShop.id,
        destShopId: destShop.id,
        status: 'PENDING_APPROVAL',
        requestedByUserId: actor.userId,
        notes: input.notes || null,
        items: {
          create: resolvedItems,
        },
      },
      include: {
        sourceShop: { select: { id: true, name: true } },
        destShop: { select: { id: true, name: true } },
        items: true,
      },
    });

    await this.auditService.recordControl({
      merchantId: actor.merchantId,
      shopId: sourceShop.id,
      actorUserId: actor.userId,
      actorRole: actor.role,
      action: 'TRANSFER_REQUESTED',
      entityType: 'StockTransfer',
      entityId: created.id,
      afterData: { transferNumber, source: sourceShop.name, dest: destShop.name, itemsCount: resolvedItems.length },
      ipAddress: meta.ipAddress,
      userAgent: meta.userAgent,
      correlationId: meta.correlationId,
    });

    await this.notificationsService.notifyMerchantOwners(actor.merchantId, {
      shopId: sourceShop.id,
      type: 'TRANSFER',
      priority: 'WARNING',
      title: `Transfert à valider : ${transferNumber}`,
      message: `Demande de transfert de ${sourceShop.name} vers ${destShop.name} (${resolvedItems.length} article(s)).`,
      targetPath: '/commerce/transfers',
    });

    return created;
  }

  /**
   * Validation exclusive par le Propriétaire (Arbitrage #9, Critère #5).
   */
  async approveTransfer(transferId: string, actor: AuthenticatedUser, meta: RequestMeta) {
    const trf = await this.controlPrisma.stockTransfer.findFirst({
      where: { id: transferId, merchantId: actor.merchantId ?? '' },
      include: { sourceShop: true, destShop: true },
    });
    if (!trf) {
      throw new NotFoundException({ code: 'TRANSFER_NOT_FOUND', message: 'Transfert introuvable.' });
    }
    if (trf.status !== 'PENDING_APPROVAL') {
      throw new ConflictException({
        code: 'TRANSFER_INVALID_STATE',
        message: 'Seule une demande en attente peut être validée.',
      });
    }

    const updated = await this.controlPrisma.stockTransfer.update({
      where: { id: trf.id },
      data: {
        status: 'APPROVED',
        approvedByUserId: actor.userId,
        approvedAt: new Date(),
      },
      include: { sourceShop: { select: { id: true, name: true } }, destShop: { select: { id: true, name: true } }, items: true },
    });

    await this.auditService.recordControl({
      merchantId: trf.merchantId,
      shopId: trf.sourceShopId,
      actorUserId: actor.userId,
      actorRole: actor.role,
      action: 'TRANSFER_APPROVED',
      entityType: 'StockTransfer',
      entityId: trf.id,
      afterData: { transferNumber: trf.transferNumber },
      ipAddress: meta.ipAddress,
      userAgent: meta.userAgent,
      correlationId: meta.correlationId,
    });

    return updated;
  }

  async rejectTransfer(transferId: string, reason: string, actor: AuthenticatedUser, meta: RequestMeta) {
    const trf = await this.controlPrisma.stockTransfer.findFirst({
      where: { id: transferId, merchantId: actor.merchantId ?? '' },
    });
    if (!trf) {
      throw new NotFoundException({ code: 'TRANSFER_NOT_FOUND', message: 'Transfert introuvable.' });
    }
    if (trf.status !== 'PENDING_APPROVAL') {
      throw new ConflictException({
        code: 'TRANSFER_INVALID_STATE',
        message: 'Seule une demande en attente peut être refusée.',
      });
    }

    const updated = await this.controlPrisma.stockTransfer.update({
      where: { id: trf.id },
      data: { status: 'REJECTED', rejectedReason: reason },
      include: { sourceShop: { select: { id: true, name: true } }, destShop: { select: { id: true, name: true } }, items: true },
    });

    await this.auditService.recordControl({
      merchantId: trf.merchantId,
      shopId: trf.sourceShopId,
      actorUserId: actor.userId,
      actorRole: actor.role,
      action: 'TRANSFER_REJECTED',
      entityType: 'StockTransfer',
      entityId: trf.id,
      reason,
      ipAddress: meta.ipAddress,
      userAgent: meta.userAgent,
      correlationId: meta.correlationId,
    });

    return updated;
  }

  /**
   * Expédition (Critères #5 & #20) :
   * - STRICTEMENT refusée si le transfert n'a pas été validé (`APPROVED`) par le propriétaire !
   * - Décrémente le stock de la boutique source (`TRANSFER_OUT`) et passe les articles en transit.
   */
  async dispatchTransfer(transferId: string, actor: AuthenticatedUser, meta: RequestMeta) {
    const trf = await this.controlPrisma.stockTransfer.findFirst({
      where: { id: transferId, merchantId: actor.merchantId ?? '' },
      include: { sourceShop: true, destShop: true, items: true },
    });
    if (!trf) {
      throw new NotFoundException({ code: 'TRANSFER_NOT_FOUND', message: 'Transfert introuvable.' });
    }
    if (trf.status !== 'APPROVED') {
      throw new ForbiddenException({
        code: 'TRANSFER_NOT_APPROVED',
        message: 'Impossible d’expédier : un transfert doit obligatoirement être validé par le propriétaire.',
      });
    }

    if (actor.role === 'AGENT') {
      const access = actor.shopAccesses.find((s) => s.shopId === trf.sourceShopId);
      if (!access || (!access.permissions['stock:move'] && !access.permissions['transfers:request'])) {
        throw new ForbiddenException({
          code: 'PERMISSION_DENIED',
          message: 'Vous n’avez pas la permission d’expédier depuis cette boutique source.',
        });
      }
    }

    const sourceClient = await this.shopDbManager.getClientForShop(trf.sourceShopId);
    await sourceClient.$transaction(async (tx) => {
      for (const item of trf.items) {
        await this.inventoryService.applyMovementInTx(tx, {
          productId: item.sourceProductId,
          movementType: 'TRANSFER_OUT',
          quantityDelta: -item.requestedQty,
          unitCostXof: item.unitCostXof,
          referenceType: 'TRANSFER',
          referenceId: trf.transferNumber,
          reason: `Expédition transfert ${trf.transferNumber} vers ${trf.destShop.name}`,
          actorUserId: actor.userId,
        });
      }
    });

    const updated = await this.controlPrisma.$transaction(async (tx) => {
      for (const item of trf.items) {
        await tx.stockTransferItem.update({
          where: { id: item.id },
          data: { dispatchedQty: item.requestedQty },
        });
      }
      return tx.stockTransfer.update({
        where: { id: trf.id },
        data: {
          status: 'IN_TRANSIT',
          dispatchedByUserId: actor.userId,
          dispatchedAt: new Date(),
        },
        include: { sourceShop: { select: { id: true, name: true } }, destShop: { select: { id: true, name: true } }, items: true },
      });
    });

    await this.auditService.recordShop({
      shopId: trf.sourceShopId,
      actorUserId: actor.userId,
      actorRole: actor.role,
      action: 'TRANSFER_DISPATCHED',
      entityType: 'StockTransfer',
      entityId: trf.id,
      afterData: { transferNumber: trf.transferNumber, destShop: trf.destShop.name },
      ipAddress: meta.ipAddress,
      userAgent: meta.userAgent,
      correlationId: meta.correlationId,
    });

    return updated;
  }

  /**
   * Réception dans la boutique destination (Critère #20) :
   * - Crédite le stock destination de la quantité RÉELLEMENT reçue
   * - Crée automatiquement le produit par SKU dans la BDD destination s'il n'y existe pas encore
   * - Trace tout écart (`receivedQty !== dispatchedQty`) et envoie une alerte URGENTE au Propriétaire !
   */
  async receiveTransfer(
    transferId: string,
    input: {
      notes?: string;
      items: Array<{ itemId: string; receivedQty: number; discrepancyReason?: string }>;
    },
    actor: AuthenticatedUser,
    meta: RequestMeta,
  ) {
    const trf = await this.controlPrisma.stockTransfer.findFirst({
      where: { id: transferId, merchantId: actor.merchantId ?? '' },
      include: { sourceShop: true, destShop: true, items: true },
    });
    if (!trf) {
      throw new NotFoundException({ code: 'TRANSFER_NOT_FOUND', message: 'Transfert introuvable.' });
    }
    if (trf.status !== 'IN_TRANSIT') {
      throw new ConflictException({
        code: 'TRANSFER_NOT_IN_TRANSIT',
        message: 'Seul un transfert en transit peut être réceptionné.',
      });
    }

    if (actor.role === 'AGENT') {
      const access = actor.shopAccesses.find((s) => s.shopId === trf.destShopId);
      if (!access || !access.permissions['stock:receive']) {
        throw new ForbiddenException({
          code: 'PERMISSION_DENIED',
          message: 'Vous n’avez pas la permission de réceptionner pour cette boutique.',
        });
      }
    }

    const destClient = await this.shopDbManager.getClientForShop(trf.destShopId);
    const inputMap = new Map(input.items.map((i) => [i.itemId, i]));
    let hasDiscrepancy = false;
    const destProductIdMap = new Map<string, string>();
    const discrepancySummary: string[] = [];

    await destClient.$transaction(async (tx) => {
      for (const item of trf.items) {
        const rec = inputMap.get(item.id);
        const receivedQty = rec ? rec.receivedQty : item.dispatchedQty;
        if (receivedQty !== item.dispatchedQty) {
          hasDiscrepancy = true;
          discrepancySummary.push(
            `${item.productName}: expédié ${item.dispatchedQty}, reçu ${receivedQty}`,
          );
        }

        // Trouve ou crée le produit par SKU dans la BDD dédiée de la boutique destination
        let destProd = await tx.product.findUnique({ where: { sku: item.productSku } });
        if (!destProd) {
          destProd = await tx.product.create({
            data: {
              name: item.productName,
              sku: item.productSku,
              salePriceXof: item.salePriceXof,
              costPriceXof: item.unitCostXof,
              status: 'PUBLISHED',
            },
          });
        }
        destProductIdMap.set(item.id, destProd.id);

        if (receivedQty > 0) {
          // Recalcul du CMP destination si coût unitaire renseigné
          if (item.unitCostXof !== null) {
            const bal = await tx.stockBalance.findUnique({
              where: { productId_variantKey: { productId: destProd.id, variantKey: 'BASE' } },
            });
            const newCmp = calculateWeightedAverageCost(
              Math.max(0, bal?.physicalQty ?? 0),
              destProd.costPriceXof,
              receivedQty,
              item.unitCostXof,
            );
            await tx.product.update({ where: { id: destProd.id }, data: { costPriceXof: newCmp } });
          }

          await this.inventoryService.applyMovementInTx(tx, {
            productId: destProd.id,
            movementType: 'TRANSFER_IN',
            quantityDelta: receivedQty,
            unitCostXof: item.unitCostXof,
            referenceType: 'TRANSFER',
            referenceId: trf.transferNumber,
            reason: `Réception transfert ${trf.transferNumber} depuis ${trf.sourceShop.name}`,
            actorUserId: actor.userId,
          });
        }
      }
    });

    const updated = await this.controlPrisma.$transaction(async (tx) => {
      for (const item of trf.items) {
        const rec = inputMap.get(item.id);
        const receivedQty = rec ? rec.receivedQty : item.dispatchedQty;
        await tx.stockTransferItem.update({
          where: { id: item.id },
          data: {
            destProductId: destProductIdMap.get(item.id) ?? null,
            receivedQty,
            discrepancyReason: rec?.discrepancyReason || null,
          },
        });
      }
      return tx.stockTransfer.update({
        where: { id: trf.id },
        data: {
          status: hasDiscrepancy ? 'RECEIVED_WITH_DISCREPANCY' : 'RECEIVED',
          hasDiscrepancy,
          receivedByUserId: actor.userId,
          receivedAt: new Date(),
          notes: input.notes || trf.notes,
        },
        include: { sourceShop: { select: { id: true, name: true } }, destShop: { select: { id: true, name: true } }, items: true },
      });
    });

    await this.auditService.recordShop({
      shopId: trf.destShopId,
      actorUserId: actor.userId,
      actorRole: actor.role,
      action: hasDiscrepancy ? 'TRANSFER_RECEIVED_DISCREPANCY' : 'TRANSFER_RECEIVED',
      entityType: 'StockTransfer',
      entityId: trf.id,
      afterData: { transferNumber: trf.transferNumber, hasDiscrepancy, discrepancySummary },
      ipAddress: meta.ipAddress,
      userAgent: meta.userAgent,
      correlationId: meta.correlationId,
    });

    if (hasDiscrepancy) {
      await this.notificationsService.notifyMerchantOwners(trf.merchantId, {
        shopId: trf.destShopId,
        type: 'TRANSFER',
        priority: 'URGENT',
        title: `Écart détecté sur transfert ${trf.transferNumber}`,
        message: `Réception ${trf.destShop.name} avec écart : ${discrepancySummary.join(' ; ')}.`,
        targetPath: '/commerce/transfers',
      });
    }

    return updated;
  }
}

@ApiTags('Transferts Multi-Boutiques (Lot 4)')
@ApiBearerAuth()
@Controller('transfers')
export class TransfersController {
  constructor(private readonly transfersService: TransfersService) {}

  @Get()
  @Roles('OWNER', 'AGENT')
  @ApiOperation({ summary: 'Lister les transferts de stock (tous pour le Propriétaire, scopé boutique pour Agent)' })
  list(@CurrentUser() user: AuthenticatedUser) {
    return this.transfersService.listTransfers(user);
  }

  @Post()
  @Roles('OWNER', 'AGENT')
  @ApiOperation({ summary: 'Créer une demande de transfert inter-boutiques (statut en attente de validation)' })
  create(
    @Body(new ZodValidationPipe(createTransferSchema)) body: any,
    @CurrentUser() user: AuthenticatedUser,
    @Req() req: RequestWithAuth,
  ) {
    return this.transfersService.createTransfer(body, user, {
      ipAddress: req.ip || null,
      userAgent: req.header('user-agent') || null,
      correlationId: req.correlationId || null,
    });
  }

  @Post(':transferId/approve')
  @Roles('OWNER')
  @ApiOperation({ summary: 'Valider un transfert (Propriétaire uniquement — Arbitrage #9)' })
  approve(
    @Param('transferId') transferId: string,
    @CurrentUser() user: AuthenticatedUser,
    @Req() req: RequestWithAuth,
  ) {
    return this.transfersService.approveTransfer(transferId, user, {
      ipAddress: req.ip || null,
      userAgent: req.header('user-agent') || null,
      correlationId: req.correlationId || null,
    });
  }

  @Post(':transferId/reject')
  @Roles('OWNER')
  @ApiOperation({ summary: 'Refuser un transfert avec motif obligatoire' })
  reject(
    @Param('transferId') transferId: string,
    @Body(new ZodValidationPipe(rejectTransferSchema)) body: { reason: string },
    @CurrentUser() user: AuthenticatedUser,
    @Req() req: RequestWithAuth,
  ) {
    return this.transfersService.rejectTransfer(transferId, body.reason, user, {
      ipAddress: req.ip || null,
      userAgent: req.header('user-agent') || null,
      correlationId: req.correlationId || null,
    });
  }

  @Post(':transferId/dispatch')
  @Roles('OWNER', 'AGENT')
  @ApiOperation({ summary: 'Expédier un transfert validé (décrémente stock source -> en transit)' })
  dispatch(
    @Param('transferId') transferId: string,
    @CurrentUser() user: AuthenticatedUser,
    @Req() req: RequestWithAuth,
  ) {
    return this.transfersService.dispatchTransfer(transferId, user, {
      ipAddress: req.ip || null,
      userAgent: req.header('user-agent') || null,
      correlationId: req.correlationId || null,
    });
  }

  @Post(':transferId/receive')
  @Roles('OWNER', 'AGENT')
  @ApiOperation({ summary: 'Réceptionner un transfert en transit (crédite destination + trace écarts)' })
  receive(
    @Param('transferId') transferId: string,
    @Body(new ZodValidationPipe(receiveTransferSchema)) body: any,
    @CurrentUser() user: AuthenticatedUser,
    @Req() req: RequestWithAuth,
  ) {
    return this.transfersService.receiveTransfer(transferId, body, user, {
      ipAddress: req.ip || null,
      userAgent: req.header('user-agent') || null,
      correlationId: req.correlationId || null,
    });
  }
}

@Module({
  controllers: [TransfersController],
  providers: [TransfersService],
  exports: [TransfersService],
})
export class TransfersModule {}
