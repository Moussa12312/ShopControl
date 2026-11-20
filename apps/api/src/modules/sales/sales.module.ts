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
  calculateSaleTotals,
  cancelSaleSchema,
  createSaleRefundSchema,
  createSaleReturnSchema,
  createSaleSchema,
  DEFAULT_PAYMENT_METHODS,
  DEFAULT_RECEIPT_SETTINGS,
  formatXof,
  PaymentMethodConfig,
  TaxMode,
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
import { InventoryService } from '../inventory/inventory.module';
import { NotificationsService } from '../notifications/notifications.module';
import { RequestMeta } from '../auth/auth.service';

@Injectable()
export class SalesService {
  constructor(
    private readonly controlPrisma: ControlPrismaService,
    private readonly shopDbManager: ShopDatabaseManagerService,
    private readonly inventoryService: InventoryService,
    private readonly cashService: CashService,
    private readonly auditService: AuditService,
    private readonly notificationsService: NotificationsService,
  ) {}

  private canReadCosts(user: AuthenticatedUser, shopId: string): boolean {
    if (user.role === 'OWNER' || user.role === 'SUPER_ADMIN') return true;
    return Boolean(user.shopAccesses.find((s) => s.shopId === shopId)?.permissions['finance:read_margins']);
  }

  async listSales(
    shopId: string,
    user: AuthenticatedUser,
    params: { status?: string; search?: string; serial?: string; page?: number; limit?: number },
  ) {
    const client = await this.shopDbManager.getClientForShop(shopId);
    const page = Math.max(1, params.page || 1);
    const limit = Math.min(100, Math.max(1, params.limit || 25));
    const showCost = this.canReadCosts(user, shopId);

    const where: Record<string, unknown> = {};
    if (params.status) where.status = params.status;
    if (params.serial?.trim()) {
      where.lines = {
        some: {
          serialNumber: { contains: params.serial.trim(), mode: 'insensitive' },
        },
      };
    }
    if (params.search?.trim()) {
      const q = params.search.trim();
      where.OR = [
        { saleNumber: { contains: q, mode: 'insensitive' } },
        { client: { fullName: { contains: q, mode: 'insensitive' } } },
        { client: { phone: { contains: q, mode: 'insensitive' } } },
        { lines: { some: { serialNumber: { contains: q, mode: 'insensitive' } } } },
      ];
    }

    const [total, sales] = await Promise.all([
      client.sale.count({ where }),
      client.sale.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        skip: (page - 1) * limit,
        take: limit,
        include: {
          client: { select: { id: true, fullName: true, phone: true } },
          lines: true,
          payments: true,
          returns: true,
          refunds: true,
        },
      }),
    ]);

    return {
      items: sales.map((s) => ({
        id: s.id,
        saleNumber: s.saleNumber,
        status: s.status,
        offlineSynced: s.offlineSynced,
        stockConflict: s.stockConflict,
        client: s.client,
        grossSubtotalXof: s.grossSubtotalXof,
        discountTotalXof: s.discountTotalXof,
        taxMode: s.taxMode,
        taxTotalXof: s.taxTotalXof,
        roundingXof: s.roundingXof,
        totalXof: s.totalXof,
        paidAmountXof: s.paidAmountXof,
        dueAmountXof: s.dueAmountXof,
        refundedAmountXof: s.refundedAmountXof,
        cancelReason: s.cancelReason,
        declaredOperatorName: s.declaredOperatorName,
        lines: s.lines.map((l) => ({
          ...l,
          unitCostXof: showCost ? l.unitCostXof : null,
        })),
        payments: s.payments,
        refunds: s.refunds,
        returnsCount: s.returns.length,
        refundsCount: s.refunds.length,
        createdAt: s.createdAt.toISOString(),
      })),
      total,
      page,
      limit,
    };
  }

  /**
   * Validation atomique d'une vente au comptoir (Critères #3, #17, #23, #24)
   * ou synchronisation d'une vente hors-ligne Option B (Section 14.3).
   */
  async createSale(
    shopId: string,
    input: any,
    actor: AuthenticatedUser,
    operator: DeclaredOperatorContext | undefined,
    meta: RequestMeta,
    isOfflineSync = false,
  ) {
    const shop = await this.controlPrisma.shop.findUniqueOrThrow({ where: { id: shopId } });
    const paymentMethods = (
      Array.isArray(shop.paymentMethods) ? shop.paymentMethods : DEFAULT_PAYMENT_METHODS
    ) as PaymentMethodConfig[];

    const shopClient = await this.shopDbManager.getClientForShop(shopId);

    // Idempotence pour les reprises / synchronisations hors-ligne Option B
    if (input.clientOperationId) {
      const existingByOp = await shopClient.sale.findUnique({
        where: { clientOperationId: input.clientOperationId },
        include: { lines: true, payments: true, receivable: true },
      });
      if (existingByOp) {
        return existingByOp;
      }
    }

    const lowStockAlerts: Array<{ productName: string; availableAfter: number; threshold: number }> = [];
    const negativeConflicts: Array<{ productName: string; qtyAfter: number }> = [];

    const createdSale = await shopClient.$transaction(async (tx) => {
      // 1. Charge produits et résout prix/coûts, Gros/Détail, Vente au montant/fraction, N° de série & Garantie
      const resolvedLines: Array<{
        productId: string;
        variantId: string | null;
        productName: string;
        sku: string;
        quantity: number;
        unitLabel: string;
        soldInBulk: boolean;
        bulkMultiplier: number;
        fractionalQtyMilli: number | null;
        customAmountXof: number | null;
        stockDeductionMilli: number;
        serialNumber: string | null;
        warrantyMonths: number | null;
        warrantyEndsAt: Date | null;
        unitPriceXof: number;
        unitCostXof: number | null;
        discountType: 'NONE' | 'PERCENT' | 'AMOUNT';
        discountValue: number;
      }> = [];

      for (const reqLine of input.lines) {
        const product = await tx.product.findUnique({
          where: { id: reqLine.productId },
          include: { variants: true },
        });
        if (!product || product.status === 'ARCHIVED') {
          throw new NotFoundException({
            code: 'PRODUCT_UNAVAILABLE',
            message: 'Produit introuvable ou archivé.',
          });
        }

        let basePriceXof = product.salePriceXof;
        let baseCostXof = product.costPriceXof;
        let sku = product.sku;
        let baseDisplayName = product.name;

        if (reqLine.variantId) {
          const variant = product.variants.find((v) => v.id === reqLine.variantId && v.isActive);
          if (!variant) {
            throw new NotFoundException({ code: 'VARIANT_NOT_FOUND', message: 'Variante introuvable.' });
          }
          basePriceXof = variant.salePriceXof ?? product.salePriceXof;
          baseCostXof = variant.costPriceXof ?? product.costPriceXof;
          sku = variant.sku || product.sku;
          baseDisplayName = `${product.name} (${variant.name})`;
        }

        // Validation N° de série / IMEI & calcul Garantie (Lot 10)
        const serialNumber = reqLine.serialNumber?.trim() || null;
        if (product.trackSerialNumber && !serialNumber && !isOfflineSync) {
          throw new BadRequestException({
            code: 'SERIAL_NUMBER_REQUIRED',
            message: `Le numéro de série / IMEI est obligatoire pour « ${product.name} ».`,
          });
        }
        const warrantyMonths =
          product.warrantyMonths && product.warrantyMonths > 0 ? product.warrantyMonths : null;
        let warrantyEndsAt: Date | null = null;
        if (warrantyMonths) {
          warrantyEndsAt = new Date();
          warrantyEndsAt.setMonth(warrantyEndsAt.getMonth() + warrantyMonths);
        }

        let quantity = reqLine.quantity || 1;
        let unitPriceXof = basePriceXof;
        let unitCostXof = baseCostXof;
        let unitLabel = product.unit || 'unité';
        let soldInBulk = false;
        let bulkMultiplier = 1;
        let fractionalQtyMilli: number | null = null;
        let customAmountXof: number | null = null;
        let stockDeductionMilli = quantity * 1000;
        let displayName = baseDisplayName;

        if (reqLine.soldInBulk) {
          if (!product.unitsPerBulk || product.unitsPerBulk < 2) {
            throw new BadRequestException({
              code: 'BULK_NOT_CONFIGURED',
              message: `Le conditionnement de gros n’est pas configuré sur « ${product.name} ».`,
            });
          }
          soldInBulk = true;
          bulkMultiplier = product.unitsPerBulk;
          unitLabel = product.bulkUnitLabel || 'carton';
          unitPriceXof = product.bulkSalePriceXof ?? basePriceXof * bulkMultiplier;
          unitCostXof = baseCostXof !== null ? baseCostXof * bulkMultiplier : null;
          stockDeductionMilli = quantity * bulkMultiplier * 1000;
          displayName = `${baseDisplayName} [${unitLabel} ×${bulkMultiplier}]`;
        } else if (
          (reqLine.customAmountXof !== undefined && reqLine.customAmountXof !== null) ||
          (reqLine.fractionalQtyMilli !== undefined && reqLine.fractionalQtyMilli !== null)
        ) {
          const isWeightOrVolumeUnit = ['kg', 'g', 'l', 'litre', 'cl', 'ml', 'tonne', 't'].includes(
            (product.unit || '').trim().toLowerCase(),
          );
          if (!product.allowFractionalSale && !isWeightOrVolumeUnit) {
            throw new BadRequestException({
              code: 'FRACTIONAL_SALE_DISABLED',
              message: `La vente au montant / fraction n’est pas activée sur « ${product.name} ».`,
            });
          }
          if (basePriceXof <= 0) {
            throw new BadRequestException({
              code: 'INVALID_UNIT_PRICE',
              message: `Le prix unitaire de « ${product.name} » doit être supérieur à 0 XOF pour une vente au montant.`,
            });
          }

          let computedMilli: number;
          let computedAmount: number;
          if (reqLine.customAmountXof !== undefined && reqLine.customAmountXof !== null) {
            computedAmount = Number(reqLine.customAmountXof);
            computedMilli =
              reqLine.fractionalQtyMilli !== undefined && reqLine.fractionalQtyMilli !== null
                ? Number(reqLine.fractionalQtyMilli)
                : Math.max(1, Math.round((computedAmount * 1000) / basePriceXof));
          } else {
            computedMilli = Number(reqLine.fractionalQtyMilli);
            computedAmount = Math.max(
              1,
              Math.round((basePriceXof * computedMilli) / 1000),
            );
          }

          customAmountXof = computedAmount;
          fractionalQtyMilli = computedMilli;
          unitPriceXof = computedAmount;
          quantity = 1;
          unitCostXof =
            baseCostXof !== null ? Math.round((baseCostXof * computedMilli) / 1000) : null;
          stockDeductionMilli = computedMilli;
          const decStr = Number((computedMilli / 1000).toFixed(3))
            .toString()
            .replace('.', ',');
          unitLabel = `${decStr} ${product.unit}`;
          displayName = `${baseDisplayName} (${decStr} ${product.unit})`;
        }

        resolvedLines.push({
          productId: product.id,
          variantId: reqLine.variantId ?? null,
          productName: displayName,
          sku,
          quantity,
          unitLabel,
          soldInBulk,
          bulkMultiplier,
          fractionalQtyMilli,
          customAmountXof,
          stockDeductionMilli,
          serialNumber,
          warrantyMonths,
          warrantyEndsAt,
          unitPriceXof,
          unitCostXof,
          discountType: reqLine.discountType || 'NONE',
          discountValue: reqLine.discountValue || 0,
        });
      }

      // 2. Calcul strict en entiers XOF (Critère #23)
      const calc = calculateSaleTotals({
        lines: resolvedLines.map((l) => ({
          quantity: l.quantity,
          unitPriceXof: l.unitPriceXof,
          discountType: l.discountType,
          discountValue: l.discountValue,
        })),
        globalDiscountType: input.globalDiscountType || 'NONE',
        globalDiscountValue: input.globalDiscountValue || 0,
        taxMode: shop.taxMode as TaxMode,
        defaultTaxRateBps: shop.defaultTaxRateBps,
        cashRoundingStep: input.cashRoundingStep || 0,
      });

      // 3. Vérification permission et plafond de remise pour un Agent (Section 5.3)
      if (actor.role === 'AGENT' && calc.discountTotalXof > 0) {
        const access = actor.shopAccesses.find((s) => s.shopId === shopId);
        if (!access?.permissions['sales:discount']) {
          throw new ForbiddenException({
            code: 'DISCOUNT_PERMISSION_DENIED',
            message: 'Vous n’avez pas la permission d’appliquer une remise.',
          });
        }
        if (calc.effectiveDiscountPercent > access.maxDiscountPercent) {
          throw new ForbiddenException({
            code: 'DISCOUNT_CAP_EXCEEDED',
            message: `La remise demandée (${calc.effectiveDiscountPercent} %) dépasse votre plafond autorisé (${access.maxDiscountPercent} %).`,
          });
        }
      }

      // 4. Validation paiements, Mobile Money référence obligatoire & unique (Critère #24)
      let paidAmountXof = 0;
      let cashInAmountXof = 0;
      const validatedPayments: Array<{
        paymentMethodCode: string;
        amountXof: number;
        transactionRef: string | null;
        affectsCashDrawer: boolean;
      }> = [];

      const seenRefsInPayload = new Set<string>();
      for (const p of input.payments || []) {
        const cfg = paymentMethods.find((m) => m.code === p.paymentMethodCode && m.enabled);
        if (!cfg) {
          throw new BadRequestException({
            code: 'PAYMENT_METHOD_INVALID',
            message: `Moyen de paiement non activé : ${p.paymentMethodCode}.`,
          });
        }

        const ref = p.transactionRef?.trim() || null;
        if (cfg.requireReference && !ref) {
          throw new BadRequestException({
            code: 'PAYMENT_REFERENCE_REQUIRED',
            message: `La référence de transaction est obligatoire pour ${cfg.label}.`,
          });
        }
        if (ref) {
          const refKey = `${p.paymentMethodCode}:${ref}`;
          if (seenRefsInPayload.has(refKey)) {
            throw new ConflictException({
              code: 'DUPLICATE_PAYMENT_REFERENCE',
              message: `Référence « ${ref} » saisie en double dans la même vente.`,
            });
          }
          seenRefsInPayload.add(refKey);

          const dupInDb = await tx.salePayment.findFirst({
            where: { paymentMethodCode: p.paymentMethodCode, transactionRef: ref },
          });
          if (dupInDb) {
            throw new ConflictException({
              code: 'DUPLICATE_PAYMENT_REFERENCE',
              message: `La référence « ${ref} » a déjà été utilisée pour ${cfg.label} dans cette boutique.`,
            });
          }
        }

        paidAmountXof += p.amountXof;
        if (cfg.affectsCashDrawer) {
          cashInAmountXof += p.amountXof;
        }
        validatedPayments.push({
          paymentMethodCode: p.paymentMethodCode,
          amountXof: p.amountXof,
          transactionRef: ref,
          affectsCashDrawer: cfg.affectsCashDrawer,
        });
      }

      if (paidAmountXof > calc.totalXof) {
        // Pour un encaissement espèces où le client donne plus, le montant net encaissé en caisse = totalXof (rendu monnaie immédiat)
        const changeXof = paidAmountXof - calc.totalXof;
        if (cashInAmountXof < changeXof) {
          throw new BadRequestException({
            code: 'OVERPAYMENT_NON_CASH',
            message: 'Le montant payé hors espèces ne peut pas dépasser le total de la vente.',
          });
        }
        cashInAmountXof -= changeXof;
        paidAmountXof = calc.totalXof;
      }

      const dueAmountXof = Math.max(0, calc.totalXof - paidAmountXof);

      // 5. Vente à crédit / paiement partiel -> client identifié obligatoire + contrôle plafond crédit (Section 5.7)
      if (dueAmountXof > 0) {
        if (!input.clientId) {
          throw new BadRequestException({
            code: 'CLIENT_REQUIRED_FOR_CREDIT',
            message: 'Un client identifié (nom + téléphone) est obligatoire pour un paiement partiel ou à crédit.',
          });
        }
        const clientRec = await tx.client.findUnique({
          where: { id: input.clientId },
          include: {
            receivables: {
              where: { status: { in: ['OPEN', 'PARTIALLY_PAID'] } },
              select: { remainingAmountXof: true },
            },
          },
        });
        if (!clientRec) {
          throw new NotFoundException({ code: 'CLIENT_NOT_FOUND', message: 'Client introuvable.' });
        }
        const currentDebt = clientRec.receivables.reduce((acc, r) => acc + r.remainingAmountXof, 0);
        if (currentDebt + dueAmountXof > clientRec.creditLimitXof) {
          const canOverride = actor.role === 'OWNER' && input.allowCreditOverride;
          if (!canOverride) {
            throw new ForbiddenException({
              code: 'CREDIT_LIMIT_EXCEEDED',
              message: `Plafond de crédit dépassé pour ${clientRec.fullName} (encours : ${formatXof(currentDebt)}, crédit demandé : ${formatXof(dueAmountXof)}, plafond : ${formatXof(clientRec.creditLimitXof)}).`,
            });
          }
        }
      }

      // 6. Session de caisse ouverte requise si paiement espèces (Section 5.5)
      let openSessionId: string | null = null;
      if (cashInAmountXof > 0) {
        const openSession = await this.cashService.getOpenSessionInTx(tx);
        if (!openSession && !isOfflineSync) {
          throw new BadRequestException({
            code: 'CASH_SESSION_REQUIRED',
            message: 'Ouvrez une session de caisse avant d’encaisser une vente en espèces.',
          });
        }
        openSessionId = openSession?.id ?? null;
      }

      // 7. Génération du numéro unique séquentiel (ou numéro réservé terminal hors-ligne)
      let saleNumber: string;
      if (isOfflineSync && input.offlineSaleNumber) {
        saleNumber = input.offlineSaleNumber;
      } else {
        const seqRows = await tx.$queryRaw<Array<{ nextval: bigint }>>`SELECT nextval('sale_number_seq')`;
        saleNumber = `VTE-${String(Number(seqRows[0].nextval)).padStart(6, '0')}`;
      }

      // 8. Décrément atomique du stock avec verrou FOR UPDATE (Critère #17) + FEFO DLC (Lot 10)
      let hadStockConflict = false;
      for (const line of resolvedLines) {
        const isFractional = line.fractionalQtyMilli !== null;
        const wholeUnitsDeducted = Math.round(line.stockDeductionMilli / 1000);
        const move = await this.inventoryService.applyMovementInTx(tx, {
          productId: line.productId,
          variantId: line.variantId,
          movementType: 'SALE_OUT',
          quantityDelta: isFractional ? 0 : -wholeUnitsDeducted,
          ...(isFractional ? { quantityDeltaMilli: -line.stockDeductionMilli } : {}),
          unitCostXof: line.unitCostXof,
          referenceType: 'SALE',
          referenceId: saleNumber,
          reason: isOfflineSync
            ? `Synchronisation vente hors-ligne ${saleNumber}`
            : `Vente ${saleNumber}${isFractional ? ` (${line.unitLabel})` : line.soldInBulk ? ` (${line.quantity} ${line.unitLabel})` : ''}`,
          actorUserId: actor.userId,
          declaredOperatorId: operator?.id ?? null,
          declaredOperatorName: operator?.firstName ?? null,
          allowNegativeStock: isOfflineSync, // En ligne: JAMAIS négatif ; Hors-ligne sync: accepté avec conflit signalé (14.3)
        });

        if (!isFractional && wholeUnitsDeducted > 0) {
          await this.inventoryService.deductBatchesFefoInTx(tx, line.productId, wholeUnitsDeducted);
        }

        if (move.becameNegative) {
          hadStockConflict = true;
          negativeConflicts.push({ productName: move.productName, qtyAfter: move.qtyAfter });
        } else if (move.isLowStock) {
          lowStockAlerts.push({
            productName: move.productName,
            availableAfter: move.availableAfter,
            threshold: move.alertThreshold,
          });
        }
      }

      // 9. Création de la vente + lignes + paiements
      const sale = await tx.sale.create({
        data: {
          saleNumber,
          status: 'COMPLETED',
          clientId: input.clientId ?? null,
          cashSessionId: openSessionId,
          clientOperationId: input.clientOperationId ?? null,
          offlineSynced: isOfflineSync,
          stockConflict: hadStockConflict,
          grossSubtotalXof: calc.grossSubtotalXof,
          discountTotalXof: calc.discountTotalXof,
          taxMode: shop.taxMode,
          taxRateBps: shop.defaultTaxRateBps,
          taxTotalXof: calc.taxTotalXof,
          roundingXof: calc.roundingXof,
          totalXof: calc.totalXof,
          paidAmountXof,
          dueAmountXof,
          notes: input.notes || null,
          actorUserId: actor.userId,
          declaredOperatorId: operator?.id ?? null,
          declaredOperatorName: operator?.firstName ?? null,
          lines: {
            create: resolvedLines.map((l, idx) => ({
              productId: l.productId,
              variantId: l.variantId,
              productName: l.productName,
              sku: l.sku,
              quantity: l.quantity,
              unitLabel: l.unitLabel,
              soldInBulk: l.soldInBulk,
              bulkMultiplier: l.bulkMultiplier,
              fractionalQtyMilli: l.fractionalQtyMilli,
              serialNumber: l.serialNumber,
              warrantyEndsAt: l.warrantyEndsAt,
              unitPriceXof: l.unitPriceXof,
              unitCostXof: l.unitCostXof,
              discountXof: calc.lines[idx].discountXof,
              taxXof: calc.lines[idx].taxXof,
              lineTotalXof: calc.lines[idx].lineTotalXof,
            })),
          },
          payments: {
            create: validatedPayments,
          },
        },
        include: { lines: true, payments: true },
      });

      // 10. Entrée en caisse si paiement espèces
      if (cashInAmountXof > 0 && openSessionId) {
        await this.cashService.recordMovementInTx(tx, {
          sessionId: openSessionId,
          type: 'SALE_IN',
          amountXof: cashInAmountXof,
          referenceType: 'SALE',
          referenceId: sale.saleNumber,
          reason: `Encaissement espèces vente ${sale.saleNumber}`,
          actorUserId: actor.userId,
          declaredOperatorId: operator?.id ?? null,
          declaredOperatorName: operator?.firstName ?? null,
        });
      }

      // 11. Création créance client si solde dû > 0
      if (dueAmountXof > 0 && input.clientId) {
        await tx.receivable.create({
          data: {
            clientId: input.clientId,
            saleId: sale.id,
            initialAmountXof: dueAmountXof,
            paidAmountXof: 0,
            remainingAmountXof: dueAmountXof,
            status: 'OPEN',
          },
        });
      }

      // 12. Génération du justificatif immuable (Lot 3 — Critères #11 & #25)
      const clientRow = input.clientId
        ? await tx.client.findUnique({
            where: { id: input.clientId },
            select: { fullName: true, phone: true },
          })
        : null;

      const receiptCfg = {
        ...DEFAULT_RECEIPT_SETTINGS,
        ...((shop.receiptSettings as Record<string, unknown>) || {}),
      };

      await tx.saleDocument.create({
        data: {
          documentNumber: sale.saleNumber,
          documentType: 'SALE_RECEIPT',
          saleId: sale.id,
          status: 'VALID',
          printCount: 0,
          snapshot: {
            shop: {
              id: shop.id,
              name: shop.name,
              slug: shop.slug,
              logoUrl: shop.logoUrl,
              phone: shop.phone,
              email: shop.email,
              address: shop.address,
              currency: shop.currency,
              timezone: shop.timezone,
            },
            receiptSettings: receiptCfg,
            saleNumber: sale.saleNumber,
            issuedAt: sale.createdAt.toISOString(),
            client: clientRow,
            operatorName: operator?.firstName ?? actor.fullName,
            lines: sale.lines.map((l, idx) => ({
              productName: l.productName,
              sku: l.sku,
              quantity: l.quantity,
              unitLabel: l.unitLabel,
              soldInBulk: l.soldInBulk,
              bulkMultiplier: l.bulkMultiplier,
              fractionalQtyMilli: l.fractionalQtyMilli,
              customAmountXof: resolvedLines[idx]?.customAmountXof ?? null,
              serialNumber: l.serialNumber,
              warrantyMonths: resolvedLines[idx]?.warrantyMonths ?? null,
              warrantyEndsAt: l.warrantyEndsAt ? l.warrantyEndsAt.toISOString() : null,
              unitPriceXof: l.unitPriceXof,
              discountXof: l.discountXof,
              lineTotalXof: l.lineTotalXof,
            })),
            grossSubtotalXof: sale.grossSubtotalXof,
            discountTotalXof: sale.discountTotalXof,
            taxMode: sale.taxMode,
            taxRateBps: sale.taxRateBps,
            taxTotalXof: sale.taxTotalXof,
            roundingXof: sale.roundingXof,
            totalXof: sale.totalXof,
            paidAmountXof: sale.paidAmountXof,
            dueAmountXof: sale.dueAmountXof,
            payments: sale.payments.map((p) => ({
              paymentMethodCode: p.paymentMethodCode,
              amountXof: p.amountXof,
              transactionRef: p.transactionRef,
            })),
          } as object,
        },
      });

      return sale;
    });

    await this.auditService.recordShop({
      shopId,
      actorUserId: actor.userId,
      actorRole: actor.role,
      declaredOperatorId: operator?.id ?? null,
      declaredOperatorName: operator?.firstName ?? null,
      action: isOfflineSync ? 'SALE_OFFLINE_SYNCED' : 'SALE_CREATED',
      entityType: 'Sale',
      entityId: createdSale.id,
      afterData: {
        saleNumber: createdSale.saleNumber,
        totalXof: createdSale.totalXof,
        paidAmountXof: createdSale.paidAmountXof,
        dueAmountXof: createdSale.dueAmountXof,
        stockConflict: createdSale.stockConflict,
      },
      ipAddress: meta.ipAddress,
      userAgent: meta.userAgent,
      correlationId: meta.correlationId,
    });

    if (actor.merchantId && negativeConflicts.length > 0) {
      await this.notificationsService.notifyMerchantOwners(actor.merchantId, {
        shopId,
        type: 'STOCK',
        priority: 'URGENT',
        title: `Conflit stock hors-ligne sur ${createdSale.saleNumber}`,
        message: `La vente synchronisée ${createdSale.saleNumber} a créé un stock négatif sur : ${negativeConflicts.map((c) => `${c.productName} (${c.qtyAfter})`).join(', ')}. Régularisation requise.`,
        targetPath: '/commerce/stock',
      });
    } else if (actor.merchantId && lowStockAlerts.length > 0) {
      const first = lowStockAlerts[0];
      await this.notificationsService.notifyMerchantOwners(actor.merchantId, {
        shopId,
        type: 'STOCK',
        priority: first.availableAfter <= 0 ? 'URGENT' : 'WARNING',
        title: `Stock bas : ${first.productName}`,
        message: `${lowStockAlerts.length} produit(s) ont atteint leur seuil d’alerte après la vente ${createdSale.saleNumber}.`,
        targetPath: '/commerce/stock',
      });
    }

    return createdSale;
  }

  /**
   * Annulation d'une vente validée (Section 5.4 & Critère #22) :
   * - Jamais de suppression ; motif obligatoire ; réintégration stock & mouvement caisse inverse.
   */
  async cancelSale(
    shopId: string,
    saleId: string,
    input: { reason: string; refundCashFromDrawer: boolean },
    actor: AuthenticatedUser,
    operator: DeclaredOperatorContext | undefined,
    meta: RequestMeta,
  ) {
    const client = await this.shopDbManager.getClientForShop(shopId);

    const cancelled = await client.$transaction(async (tx) => {
      const sale = await tx.sale.findUnique({
        where: { id: saleId },
        include: { lines: true, payments: true, receivable: true },
      });
      if (!sale) {
        throw new NotFoundException({ code: 'SALE_NOT_FOUND', message: 'Vente introuvable.' });
      }
      if (sale.status === 'CANCELLED') {
        throw new ConflictException({
          code: 'SALE_ALREADY_CANCELLED',
          message: 'Cette vente est déjà annulée.',
        });
      }

      // Réintègre les quantités non encore retournées (y compris Gros/Détail, Fraction & Lots FEFO)
      for (const line of sale.lines) {
        if (line.fractionalQtyMilli && line.fractionalQtyMilli > 0 && line.returnedQty === 0) {
          await this.inventoryService.applyMovementInTx(tx, {
            productId: line.productId,
            variantId: line.variantId,
            movementType: 'SALE_CANCEL_IN',
            quantityDelta: 0,
            quantityDeltaMilli: line.fractionalQtyMilli,
            unitCostXof: line.unitCostXof,
            referenceType: 'SALE_CANCEL',
            referenceId: sale.saleNumber,
            reason: input.reason,
            actorUserId: actor.userId,
            declaredOperatorId: operator?.id ?? null,
            declaredOperatorName: operator?.firstName ?? null,
          });
        } else {
          const multiplier = line.bulkMultiplier && line.bulkMultiplier > 1 ? line.bulkMultiplier : 1;
          const qtyToRestore = Math.max(0, line.quantity - line.returnedQty) * multiplier;
          if (qtyToRestore > 0) {
            await this.inventoryService.applyMovementInTx(tx, {
              productId: line.productId,
              variantId: line.variantId,
              movementType: 'SALE_CANCEL_IN',
              quantityDelta: qtyToRestore,
              unitCostXof: line.unitCostXof,
              referenceType: 'SALE_CANCEL',
              referenceId: sale.saleNumber,
              reason: input.reason,
              actorUserId: actor.userId,
              declaredOperatorId: operator?.id ?? null,
              declaredOperatorName: operator?.firstName ?? null,
            });
            await this.inventoryService.restoreBatchesInTx(tx, line.productId, qtyToRestore);
          }
        }
      }

      // Décaissement espèces si la vente avait été encaissée en espèces et remboursée en caisse
      const cashPaid = sale.payments
        .filter((p) => p.affectsCashDrawer)
        .reduce((acc, p) => acc + p.amountXof, 0);
      const netCashToRefund = Math.max(0, Math.min(cashPaid, sale.paidAmountXof - sale.refundedAmountXof));

      if (input.refundCashFromDrawer && netCashToRefund > 0) {
        const openSession = await this.cashService.getOpenSessionInTx(tx);
        if (!openSession) {
          throw new BadRequestException({
            code: 'CASH_SESSION_REQUIRED',
            message: 'Ouvrez une session de caisse pour enregistrer le décaissement d’annulation en espèces.',
          });
        }
        await this.cashService.recordMovementInTx(tx, {
          sessionId: openSession.id,
          type: 'REFUND_OUT',
          amountXof: netCashToRefund,
          referenceType: 'SALE_CANCEL',
          referenceId: sale.saleNumber,
          reason: `Annulation vente ${sale.saleNumber} : ${input.reason}`,
          actorUserId: actor.userId,
          declaredOperatorId: operator?.id ?? null,
          declaredOperatorName: operator?.firstName ?? null,
        });
      }

      if (sale.receivable && sale.receivable.status !== 'PAID') {
        await tx.receivable.update({
          where: { id: sale.receivable.id },
          data: { status: 'CANCELLED', remainingAmountXof: 0 },
        });
      }

      // Conserve le justificatif dans la série avec mention ANNULÉ (Critère #25)
      await tx.saleDocument.updateMany({
        where: { saleId: sale.id, documentType: 'SALE_RECEIPT' },
        data: { status: 'CANCELLED' },
      });

      return tx.sale.update({
        where: { id: sale.id },
        data: {
          status: 'CANCELLED',
          cancelReason: input.reason,
          cancelledAt: new Date(),
          cancelledByUserId: actor.userId,
          dueAmountXof: 0,
        },
      });
    });

    await this.auditService.recordShop({
      shopId,
      actorUserId: actor.userId,
      actorRole: actor.role,
      declaredOperatorId: operator?.id ?? null,
      declaredOperatorName: operator?.firstName ?? null,
      action: 'SALE_CANCELLED',
      entityType: 'Sale',
      entityId: cancelled.id,
      afterData: { saleNumber: cancelled.saleNumber, totalXof: cancelled.totalXof },
      reason: input.reason,
      ipAddress: meta.ipAddress,
      userAgent: meta.userAgent,
      correlationId: meta.correlationId,
    });

    return cancelled;
  }

  /**
   * Retour produit sur vente (Critère #22) :
   * - Quantité cumulée <= quantité vendue
   * - `RESELLABLE` -> réintègre le stock ; `DAMAGED_LOSS` -> enregistré en perte sans réintégrer le stock !
   */
  async createSaleReturn(
    shopId: string,
    saleId: string,
    input: {
      reason: string;
      items: Array<{ saleLineId: string; quantity: number; condition: 'RESELLABLE' | 'DAMAGED_LOSS' }>;
    },
    actor: AuthenticatedUser,
    operator: DeclaredOperatorContext | undefined,
    meta: RequestMeta,
  ) {
    const client = await this.shopDbManager.getClientForShop(shopId);

    const returns = await client.$transaction(async (tx) => {
      const sale = await tx.sale.findUnique({
        where: { id: saleId },
        include: { lines: true },
      });
      if (!sale) {
        throw new NotFoundException({ code: 'SALE_NOT_FOUND', message: 'Vente introuvable.' });
      }
      if (sale.status === 'CANCELLED') {
        throw new ConflictException({
          code: 'SALE_CANCELLED',
          message: 'Impossible d’enregistrer un retour sur une vente déjà annulée.',
        });
      }

      const createdReturns = [];
      for (const item of input.items) {
        const line = sale.lines.find((l) => l.id === item.saleLineId);
        if (!line) {
          throw new BadRequestException({ code: 'SALE_LINE_NOT_FOUND', message: 'Ligne de vente introuvable.' });
        }
        const remaining = line.quantity - line.returnedQty;
        if (item.quantity > remaining) {
          throw new BadRequestException({
            code: 'RETURN_QTY_EXCEEDED',
            message: `Impossible de retourner ${item.quantity} unité(s) de ${line.productName} (maximum restant : ${remaining}).`,
          });
        }

        if (item.condition === 'RESELLABLE') {
          const multiplier = line.bulkMultiplier && line.bulkMultiplier > 1 ? line.bulkMultiplier : 1;
          const baseUnitsReturned = item.quantity * multiplier;
          await this.inventoryService.applyMovementInTx(tx, {
            productId: line.productId,
            variantId: line.variantId,
            movementType: 'RETURN_RESELLABLE_IN',
            quantityDelta: baseUnitsReturned,
            unitCostXof: line.unitCostXof,
            referenceType: 'SALE_RETURN',
            referenceId: sale.saleNumber,
            reason: input.reason,
            actorUserId: actor.userId,
            declaredOperatorId: operator?.id ?? null,
            declaredOperatorName: operator?.firstName ?? null,
          });
          await this.inventoryService.restoreBatchesInTx(tx, line.productId, baseUnitsReturned);
        } else {
          // Non revendable : enregistré comme perte (delta = 0 sur stock physique, trace explicite dans stock_movements)
          await this.inventoryService.applyMovementInTx(tx, {
            productId: line.productId,
            variantId: line.variantId,
            movementType: 'RETURN_DAMAGED_LOSS',
            quantityDelta: 0,
            unitCostXof: line.unitCostXof,
            referenceType: 'SALE_RETURN_LOSS',
            referenceId: sale.saleNumber,
            reason: `Retour non revendable (${item.quantity} u.) : ${input.reason}`,
            actorUserId: actor.userId,
            declaredOperatorId: operator?.id ?? null,
            declaredOperatorName: operator?.firstName ?? null,
          });
        }

        await tx.saleLine.update({
          where: { id: line.id },
          data: { returnedQty: line.returnedQty + item.quantity },
        });

        const rec = await tx.saleReturn.create({
          data: {
            saleId: sale.id,
            saleLineId: line.id,
            productId: line.productId,
            variantId: line.variantId,
            quantity: item.quantity,
            condition: item.condition,
            reason: input.reason,
            actorUserId: actor.userId,
            declaredOperatorId: operator?.id ?? null,
            declaredOperatorName: operator?.firstName ?? null,
          },
        });
        createdReturns.push(rec);
      }

      return createdReturns;
    });

    await this.auditService.recordShop({
      shopId,
      actorUserId: actor.userId,
      actorRole: actor.role,
      declaredOperatorId: operator?.id ?? null,
      declaredOperatorName: operator?.firstName ?? null,
      action: 'SALE_RETURN_RECORDED',
      entityType: 'Sale',
      entityId: saleId,
      afterData: {
        items: input.items,
      },
      reason: input.reason,
      ipAddress: meta.ipAddress,
      userAgent: meta.userAgent,
      correlationId: meta.correlationId,
    });

    return returns;
  }

  /**
   * Remboursement lié à une vente (Critère #22) :
   * - Ne peut jamais dépasser le montant payé de la vente d'origine
   * - Un remboursement espèces crée un décaissement `REFUND_OUT` dans la caisse ouverte
   */
  async createSaleRefund(
    shopId: string,
    saleId: string,
    input: { amountXof: number; paymentMethodCode: string; transactionRef?: string; reason: string },
    actor: AuthenticatedUser,
    operator: DeclaredOperatorContext | undefined,
    meta: RequestMeta,
  ) {
    const shop = await this.controlPrisma.shop.findUniqueOrThrow({ where: { id: shopId } });
    const paymentMethods = (
      Array.isArray(shop.paymentMethods) ? shop.paymentMethods : DEFAULT_PAYMENT_METHODS
    ) as PaymentMethodConfig[];
    const methodCfg = paymentMethods.find((m) => m.code === input.paymentMethodCode);

    const client = await this.shopDbManager.getClientForShop(shopId);

    const refund = await client.$transaction(async (tx) => {
      const sale = await tx.sale.findUnique({
        where: { id: saleId },
        include: { client: { select: { fullName: true, phone: true } } },
      });
      if (!sale) {
        throw new NotFoundException({ code: 'SALE_NOT_FOUND', message: 'Vente introuvable.' });
      }
      if (sale.status === 'CANCELLED') {
        throw new ConflictException({
          code: 'SALE_ALREADY_CANCELLED',
          message: 'Impossible de rembourser une vente déjà annulée.',
        });
      }
      const maxRefundable = Math.max(0, sale.paidAmountXof - sale.refundedAmountXof);
      if (maxRefundable <= 0) {
        throw new BadRequestException({
          code: 'SALE_ALREADY_REFUNDED',
          message: 'Cette vente a déjà été intégralement remboursée.',
        });
      }
      if (input.amountXof > maxRefundable) {
        throw new BadRequestException({
          code: 'REFUND_EXCEEDS_SALE',
          message: `Le remboursement (${formatXof(input.amountXof)}) dépasse le montant remboursable restant sur cette vente (${formatXof(maxRefundable)}).`,
        });
      }

      const seqRows = await tx.$queryRaw<Array<{ nextval: bigint }>>`SELECT nextval('credit_note_number_seq')`;
      const creditNoteNumber = `AV-${String(Number(seqRows[0].nextval)).padStart(6, '0')}`;

      let cashMovementId: string | null = null;
      if (methodCfg?.affectsCashDrawer || input.paymentMethodCode === 'CASH') {
        const openSession = await this.cashService.getOpenSessionInTx(tx);
        if (!openSession) {
          throw new BadRequestException({
            code: 'CASH_SESSION_REQUIRED',
            message:
              'Ouvrez une session de caisse pour un remboursement en espèces (ou choisissez Mobile Money / Virement).',
          });
        }
        const mv = await this.cashService.recordMovementInTx(tx, {
          sessionId: openSession.id,
          type: 'REFUND_OUT',
          amountXof: input.amountXof,
          referenceType: 'SALE_REFUND',
          referenceId: creditNoteNumber,
          reason: `Remboursement ${creditNoteNumber} sur ${sale.saleNumber} : ${input.reason}`,
          actorUserId: actor.userId,
          declaredOperatorId: operator?.id ?? null,
          declaredOperatorName: operator?.firstName ?? null,
        });
        cashMovementId = mv.id;
      }

      const created = await tx.saleRefund.create({
        data: {
          saleId: sale.id,
          creditNoteNumber,
          amountXof: input.amountXof,
          paymentMethodCode: input.paymentMethodCode,
          transactionRef: input.transactionRef?.trim() || null,
          cashMovementId,
          reason: input.reason,
          actorUserId: actor.userId,
          declaredOperatorId: operator?.id ?? null,
          declaredOperatorName: operator?.firstName ?? null,
        },
      });

      await tx.sale.update({
        where: { id: sale.id },
        data: { refundedAmountXof: sale.refundedAmountXof + input.amountXof },
      });

      const receiptCfg = {
        ...DEFAULT_RECEIPT_SETTINGS,
        ...((shop.receiptSettings as Record<string, unknown>) || {}),
      };

      // Génère un avoir distinct lié à la vente d'origine (Section 10.1 & Critère #25)
      const creditDoc = await tx.saleDocument.create({
        data: {
          documentNumber: creditNoteNumber,
          documentType: 'CREDIT_NOTE',
          saleId: sale.id,
          refundId: created.id,
          status: 'VALID',
          printCount: 0,
          snapshot: {
            shop: {
              id: shop.id,
              name: shop.name,
              slug: shop.slug,
              logoUrl: shop.logoUrl,
              phone: shop.phone,
              email: shop.email,
              address: shop.address,
              currency: shop.currency,
              timezone: shop.timezone,
            },
            receiptSettings: receiptCfg,
            creditNoteNumber,
            originalSaleNumber: sale.saleNumber,
            issuedAt: created.createdAt.toISOString(),
            client: sale.client,
            operatorName: operator?.firstName ?? actor.fullName,
            amountXof: created.amountXof,
            paymentMethodCode: created.paymentMethodCode,
            transactionRef: created.transactionRef,
            reason: created.reason,
          } as object,
        },
      });

      return { ...created, documentId: creditDoc.id };
    });

    await this.auditService.recordShop({
      shopId,
      actorUserId: actor.userId,
      actorRole: actor.role,
      declaredOperatorId: operator?.id ?? null,
      declaredOperatorName: operator?.firstName ?? null,
      action: 'SALE_REFUND_RECORDED',
      entityType: 'SaleRefund',
      entityId: refund.id,
      afterData: {
        saleId,
        amountXof: refund.amountXof,
        paymentMethodCode: refund.paymentMethodCode,
      },
      reason: input.reason,
      ipAddress: meta.ipAddress,
      userAgent: meta.userAgent,
      correlationId: meta.correlationId,
    });

    return refund;
  }
}

@ApiTags('Ventes POS')
@ApiBearerAuth()
@Controller('shops/:shopId/sales')
@UseGuards(ShopScopeGuard, PermissionsGuard, OperatorGuard)
export class SalesController {
  constructor(private readonly salesService: SalesService) {}

  @Get()
  @Roles('OWNER', 'AGENT')
  @RequirePermissions('sales:read')
  @ApiOperation({ summary: 'Lister les ventes validées et annulées de la boutique (recherche par numéro, client ou IMEI/série)' })
  list(
    @Param('shopId') shopId: string,
    @CurrentUser() user: AuthenticatedUser,
    @Query('status') status?: string,
    @Query('search') search?: string,
    @Query('serial') serial?: string,
    @Query('page') page?: string,
    @Query('limit') limit?: string,
  ) {
    return this.salesService.listSales(shopId, user, {
      status,
      search,
      serial,
      page: page ? Number(page) : 1,
      limit: limit ? Number(limit) : 25,
    });
  }

  @Post()
  @Roles('OWNER', 'AGENT')
  @RequirePermissions('sales:create')
  @RequireOperator()
  @ApiOperation({ summary: 'Valider une vente comptoir (transaction atomique stock + caisse + créance)' })
  create(
    @Param('shopId') shopId: string,
    @Body(new ZodValidationPipe(createSaleSchema)) body: any,
    @CurrentUser() user: AuthenticatedUser,
    @CurrentOperator() operator: DeclaredOperatorContext | undefined,
    @Req() req: RequestWithAuth,
  ) {
    return this.salesService.createSale(
      shopId,
      body,
      user,
      operator,
      {
        ipAddress: req.ip || null,
        userAgent: req.header('user-agent') || null,
        correlationId: req.correlationId || null,
      },
      false,
    );
  }

  @Post('sync')
  @Roles('OWNER', 'AGENT')
  @RequirePermissions('sales:create')
  @RequireOperator()
  @ApiOperation({ summary: 'Synchroniser une vente comptoir capturée hors-ligne (Option B, idempotente)' })
  syncOffline(
    @Param('shopId') shopId: string,
    @Body(new ZodValidationPipe(createSaleSchema)) body: any,
    @CurrentUser() user: AuthenticatedUser,
    @CurrentOperator() operator: DeclaredOperatorContext | undefined,
    @Req() req: RequestWithAuth,
  ) {
    return this.salesService.createSale(
      shopId,
      body,
      user,
      operator,
      {
        ipAddress: req.ip || null,
        userAgent: req.header('user-agent') || null,
        correlationId: req.correlationId || null,
      },
      true,
    );
  }

  @Post(':saleId/cancel')
  @Roles('OWNER', 'AGENT')
  @RequirePermissions('sales:cancel')
  @RequireOperator(true)
  @ApiOperation({ summary: 'Annuler une vente validée avec motif obligatoire (jamais effacée)' })
  cancel(
    @Param('shopId') shopId: string,
    @Param('saleId') saleId: string,
    @Body(new ZodValidationPipe(cancelSaleSchema)) body: any,
    @CurrentUser() user: AuthenticatedUser,
    @CurrentOperator() operator: DeclaredOperatorContext | undefined,
    @Req() req: RequestWithAuth,
  ) {
    return this.salesService.cancelSale(shopId, saleId, body, user, operator, {
      ipAddress: req.ip || null,
      userAgent: req.header('user-agent') || null,
      correlationId: req.correlationId || null,
    });
  }

  @Post(':saleId/returns')
  @Roles('OWNER', 'AGENT')
  @RequirePermissions('sales:refund')
  @RequireOperator(true)
  @ApiOperation({ summary: 'Enregistrer un retour article (revendable -> stock, non revendable -> perte)' })
  createReturn(
    @Param('shopId') shopId: string,
    @Param('saleId') saleId: string,
    @Body(new ZodValidationPipe(createSaleReturnSchema)) body: any,
    @CurrentUser() user: AuthenticatedUser,
    @CurrentOperator() operator: DeclaredOperatorContext | undefined,
    @Req() req: RequestWithAuth,
  ) {
    return this.salesService.createSaleReturn(shopId, saleId, body, user, operator, {
      ipAddress: req.ip || null,
      userAgent: req.header('user-agent') || null,
      correlationId: req.correlationId || null,
    });
  }

  @Post(':saleId/refunds')
  @Roles('OWNER', 'AGENT')
  @RequirePermissions('sales:refund')
  @RequireOperator(true)
  @ApiOperation({ summary: 'Enregistrer un remboursement lié à la vente d’origine (plafonné au montant payé)' })
  createRefund(
    @Param('shopId') shopId: string,
    @Param('saleId') saleId: string,
    @Body(new ZodValidationPipe(createSaleRefundSchema)) body: any,
    @CurrentUser() user: AuthenticatedUser,
    @CurrentOperator() operator: DeclaredOperatorContext | undefined,
    @Req() req: RequestWithAuth,
  ) {
    return this.salesService.createSaleRefund(shopId, saleId, body, user, operator, {
      ipAddress: req.ip || null,
      userAgent: req.header('user-agent') || null,
      correlationId: req.correlationId || null,
    });
  }
}

@Module({
  controllers: [SalesController],
  providers: [SalesService],
  exports: [SalesService],
})
export class SalesModule {}
