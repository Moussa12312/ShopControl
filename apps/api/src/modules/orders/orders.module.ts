import * as crypto from 'crypto';
import * as argon2 from 'argon2';
import * as jwt from 'jsonwebtoken';
import {
  BadRequestException,
  Body,
  ConflictException,
  Controller,
  Delete,
  ForbiddenException,
  Get,
  HttpCode,
  HttpException,
  HttpStatus,
  Injectable,
  Module,
  NotFoundException,
  Param,
  Post,
  Query,
  Req,
  Res,
  UnauthorizedException,
  UseGuards,
} from '@nestjs/common';
import { Response } from 'express';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import * as QRCode from 'qrcode';
import {
  blockPhoneSchema,
  canShopDeliver,
  completeOrderToSaleSchema,
  createPublicOrderSchema,
  customerLoginSchema,
  customerRegisterSchema,
  DEFAULT_DELIVERY_CONFIG,
  DEFAULT_OPENING_HOURS,
  DEFAULT_PAYMENT_METHODS,
  DEFAULT_RECEIPT_SETTINGS,
  DeliveryConfig,
  formatXof,
  normalizeBusinessProfile,
  normalizeShopType,
  OnlineOrderStatus,
  PaymentMethodConfig,
  TaxMode,
  TenantStatus,
  trackOrderLookupSchema,
  updateOrderStatusSchema,
  calculateSaleTotals,
} from '@shopcontrol/shared';
import {
  CurrentOperator,
  CurrentUser,
  Public,
  RequireOperator,
  RequirePermissions,
  Roles,
} from '../../common/auth/auth.decorators';
import {
  AuthenticatedUser,
  DeclaredOperatorContext,
  RequestWithAuth,
} from '../../common/auth/request-context.types';
import { getEnv } from '../../common/config/env.config';
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

const RESERVED_STATUSES = new Set<string>(['CONFIRMED', 'PREPARING', 'READY', 'IN_DELIVERY']);

function normalizePhone(raw: string): string {
  return raw.replace(/[\s()-]/g, '').trim();
}

function isShopCurrentlyOpen(openingHours: unknown, timezone: string): boolean {
  if (!openingHours || typeof openingHours !== 'object') return true;
  try {
    const now = new Date();
    const parts = new Intl.DateTimeFormat('en-US', {
      timeZone: timezone || 'Africa/Bamako',
      weekday: 'short',
      hour: '2-digit',
      minute: '2-digit',
      hour12: false,
    }).formatToParts(now);
    const wd = (parts.find((p) => p.type === 'weekday')?.value || 'Mon').toLowerCase().slice(0, 3);
    const hh = parts.find((p) => p.type === 'hour')?.value || '12';
    const mm = parts.find((p) => p.type === 'minute')?.value || '00';
    const current = `${hh}:${mm}`;
    const dayCfg = (openingHours as Record<string, { open: string; close: string; closed: boolean }>)[wd];
    if (!dayCfg) return true;
    if (dayCfg.closed) return false;
    return current >= dayCfg.open && current <= dayCfg.close;
  } catch {
    return true;
  }
}

@Injectable()
export class OrdersService {
  constructor(
    private readonly controlPrisma: ControlPrismaService,
    private readonly shopDbManager: ShopDatabaseManagerService,
    private readonly inventoryService: InventoryService,
    private readonly cashService: CashService,
    private readonly auditService: AuditService,
    private readonly notificationsService: NotificationsService,
  ) {}

  private async resolveShopBySlug(slug: string) {
    const clean = slug.trim().toLowerCase();
    const shop = await this.controlPrisma.shop.findUnique({
      where: { slug: clean },
      include: { merchant: { select: { id: true, name: true, status: true } } },
    });
    if (shop) {
      return { shop, redirectToSlug: null as string | null };
    }
    const redir = await this.controlPrisma.shopSlugRedirect.findUnique({
      where: { oldSlug: clean },
      include: {
        shop: { include: { merchant: { select: { id: true, name: true, status: true } } } },
      },
    });
    if (redir) {
      return { shop: null, redirectToSlug: redir.shop.slug };
    }
    throw new NotFoundException({ code: 'SHOP_NOT_FOUND', message: 'Boutique introuvable.' });
  }

  private getEffectiveStatus(merchantStatus: string, shopStatus: string): TenantStatus {
    if (merchantStatus === 'TERMINATED' || shopStatus === 'TERMINATED') return 'TERMINATED';
    if (merchantStatus === 'SUSPENDED' || shopStatus === 'SUSPENDED') return 'SUSPENDED';
    if (merchantStatus === 'PAST_DUE' || shopStatus === 'PAST_DUE') return 'PAST_DUE';
    return 'ACTIVE';
  }

  /**
   * Vitrine publique complète par QR code (Critères #6, #7, #18 & #29) :
   * - Affiche UNIQUEMENT les produits `PUBLISHED` de cette boutique
   * - Calcule `stockAvailable = physicalQty - reservedQty` en temps réel (les stocks réservés disparaissent immédiatement !)
   */
  async getPublicStorefront(
    slug: string,
    query?: { page?: number; limit?: number; categoryId?: string; search?: string },
  ) {
    const resolved = await this.resolveShopBySlug(slug);
    if (resolved.redirectToSlug) {
      return { redirectToSlug: resolved.redirectToSlug, available: false, status: 'REDIRECT' };
    }
    const shop = resolved.shop!;
    const effectiveStatus = this.getEffectiveStatus(shop.merchant.status, shop.status);

    if (effectiveStatus === 'SUSPENDED' || effectiveStatus === 'TERMINATED') {
      return {
        redirectToSlug: null,
        available: false,
        status: effectiveStatus,
        shopName: shop.name,
        logoUrl: shop.logoUrl,
        message: 'Boutique momentanément indisponible. Aucune commande ne peut être enregistrée.',
      };
    }

    const shopType = normalizeShopType(shop.shopType);
    const businessProfile = normalizeBusinessProfile(shopType, shop.businessProfile);
    const allowDelivery = canShopDeliver(shopType, businessProfile.enabledShopTypes);
    const rawDeliveryConfig: DeliveryConfig = {
      ...DEFAULT_DELIVERY_CONFIG,
      ...((shop.deliveryConfig as Partial<DeliveryConfig>) || {}),
    };
    const deliveryConfig: DeliveryConfig = allowDelivery
      ? rawDeliveryConfig
      : {
          ...rawDeliveryConfig,
          pickupEnabled: true,
          deliveryEnabled: false,
          defaultDeliveryFeeXof: 0,
          deliveryZones: [],
        };
    const receiptSettings = {
      ...DEFAULT_RECEIPT_SETTINGS,
      ...((shop.receiptSettings as Record<string, unknown>) || {}),
    };
    const isOpenNow = isShopCurrentlyOpen(shop.openingHours ?? DEFAULT_OPENING_HOURS, shop.timezone);

    let categories: Array<{ id: string; name: string }> = [];
    let products: Array<{
      id: string;
      name: string;
      sku: string;
      description: string | null;
      categoryId: string | null;
      categoryName: string | null;
      unit: string;
      salePriceXof: number;
      imageUrls: string[];
      availableSizes: string[];
      availableColors: string[];
      brand: string | null;
      modelName: string | null;
      volumeLabel: string | null;
      bulkUnitLabel: string | null;
      unitsPerBulk: number | null;
      bulkSalePriceXof: number | null;
      allowFractionalSale: boolean;
      warrantyMonths: number | null;
      trackSerialNumber: boolean;
      stockAvailable: number;
      stockAvailableDecimal: number;
      inStock: boolean;
      variants?: Array<{
        id: string;
        name: string;
        salePriceXof: number;
        stockAvailable: number;
        inStock: boolean;
      }>;
    }> = [];

    const page = Math.max(1, query?.page || 1);
    const limit = Math.min(200, Math.max(1, query?.limit || 100));
    let totalProducts = 0;

    if (shop.dbStatus === 'READY') {
      const client = await this.shopDbManager.getClientForShop(shop.id);
      const productWhere: Record<string, unknown> = { status: 'PUBLISHED' };
      if (query?.categoryId) {
        productWhere.categoryId = query.categoryId;
      }
      if (query?.search?.trim()) {
        const q = query.search.trim();
        productWhere.OR = [
          { name: { contains: q, mode: 'insensitive' } },
          { sku: { contains: q, mode: 'insensitive' } },
          { brand: { contains: q, mode: 'insensitive' } },
          { modelName: { contains: q, mode: 'insensitive' } },
        ];
      }

      const [cats, totalCount, prods] = await Promise.all([
        client.category.findMany({
          where: { isActive: true },
          orderBy: [{ sortOrder: 'asc' }, { name: 'asc' }],
          select: { id: true, name: true },
        }),
        client.product.count({ where: productWhere }),
        client.product.findMany({
          where: productWhere,
          orderBy: [{ isPinnedPos: 'desc' }, { name: 'asc' }],
          skip: (page - 1) * limit,
          take: limit,
          include: {
            category: { select: { name: true } },
            variants: { where: { isActive: true }, select: { id: true, name: true, salePriceXof: true } },
            stockBalances: true,
          },
        }),
      ]);
      categories = cats;
      totalProducts = totalCount;
      products = prods.map((p) => {
        const activeVariants = (p.variants || []).map((v) => {
          const bal = p.stockBalances.find((b) => b.variantKey === v.id);
          const avail = Math.max(0, (bal?.physicalQty ?? 0) - (bal?.reservedQty ?? 0));
          return {
            id: v.id,
            name: v.name,
            salePriceXof: v.salePriceXof ?? p.salePriceXof,
            stockAvailable: avail,
            inStock: avail > 0,
          };
        });

        let available = 0;
        let availableDecimal = 0;

        if (activeVariants.length > 0) {
          available = activeVariants.reduce((acc, v) => acc + v.stockAvailable, 0);
          availableDecimal = available;
        } else {
          const bal = p.stockBalances.find((b) => b.variantKey === 'BASE');
          available = Math.max(0, (bal?.physicalQty ?? 0) - (bal?.reservedQty ?? 0));
          const rem = bal?.fractionalRemainderMilli ?? 0;
          availableDecimal = Number(
            (Math.max(0, available * 1000 + rem) / 1000).toFixed(3),
          );
        }

        return {
          id: p.id,
          name: p.name,
          sku: p.sku,
          description: p.description,
          categoryId: p.categoryId,
          categoryName: p.category?.name ?? null,
          unit: p.unit,
          salePriceXof: p.salePriceXof,
          imageUrls: Array.isArray(p.imageUrls) ? (p.imageUrls as string[]) : [],
          availableSizes: Array.isArray(p.availableSizes) ? (p.availableSizes as string[]) : [],
          availableColors: Array.isArray(p.availableColors) ? (p.availableColors as string[]) : [],
          brand: p.brand,
          modelName: p.modelName,
          volumeLabel: p.volumeLabel,
          bulkUnitLabel: p.bulkUnitLabel,
          unitsPerBulk: p.unitsPerBulk,
          bulkSalePriceXof: p.bulkSalePriceXof,
          allowFractionalSale: p.allowFractionalSale,
          warrantyMonths: p.warrantyMonths,
          trackSerialNumber: p.trackSerialNumber,
          stockAvailable: available,
          stockAvailableDecimal: availableDecimal,
          inStock: available > 0 || availableDecimal > 0,
          variants: activeVariants,
        };
      });
    }

    return {
      redirectToSlug: null,
      available: true,
      status: effectiveStatus,
      isOpenNow,
      shop: {
        id: shop.id,
        name: shop.name,
        slug: shop.slug,
        shopType,
        businessProfile,
        logoUrl: shop.logoUrl,
        slogan: (receiptSettings as any).slogan || '',
        phone: shop.phone,
        email: shop.email,
        address: shop.address,
        currency: shop.currency,
        timezone: shop.timezone,
        openingHours: shop.openingHours,
        deliveryConfig,
      },
      categories,
      products,
      pagination: {
        page,
        limit,
        total: totalProducts,
        hasMore: page * limit < totalProducts,
      },
    };
  }

  /**
   * Génère le QR code permanent de la boutique (SVG + PNG Data URL — Section 8.1 & Critère #6).
   */
  async generateShopQr(slug: string, originOverride?: string) {
    const resolved = await this.resolveShopBySlug(slug);
    const targetSlug = resolved.redirectToSlug || resolved.shop!.slug;
    const defaultOrigin = getEnv().CORS_ORIGINS.split(',')[0]?.trim() || 'http://localhost:3000';
    const baseUrl = (originOverride || defaultOrigin).replace(/\/+$/, '');
    const storefrontUrl = `${baseUrl}/s/${targetSlug}`;

    const [pngDataUrl, svg] = await Promise.all([
      QRCode.toDataURL(storefrontUrl, {
        width: 512,
        margin: 2,
        color: { dark: '#071A19', light: '#FFFFFF' },
      }),
      QRCode.toString(storefrontUrl, {
        type: 'svg',
        margin: 2,
        color: { dark: '#071A19', light: '#FFFFFF' },
      }),
    ]);

    return {
      slug: targetSlug,
      shopName: resolved.shop?.name ?? targetSlug,
      logoUrl: resolved.shop?.logoUrl ?? null,
      storefrontUrl,
      pngDataUrl,
      svg,
    };
  }

  /**
   * Commande vitrine SANS COMPTE (Section 8.4, 8.10 & Critères #8, #28, #29) :
   * - Bloque si boutique/marchand suspendu
   * - Anti-abus : honeypot, numéros bloqués (refus silencieux), plafond qté/montant, rate-limit téléphone & IP
   * - Crée une commande `NEW` SANS décrémenter le stock ni créer de CA (Critères #18 & #19)
   * - Renvoie un lien de suivi secret unique (`secretToken`)
   */
  async createPublicOrder(slug: string, input: any, clientIp: string, customerToken?: string) {
    // 1. Pot-de-miel anti-robot discret
    if (input.websiteHp && String(input.websiteHp).trim().length > 0) {
      throw new BadRequestException({ code: 'ORDER_REJECTED', message: 'Requête invalide.' });
    }

    const resolved = await this.resolveShopBySlug(slug);
    if (!resolved.shop) {
      throw new BadRequestException({ code: 'SHOP_REDIRECT', message: 'Veuillez actualiser la vitrine.' });
    }
    const shop = resolved.shop;
    const effectiveStatus = this.getEffectiveStatus(shop.merchant.status, shop.status);
    if (effectiveStatus === 'SUSPENDED' || effectiveStatus === 'TERMINATED') {
      throw new ForbiddenException({
        code: 'SHOP_UNAVAILABLE',
        message: 'Boutique momentanément indisponible. Aucune commande ne peut être enregistrée.',
      });
    }

    const shopType = normalizeShopType(shop.shopType);
    const businessProfile = normalizeBusinessProfile(shopType, shop.businessProfile);
    const allowDelivery = canShopDeliver(shopType, businessProfile.enabledShopTypes);

    if (!allowDelivery && input.fulfillmentMode === 'DELIVERY') {
      throw new BadRequestException({
        code: 'STREET_SHOP_PICKUP_ONLY',
        message: 'Cette boutique de rue propose uniquement le retrait sur place en boutique.',
      });
    }

    const rawDeliveryConfig: DeliveryConfig = {
      ...DEFAULT_DELIVERY_CONFIG,
      ...((shop.deliveryConfig as Partial<DeliveryConfig>) || {}),
    };
    const deliveryConfig: DeliveryConfig = allowDelivery
      ? rawDeliveryConfig
      : {
          ...rawDeliveryConfig,
          pickupEnabled: true,
          deliveryEnabled: false,
          defaultDeliveryFeeXof: 0,
          deliveryZones: [],
        };
    const effectiveFulfillmentMode = allowDelivery ? input.fulfillmentMode : 'PICKUP';

    if (effectiveFulfillmentMode === 'PICKUP' && !deliveryConfig.pickupEnabled) {
      throw new BadRequestException({
        code: 'FULFILLMENT_DISABLED',
        message: 'Le retrait en boutique n’est pas activé pour cette boutique.',
      });
    }
    if (effectiveFulfillmentMode === 'DELIVERY') {
      if (!deliveryConfig.deliveryEnabled) {
        throw new BadRequestException({
          code: 'FULFILLMENT_DISABLED',
          message: 'La livraison n’est pas activée pour cette boutique.',
        });
      }
      if (!input.deliveryAddress?.trim()) {
        throw new BadRequestException({
          code: 'DELIVERY_ADDRESS_REQUIRED',
          message: 'Veuillez renseigner votre adresse de livraison.',
        });
      }
    }

    const isOpenNow = isShopCurrentlyOpen(shop.openingHours ?? DEFAULT_OPENING_HOURS, shop.timezone);
    if (!isOpenNow && !deliveryConfig.allowOutOfHoursOrders) {
      throw new BadRequestException({
        code: 'SHOP_CLOSED',
        message: 'La boutique est actuellement fermée aux commandes en ligne.',
      });
    }

    const cleanPhone = normalizePhone(input.clientPhone);
    const shopClient = await this.shopDbManager.getClientForShop(shop.id);

    // 2. Contrôle anti-abus : numéro bloqué (Section 8.10 : refus sans notification à la boutique)
    const blocked = await shopClient.blockedPhone.findUnique({ where: { phone: cleanPhone } });
    if (blocked) {
      throw new ForbiddenException({
        code: 'ORDER_BLOCKED',
        message: 'Impossible d’enregistrer cette commande pour le moment. Contactez la boutique.',
      });
    }

    // 3. Limitation du débit : par téléphone et par IP sur 1 heure (Critère #28)
    const oneHourAgo = new Date(Date.now() - 3_600_000);
    const maxPerPhone = deliveryConfig.maxOrdersPerPhonePerHour ?? 5;
    const [recentByPhone, recentByIp] = await Promise.all([
      shopClient.onlineOrder.count({
        where: { clientPhone: cleanPhone, createdAt: { gte: oneHourAgo } },
      }),
      shopClient.onlineOrder.count({
        where: { clientIp, createdAt: { gte: oneHourAgo } },
      }),
    ]);

    if (recentByPhone >= maxPerPhone || recentByIp >= Math.max(maxPerPhone * 3, 15)) {
      throw new HttpException(
        {
          code: 'ORDER_RATE_LIMITED',
          message: 'Trop de commandes soumises récemment. Veuillez patienter avant de réessayer.',
        },
        HttpStatus.TOO_MANY_REQUESTS,
      );
    }

    // 4. Vérification produits, stock disponible & plafonds (Section 8.10)
    const totalQty = input.items.reduce((acc: number, i: any) => acc + i.quantity, 0);
    if (totalQty > (deliveryConfig.maxOrderQty || 100)) {
      throw new BadRequestException({
        code: 'ORDER_QTY_LIMIT',
        message: `La quantité maximale autorisée par commande est de ${deliveryConfig.maxOrderQty} articles.`,
      });
    }

    let subtotalXof = 0;
    const resolvedLines: Array<{
      productId: string;
      variantId: string | null;
      productName: string;
      sku: string;
      selectedSize: string | null;
      selectedColor: string | null;
      soldInBulk: boolean;
      unitLabel: string;
      bulkMultiplier: number;
      orderedQty: number;
      unitPriceXof: number;
      lineTotalXof: number;
    }> = [];

    for (const item of input.items) {
      const prod = await shopClient.product.findUnique({
        where: { id: item.productId },
        include: {
          variants: { where: { isActive: true } },
          stockBalances: true,
        },
      });
      if (!prod || prod.status !== 'PUBLISHED') {
        throw new BadRequestException({
          code: 'PRODUCT_UNAVAILABLE',
          message: 'Un produit de votre panier n’est plus disponible.',
        });
      }

      let matchedVariant = null;
      if (item.variantId) {
        matchedVariant = prod.variants.find((v) => v.id === item.variantId) || null;
      } else if (item.selectedSize || item.selectedColor) {
        const needle = [item.selectedSize, item.selectedColor].filter(Boolean).join(' ').toLowerCase();
        matchedVariant =
          prod.variants.find((v) => v.name.toLowerCase().includes(needle)) || null;
      }

      const variantKey = matchedVariant?.id ?? 'BASE';
      const bal = prod.stockBalances.find((b) => b.variantKey === variantKey);
      const available = Math.max(0, (bal?.physicalQty ?? 0) - (bal?.reservedQty ?? 0));

      let soldInBulk = false;
      let bulkMultiplier = 1;
      let unitLabel = prod.unit || 'unité';
      let unitPriceXof = matchedVariant?.salePriceXof ?? prod.salePriceXof;
      let productName = matchedVariant ? `${prod.name} (${matchedVariant.name})` : prod.name;
      let sku = matchedVariant?.sku || prod.sku;

      if (item.soldInBulk) {
        if (!prod.unitsPerBulk || prod.unitsPerBulk < 2) {
          throw new BadRequestException({
            code: 'BULK_NOT_CONFIGURED',
            message: `Le conditionnement de gros n’est pas activé sur « ${prod.name} ».`,
          });
        }
        soldInBulk = true;
        bulkMultiplier = prod.unitsPerBulk;
        unitLabel = prod.bulkUnitLabel || 'carton';
        unitPriceXof = prod.bulkSalePriceXof ?? unitPriceXof * bulkMultiplier;
        productName = `${productName} [${unitLabel} ×${bulkMultiplier}]`;
      }

      const requiredUnits = item.quantity * bulkMultiplier;
      if (requiredUnits > available) {
        throw new BadRequestException({
          code: 'INSUFFICIENT_STOCK',
          message: `Stock insuffisant pour « ${productName} » (disponible : ${available} ${prod.unit}, demandé : ${requiredUnits} ${prod.unit}).`,
        });
      }
      const lineTotal = unitPriceXof * item.quantity;
      subtotalXof += lineTotal;
      resolvedLines.push({
        productId: prod.id,
        variantId: matchedVariant?.id ?? null,
        productName,
        sku,
        selectedSize: item.selectedSize?.trim() || null,
        selectedColor: item.selectedColor?.trim() || null,
        soldInBulk,
        unitLabel,
        bulkMultiplier,
        orderedQty: item.quantity,
        unitPriceXof,
        lineTotalXof: lineTotal,
      });
    }

    let deliveryFeeXof = 0;
    if (effectiveFulfillmentMode === 'DELIVERY') {
      const matchedZone = (deliveryConfig.deliveryZones || []).find(
        (z) => z.name.toLowerCase() === (input.deliveryDistrict || '').trim().toLowerCase(),
      );
      deliveryFeeXof = matchedZone ? matchedZone.feeXof : deliveryConfig.defaultDeliveryFeeXof;
    }

    const totalXof = subtotalXof + deliveryFeeXof;
    if (totalXof > (deliveryConfig.maxOrderAmountXof || 5_000_000)) {
      throw new BadRequestException({
        code: 'ORDER_AMOUNT_LIMIT',
        message: `Le montant maximal par commande en ligne est de ${formatXof(deliveryConfig.maxOrderAmountXof)}.`,
      });
    }

    const seqRows = await shopClient.$queryRaw<Array<{ nextval: bigint }>>`SELECT nextval('order_number_seq')`;
    const orderNumber = `CMD-${String(Number(seqRows[0].nextval)).padStart(6, '0')}`;
    const secretToken = crypto.randomBytes(24).toString('hex');

    let linkedClientId = this.verifyCustomerToken(customerToken, shop.id);
    if (!linkedClientId) {
      const existingByPhone = await shopClient.client.findUnique({
        where: { phone: cleanPhone },
        select: { id: true },
      });
      linkedClientId = existingByPhone?.id ?? null;
    }

    const created = await shopClient.onlineOrder.create({
      data: {
        orderNumber,
        secretToken,
        status: 'NEW',
        fulfillmentMode: effectiveFulfillmentMode,
        clientId: linkedClientId,
        clientName: input.clientName.trim(),
        clientPhone: cleanPhone,
        deliveryAddress: effectiveFulfillmentMode === 'DELIVERY' ? input.deliveryAddress?.trim() || null : null,
        deliveryDistrict: effectiveFulfillmentMode === 'DELIVERY' ? input.deliveryDistrict?.trim() || null : null,
        deliveryNotes: input.deliveryNotes?.trim() || null,
        deliveryFeeXof,
        subtotalXof,
        totalXof,
        outOfHours: !isOpenNow,
        marketingConsent: Boolean(input.marketingConsent),
        clientIp,
        expiresAt: new Date(Date.now() + 48 * 3_600_000),
        lines: { create: resolvedLines },
        statusEvents: {
          create: {
            fromStatus: null,
            toStatus: 'NEW',
            reason: linkedClientId
              ? 'Commande soumise depuis la vitrine QR (compte client)'
              : 'Commande soumise depuis la vitrine QR sans compte',
          },
        },
      },
      include: { lines: true, statusEvents: true },
    });

    // Notifie immédiatement le Propriétaire et les Agents de cette boutique
    await this.notificationsService.notifyMerchantOwners(shop.merchantId, {
      shopId: shop.id,
      type: 'ORDER',
      priority: 'URGENT',
      title: `Nouvelle commande ${orderNumber}`,
      message: `${created.clientName} (${formatXof(created.totalXof)}) — ${
        created.fulfillmentMode === 'DELIVERY' ? 'Livraison' : 'Retrait boutique'
      }.`,
      targetPath: '/commerce/orders',
    });

    const shopAgents = await this.controlPrisma.userShopAccess.findMany({
      where: { shopId: shop.id, isActive: true, user: { role: 'AGENT', isActive: true } },
      select: { userId: true },
    });
    for (const ag of shopAgents) {
      await this.notificationsService.create({
        merchantId: shop.merchantId,
        shopId: shop.id,
        recipientUserId: ag.userId,
        type: 'ORDER',
        priority: 'URGENT',
        title: `Nouvelle commande ${orderNumber}`,
        message: `${created.clientName} · ${formatXof(created.totalXof)} à vérifier et confirmer.`,
        targetPath: '/commerce/orders',
      });
    }

    return {
      orderId: created.id,
      orderNumber: created.orderNumber,
      secretToken: created.secretToken,
      trackingPath: `/s/${shop.slug}/track?token=${created.secretToken}`,
      status: created.status,
      subtotalXof: created.subtotalXof,
      deliveryFeeXof: created.deliveryFeeXof,
      totalXof: created.totalXof,
      outOfHours: created.outOfHours,
      outOfHoursMessage: created.outOfHours ? deliveryConfig.outOfHoursMessage : null,
      lines: created.lines,
      createdAt: created.createdAt.toISOString(),
    };
  }

  /**
   * Suivi sécurisé par lien secret (Critère #27) : donne accès uniquement à LA commande concernée.
   */
  async trackOrderBySecretToken(slug: string, token: string) {
    const resolved = await this.resolveShopBySlug(slug);
    if (!resolved.shop) {
      throw new NotFoundException({ code: 'SHOP_NOT_FOUND', message: 'Boutique introuvable.' });
    }
    const shopClient = await this.shopDbManager.getClientForShop(resolved.shop.id);
    const order = await shopClient.onlineOrder.findUnique({
      where: { secretToken: token.trim() },
      include: {
        lines: true,
        statusEvents: { orderBy: { createdAt: 'asc' } },
      },
    });
    if (!order) {
      throw new NotFoundException({ code: 'ORDER_NOT_FOUND', message: 'Lien de suivi invalide ou introuvable.' });
    }

    return {
      shop: {
        name: resolved.shop.name,
        slug: resolved.shop.slug,
        logoUrl: resolved.shop.logoUrl,
        phone: resolved.shop.phone,
        address: resolved.shop.address,
      },
      order: {
        id: order.id,
        orderNumber: order.orderNumber,
        status: order.status,
        fulfillmentMode: order.fulfillmentMode,
        clientName: order.clientName,
        deliveryDistrict: order.deliveryDistrict,
        deliveryAddress: order.deliveryAddress,
        subtotalXof: order.subtotalXof,
        deliveryFeeXof: order.deliveryFeeXof,
        totalXof: order.totalXof,
        outOfHours: order.outOfHours,
        cancelOrRejectReason: order.cancelOrRejectReason,
        canClientCancel: order.status === 'NEW',
        lines: order.lines,
        statusEvents: order.statusEvents.map((e) => ({
          toStatus: e.toStatus,
          reason: e.reason,
          createdAt: e.createdAt.toISOString(),
        })),
        createdAt: order.createdAt.toISOString(),
      },
    };
  }

  /**
   * Suivi sans lien secret par référence + téléphone (Critère #27) :
   * - Limité à 5 échecs / heure par IP et par commande
   * - N'affiche JAMAIS l'adresse complète ni l'historique de conversation !
   */
  async trackOrderByLookup(
    slug: string,
    input: { orderNumber: string; clientPhone: string },
    ipAddress: string,
  ) {
    const resolved = await this.resolveShopBySlug(slug);
    if (!resolved.shop) {
      throw new NotFoundException({ code: 'SHOP_NOT_FOUND', message: 'Boutique introuvable.' });
    }

    const orderNum = input.orderNumber.trim().toUpperCase();
    const phone = normalizePhone(input.clientPhone);
    const shopClient = await this.shopDbManager.getClientForShop(resolved.shop.id);
    const oneHourAgo = new Date(Date.now() - 3_600_000);

    const recentFails = await shopClient.orderTrackingAttempt.count({
      where: {
        orderNumber: orderNum,
        ipAddress,
        succeeded: false,
        createdAt: { gte: oneHourAgo },
      },
    });
    if (recentFails >= 5) {
      throw new HttpException(
        {
          code: 'TRACKING_RATE_LIMITED',
          message: 'Trop de tentatives infructueuses. Réessayez dans une heure ou utilisez votre lien secret.',
        },
        HttpStatus.TOO_MANY_REQUESTS,
      );
    }

    const order = await shopClient.onlineOrder.findUnique({
      where: { orderNumber: orderNum },
      select: {
        orderNumber: true,
        status: true,
        fulfillmentMode: true,
        clientPhone: true,
        totalXof: true,
        createdAt: true,
        updatedAt: true,
      },
    });

    if (!order || order.clientPhone !== phone) {
      await shopClient.orderTrackingAttempt.create({
        data: { orderNumber: orderNum, ipAddress, succeeded: false },
      });
      throw new NotFoundException({
        code: 'ORDER_LOOKUP_FAILED',
        message: 'Référence ou numéro de téléphone incorrect.',
      });
    }

    await shopClient.orderTrackingAttempt.create({
      data: { orderNumber: orderNum, ipAddress, succeeded: true },
    });

    // Données volontairement minimales (Section 8.6 : JAMAIS d'adresse complète ni de conversation)
    return {
      orderNumber: order.orderNumber,
      status: order.status,
      fulfillmentMode: order.fulfillmentMode,
      totalXof: order.totalXof,
      createdAt: order.createdAt.toISOString(),
      updatedAt: order.updatedAt.toISOString(),
    };
  }

  async cancelOrderBySecretToken(slug: string, token: string, reason?: string) {
    const resolved = await this.resolveShopBySlug(slug);
    if (!resolved.shop) throw new NotFoundException('Boutique introuvable.');
    const shopClient = await this.shopDbManager.getClientForShop(resolved.shop.id);
    const order = await shopClient.onlineOrder.findUnique({ where: { secretToken: token.trim() } });
    if (!order) throw new NotFoundException('Commande introuvable.');
    if (order.status !== 'NEW') {
      throw new ConflictException({
        code: 'ORDER_CANNOT_BE_CANCELLED',
        message: 'La commande est déjà en cours de traitement. Contactez la boutique pour l’annuler.',
      });
    }
    return shopClient.onlineOrder.update({
      where: { id: order.id },
      data: {
        status: 'CANCELLED',
        cancelOrRejectReason: reason?.trim() || 'Annulée par le client avant confirmation',
        statusEvents: {
          create: {
            fromStatus: 'NEW',
            toStatus: 'CANCELLED',
            reason: reason?.trim() || 'Annulée par le client avant confirmation',
          },
        },
      },
    });
  }

  // ============================================================================
  // BACK-OFFICE BOUTIQUE : TRAITEMENT COMMANDES, RÉSERVATION STOCK & VENTE
  // ============================================================================

  async listShopOrders(shopId: string, status?: string) {
    const client = await this.shopDbManager.getClientForShop(shopId);
    const orders = await client.onlineOrder.findMany({
      where: status ? { status } : undefined,
      orderBy: { createdAt: 'desc' },
      take: 100,
      include: {
        lines: true,
        statusEvents: { orderBy: { createdAt: 'desc' }, take: 5 },
      },
    });
    const twoHoursMs = 2 * 3_600_000;
    return orders.map((o) => ({
      ...o,
      isOverdueNew: o.status === 'NEW' && Date.now() - o.createdAt.getTime() > twoHoursMs,
      confirmedAt: o.confirmedAt?.toISOString() ?? null,
      completedAt: o.completedAt?.toISOString() ?? null,
      expiresAt: o.expiresAt?.toISOString() ?? null,
      createdAt: o.createdAt.toISOString(),
      updatedAt: o.updatedAt.toISOString(),
      statusEvents: o.statusEvents.map((e) => ({ ...e, createdAt: e.createdAt.toISOString() })),
    }));
  }

  /**
   * Confirmation commande (Critère #18) :
   * Vérifie stock disponible et RÉSERVE les quantités (`reservedQty += orderedQty`) dans une transaction avec verrou !
   */
  async confirmOrder(
    shopId: string,
    orderId: string,
    actor: AuthenticatedUser,
    operator: DeclaredOperatorContext | undefined,
    meta: RequestMeta,
  ) {
    const client = await this.shopDbManager.getClientForShop(shopId);
    const updated = await client.$transaction(async (tx) => {
      const order = await tx.onlineOrder.findUnique({
        where: { id: orderId },
        include: { lines: true },
      });
      if (!order) throw new NotFoundException({ code: 'ORDER_NOT_FOUND', message: 'Commande introuvable.' });
      if (order.status !== 'NEW') {
        throw new ConflictException({
          code: 'ORDER_INVALID_STATE',
          message: 'Seule une nouvelle commande peut être confirmée.',
        });
      }

      for (const line of order.lines) {
        const vKey = line.variantId ?? 'BASE';
        await tx.$executeRaw`
          INSERT INTO stock_balances (id, product_id, variant_id, variant_key, physical_qty, reserved_qty, updated_at)
          VALUES (gen_random_uuid(), ${line.productId}::uuid, ${line.variantId ?? null}::uuid, ${vKey}, 0, 0, CURRENT_TIMESTAMP)
          ON CONFLICT (product_id, variant_key) DO NOTHING
        `;
        const rows = await tx.$queryRaw<Array<{ id: string; physical_qty: number; reserved_qty: number }>>`
          SELECT id, physical_qty, reserved_qty
          FROM stock_balances
          WHERE product_id = ${line.productId}::uuid AND variant_key = ${vKey}
          FOR UPDATE
        `;
        const bal = rows[0];
        const available = (bal?.physical_qty ?? 0) - (bal?.reserved_qty ?? 0);
        const unitsToReserve = line.orderedQty * (line.bulkMultiplier || 1);
        if (unitsToReserve > available) {
          throw new BadRequestException({
            code: 'INSUFFICIENT_STOCK_FOR_RESERVATION',
            message: `Stock insuffisant pour réserver « ${line.productName} » (disponible : ${available}, demandé : ${unitsToReserve}).`,
          });
        }
        await tx.stockBalance.update({
          where: { id: bal.id },
          data: { reservedQty: bal.reserved_qty + unitsToReserve },
        });
      }

      return tx.onlineOrder.update({
        where: { id: order.id },
        data: {
          status: 'CONFIRMED',
          confirmedAt: new Date(),
          statusEvents: {
            create: {
              fromStatus: 'NEW',
              toStatus: 'CONFIRMED',
              actorUserId: actor.userId,
              declaredOperatorName: operator?.firstName ?? actor.fullName,
            },
          },
        },
        include: { lines: true },
      });
    });

    await this.auditService.recordShop({
      shopId,
      actorUserId: actor.userId,
      actorRole: actor.role,
      declaredOperatorId: operator?.id ?? null,
      declaredOperatorName: operator?.firstName ?? null,
      action: 'ORDER_CONFIRMED',
      entityType: 'OnlineOrder',
      entityId: updated.id,
      afterData: { orderNumber: updated.orderNumber, totalXof: updated.totalXof },
      ipAddress: meta.ipAddress,
      userAgent: meta.userAgent,
      correlationId: meta.correlationId,
    });

    return updated;
  }

  /**
   * Transition de statut commande (Section 8.7 & Critère #18) :
   * - Refus (`REJECTED`) : motif obligatoire
   * - Annulation (`CANCELLED`) ou Expiration (`EXPIRED`) d'une commande réservée : LIBÈRE immédiatement `reservedQty` !
   */
  async updateOrderStatus(
    shopId: string,
    orderId: string,
    input: { status: OnlineOrderStatus; reason?: string },
    actor: AuthenticatedUser,
    operator: DeclaredOperatorContext | undefined,
    meta: RequestMeta,
  ) {
    if (input.status === 'CONFIRMED') {
      return this.confirmOrder(shopId, orderId, actor, operator, meta);
    }
    if (input.status === 'COMPLETED') {
      throw new BadRequestException({
        code: 'USE_COMPLETE_ENDPOINT',
        message: 'Utilisez l’action « Finaliser & Encaisser » pour transformer la commande en vente.',
      });
    }
    if ((input.status === 'REJECTED' || input.status === 'CANCELLED') && (!input.reason || input.reason.trim().length < 3)) {
      throw new BadRequestException({
        code: 'REASON_REQUIRED',
        message: 'Un motif est obligatoire pour refuser ou annuler une commande.',
      });
    }

    const client = await this.shopDbManager.getClientForShop(shopId);
    const updated = await client.$transaction(async (tx) => {
      const order = await tx.onlineOrder.findUnique({
        where: { id: orderId },
        include: { lines: true },
      });
      if (!order) throw new NotFoundException({ code: 'ORDER_NOT_FOUND', message: 'Commande introuvable.' });
      if (['COMPLETED', 'REJECTED', 'CANCELLED', 'EXPIRED'].includes(order.status)) {
        throw new ConflictException({
          code: 'ORDER_ALREADY_CLOSED',
          message: 'Cette commande est déjà clôturée.',
        });
      }

      const wasReserved = RESERVED_STATUSES.has(order.status);
      const releasesReservation = ['REJECTED', 'CANCELLED', 'EXPIRED'].includes(input.status);

      if (wasReserved && releasesReservation) {
        for (const line of order.lines) {
          const vKey = line.variantId ?? 'BASE';
          const rows = await tx.$queryRaw<Array<{ id: string; reserved_qty: number }>>`
            SELECT id, reserved_qty FROM stock_balances
            WHERE product_id = ${line.productId}::uuid AND variant_key = ${vKey}
            FOR UPDATE
          `;
          if (rows[0]) {
            const unitsToRelease = line.orderedQty * (line.bulkMultiplier || 1);
            await tx.stockBalance.update({
              where: { id: rows[0].id },
              data: { reservedQty: Math.max(0, rows[0].reserved_qty - unitsToRelease) },
            });
          }
        }
      }

      return tx.onlineOrder.update({
        where: { id: order.id },
        data: {
          status: input.status,
          ...(releasesReservation ? { cancelOrRejectReason: input.reason?.trim() || null } : {}),
          statusEvents: {
            create: {
              fromStatus: order.status,
              toStatus: input.status,
              reason: input.reason?.trim() || null,
              actorUserId: actor.userId,
              declaredOperatorName: operator?.firstName ?? actor.fullName,
            },
          },
        },
        include: { lines: true },
      });
    });

    await this.auditService.recordShop({
      shopId,
      actorUserId: actor.userId,
      actorRole: actor.role,
      declaredOperatorId: operator?.id ?? null,
      declaredOperatorName: operator?.firstName ?? null,
      action: `ORDER_${input.status}`,
      entityType: 'OnlineOrder',
      entityId: updated.id,
      reason: input.reason || null,
      ipAddress: meta.ipAddress,
      userAgent: meta.userAgent,
      correlationId: meta.correlationId,
    });

    return updated;
  }

  /**
   * Transformation Commande -> Vente (Section 8.8 & Critère #19) :
   * - Libère la réservation stock et décrémente le stock physique (`SALE_OUT`)
   * - Crée la vente (`VTE-*`) + ticket `SaleDocument` + entrée caisse (si espèces)
   * - Lie la vente à la commande et passe la commande à `COMPLETED`
   */
  async completeOrderToSale(
    shopId: string,
    orderId: string,
    input: {
      paymentMethodCode: string;
      amountPaidXof: number;
      transactionRef?: string;
      deliveredQuantities?: Array<{ orderLineId: string; deliveredQty: number }>;
      notes?: string;
    },
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
    // Référence facultative (unicité contrôlée ailleurs si fournie)
    const ref = input.transactionRef?.trim() || null;

    const client = await this.shopDbManager.getClientForShop(shopId);

    const result = await client.$transaction(async (tx) => {
      const order = await tx.onlineOrder.findUnique({
        where: { id: orderId },
        include: { lines: true },
      });
      if (!order) throw new NotFoundException({ code: 'ORDER_NOT_FOUND', message: 'Commande introuvable.' });
      if (!RESERVED_STATUSES.has(order.status)) {
        throw new ConflictException({
          code: 'ORDER_MUST_BE_CONFIRMED',
          message: 'La commande doit être confirmée avant d’être remise et transformée en vente.',
        });
      }

      if (ref) {
        const dup = await tx.salePayment.findFirst({
          where: { paymentMethodCode: input.paymentMethodCode, transactionRef: ref },
        });
        if (dup) {
          throw new ConflictException({
            code: 'DUPLICATE_PAYMENT_REFERENCE',
            message: `Référence « ${ref} » déjà utilisée.`,
          });
        }
      }

      const deliveredMap = new Map(
        (input.deliveredQuantities || []).map((d) => [d.orderLineId, d.deliveredQty]),
      );

      // Trouve ou crée la fiche Client à partir du téléphone de la commande
      let clientRec = await tx.client.findUnique({ where: { phone: order.clientPhone } });
      if (!clientRec) {
        clientRec = await tx.client.create({
          data: {
            fullName: order.clientName,
            phone: order.clientPhone,
            address: order.deliveryAddress,
            creditLimitXof: 0,
          },
        });
      }

      const saleLinesData: Array<{
        productId: string;
        variantId?: string | null;
        productName: string;
        sku: string;
        quantity: number;
        unitLabel: string;
        soldInBulk: boolean;
        bulkMultiplier: number;
        unitPriceXof: number;
        unitCostXof: number | null;
      }> = [];

      // 1. Libère les réservations pour toutes les lignes & prépare les quantités remises
      for (const line of order.lines) {
        const deliveredQty = deliveredMap.has(line.id)
          ? Math.min(line.orderedQty, Math.max(0, deliveredMap.get(line.id)!))
          : line.orderedQty;
        const multiplier = line.bulkMultiplier && line.bulkMultiplier > 1 ? line.bulkMultiplier : 1;
        const vKey = line.variantId ?? 'BASE';

        const rows = await tx.$queryRaw<Array<{ id: string; reserved_qty: number }>>`
          SELECT id, reserved_qty FROM stock_balances
          WHERE product_id = ${line.productId}::uuid AND variant_key = ${vKey}
          FOR UPDATE
        `;
        if (rows[0]) {
          await tx.stockBalance.update({
            where: { id: rows[0].id },
            data: { reservedQty: Math.max(0, rows[0].reserved_qty - line.orderedQty * multiplier) },
          });
        }

        await tx.onlineOrderLine.update({
          where: { id: line.id },
          data: { deliveredQty },
        });

        if (deliveredQty > 0) {
          const prod = await tx.product.findUnique({
            where: { id: line.productId },
            include: { variants: true },
          });
          const matchedVariant = line.variantId
            ? prod?.variants.find((v) => v.id === line.variantId)
            : null;
          const variantTag = [line.selectedSize, line.selectedColor].filter(Boolean).join(' · ');
          saleLinesData.push({
            productId: line.productId,
            variantId: line.variantId,
            productName: variantTag ? `${line.productName} (${variantTag})` : line.productName,
            sku: line.sku,
            quantity: deliveredQty,
            unitLabel: line.unitLabel || prod?.unit || 'unité',
            soldInBulk: Boolean(line.soldInBulk),
            bulkMultiplier: multiplier,
            unitPriceXof: line.unitPriceXof,
            unitCostXof:
              (matchedVariant?.costPriceXof ?? prod?.costPriceXof) != null
                ? (matchedVariant?.costPriceXof ?? prod!.costPriceXof)! * multiplier
                : null,
          });
        }
      }

      if (saleLinesData.length === 0) {
        throw new BadRequestException({
          code: 'NO_DELIVERED_ITEMS',
          message: 'Aucune quantité remise au client.',
        });
      }

      const calc = calculateSaleTotals({
        lines: saleLinesData.map((l) => ({ quantity: l.quantity, unitPriceXof: l.unitPriceXof })),
        taxMode: shop.taxMode as TaxMode,
        defaultTaxRateBps: shop.defaultTaxRateBps,
      });

      const finalTotalXof = calc.totalXof + order.deliveryFeeXof;
      const effectivePaid = Math.min(input.amountPaidXof, finalTotalXof);
      const dueAmountXof = Math.max(0, finalTotalXof - effectivePaid);

      let openSessionId: string | null = null;
      if (effectivePaid > 0 && methodCfg.affectsCashDrawer) {
        const openSession = await this.cashService.getOpenSessionInTx(tx);
        if (!openSession) {
          throw new BadRequestException({
            code: 'CASH_SESSION_REQUIRED',
            message: 'Ouvrez une session de caisse pour encaisser une commande en espèces.',
          });
        }
        openSessionId = openSession.id;
      }

      const seqRows = await tx.$queryRaw<Array<{ nextval: bigint }>>`SELECT nextval('sale_number_seq')`;
      const saleNumber = `VTE-${String(Number(seqRows[0].nextval)).padStart(6, '0')}`;

      // 2. Décrémente stock physique (SALE_OUT) + Lots FEFO
      for (const l of saleLinesData) {
        const unitsToDeduct = l.quantity * (l.bulkMultiplier || 1);
        await this.inventoryService.applyMovementInTx(tx, {
          productId: l.productId,
          variantId: l.variantId ?? null,
          movementType: 'SALE_OUT',
          quantityDelta: -unitsToDeduct,
          unitCostXof: l.unitCostXof != null ? Math.round(l.unitCostXof / (l.bulkMultiplier || 1)) : null,
          referenceType: 'ONLINE_ORDER_SALE',
          referenceId: saleNumber,
          reason: `Remise commande ${order.orderNumber} → ${saleNumber}${l.soldInBulk ? ` (${l.quantity} ${l.unitLabel})` : ''}`,
          actorUserId: actor.userId,
          declaredOperatorId: operator?.id ?? null,
          declaredOperatorName: operator?.firstName ?? null,
        });
        await this.inventoryService.deductBatchesFefoInTx(tx, l.productId, unitsToDeduct);
      }

      // 3. Crée la vente
      const sale = await tx.sale.create({
        data: {
          saleNumber,
          status: 'COMPLETED',
          clientId: clientRec.id,
          cashSessionId: openSessionId,
          grossSubtotalXof: calc.grossSubtotalXof + order.deliveryFeeXof,
          discountTotalXof: calc.discountTotalXof,
          taxMode: shop.taxMode,
          taxRateBps: shop.defaultTaxRateBps,
          taxTotalXof: calc.taxTotalXof,
          roundingXof: 0,
          totalXof: finalTotalXof,
          paidAmountXof: effectivePaid,
          dueAmountXof,
          notes: `Commande en ligne ${order.orderNumber}${order.deliveryFeeXof > 0 ? ` (dont livraison ${formatXof(order.deliveryFeeXof)})` : ''}${input.notes ? ` · ${input.notes}` : ''}`,
          actorUserId: actor.userId,
          declaredOperatorId: operator?.id ?? null,
          declaredOperatorName: operator?.firstName ?? null,
          lines: {
            create: saleLinesData.map((l, idx) => ({
              productId: l.productId,
              productName: l.productName,
              sku: l.sku,
              quantity: l.quantity,
              unitLabel: l.unitLabel,
              soldInBulk: l.soldInBulk,
              bulkMultiplier: l.bulkMultiplier,
              unitPriceXof: l.unitPriceXof,
              unitCostXof: l.unitCostXof,
              discountXof: calc.lines[idx].discountXof,
              taxXof: calc.lines[idx].taxXof,
              lineTotalXof: calc.lines[idx].lineTotalXof,
            })),
          },
          payments:
            effectivePaid > 0
              ? {
                  create: [
                    {
                      paymentMethodCode: input.paymentMethodCode,
                      amountXof: effectivePaid,
                      transactionRef: ref,
                      affectsCashDrawer: methodCfg.affectsCashDrawer,
                    },
                  ],
                }
              : undefined,
        },
        include: { lines: true, payments: true },
      });

      if (effectivePaid > 0 && openSessionId && methodCfg.affectsCashDrawer) {
        await this.cashService.recordMovementInTx(tx, {
          sessionId: openSessionId,
          type: 'SALE_IN',
          amountXof: effectivePaid,
          referenceType: 'SALE',
          referenceId: sale.saleNumber,
          reason: `Encaissement commande ${order.orderNumber} (${sale.saleNumber})`,
          actorUserId: actor.userId,
          declaredOperatorId: operator?.id ?? null,
          declaredOperatorName: operator?.firstName ?? null,
        });
      }

      if (dueAmountXof > 0) {
        await tx.receivable.create({
          data: {
            clientId: clientRec.id,
            saleId: sale.id,
            initialAmountXof: dueAmountXof,
            paidAmountXof: 0,
            remainingAmountXof: dueAmountXof,
            status: 'OPEN',
          },
        });
      }

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
            orderNumber: order.orderNumber,
            issuedAt: sale.createdAt.toISOString(),
            client: { fullName: clientRec.fullName, phone: clientRec.phone },
            operatorName: operator?.firstName ?? actor.fullName,
            lines: [
              ...sale.lines.map((l) => ({
                productName: l.productName,
                sku: l.sku,
                quantity: l.quantity,
                unitPriceXof: l.unitPriceXof,
                discountXof: l.discountXof,
                lineTotalXof: l.lineTotalXof,
              })),
              ...(order.deliveryFeeXof > 0
                ? [
                    {
                      productName: 'Frais de livraison',
                      sku: 'LIVRAISON',
                      quantity: 1,
                      unitPriceXof: order.deliveryFeeXof,
                      discountXof: 0,
                      lineTotalXof: order.deliveryFeeXof,
                    },
                  ]
                : []),
            ],
            grossSubtotalXof: sale.grossSubtotalXof,
            discountTotalXof: sale.discountTotalXof,
            taxMode: sale.taxMode,
            taxRateBps: sale.taxRateBps,
            taxTotalXof: sale.taxTotalXof,
            roundingXof: 0,
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

      const completedOrder = await tx.onlineOrder.update({
        where: { id: order.id },
        data: {
          status: 'COMPLETED',
          convertedSaleId: sale.id,
          completedAt: new Date(),
          statusEvents: {
            create: {
              fromStatus: order.status,
              toStatus: 'COMPLETED',
              reason: `Transformée en vente ${sale.saleNumber}`,
              actorUserId: actor.userId,
              declaredOperatorName: operator?.firstName ?? actor.fullName,
            },
          },
        },
        include: { lines: true },
      });

      return { order: completedOrder, sale };
    });

    await this.auditService.recordShop({
      shopId,
      actorUserId: actor.userId,
      actorRole: actor.role,
      declaredOperatorId: operator?.id ?? null,
      declaredOperatorName: operator?.firstName ?? null,
      action: 'ORDER_CONVERTED_TO_SALE',
      entityType: 'OnlineOrder',
      entityId: result.order.id,
      afterData: {
        orderNumber: result.order.orderNumber,
        saleNumber: result.sale.saleNumber,
        totalXof: result.sale.totalXof,
      },
      ipAddress: meta.ipAddress,
      userAgent: meta.userAgent,
      correlationId: meta.correlationId,
    });

    return result;
  }

  // --- Liste noire numéros abusifs (Section 8.10) ---
  async listBlockedPhones(shopId: string) {
    const client = await this.shopDbManager.getClientForShop(shopId);
    const list = await client.blockedPhone.findMany({ orderBy: { createdAt: 'desc' } });
    return list.map((b) => ({ ...b, createdAt: b.createdAt.toISOString() }));
  }

  async blockPhone(shopId: string, input: { phone: string; reason?: string }, actor: AuthenticatedUser) {
    const clean = normalizePhone(input.phone);
    const client = await this.shopDbManager.getClientForShop(shopId);
    return client.blockedPhone.upsert({
      where: { phone: clean },
      create: { phone: clean, reason: input.reason || null, actorUserId: actor.userId },
      update: { reason: input.reason || null },
    });
  }

  async unblockPhone(shopId: string, id: string) {
    const client = await this.shopDbManager.getClientForShop(shopId);
    await client.blockedPhone.delete({ where: { id } }).catch(() => undefined);
    return { ok: true };
  }

  // --- Compte client optionnel sur vitrine publique ---
  private signCustomerToken(clientId: string, shopId: string): string {
    const env = getEnv();
    return jwt.sign({ sub: clientId, shopId, typ: 'shop_customer' }, env.JWT_ACCESS_SECRET, {
      expiresIn: '30d',
    });
  }

  private verifyCustomerToken(token: string | undefined, expectedShopId: string): string | null {
    if (!token) return null;
    try {
      const env = getEnv();
      const payload = jwt.verify(token, env.JWT_ACCESS_SECRET) as {
        sub?: string;
        shopId?: string;
        typ?: string;
      };
      if (payload.typ !== 'shop_customer' || !payload.sub || payload.shopId !== expectedShopId) {
        return null;
      }
      return payload.sub;
    } catch {
      return null;
    }
  }

  async registerPublicCustomer(
    slug: string,
    input: { fullName: string; phone: string; email?: string; address?: string; password: string },
  ) {
    const resolved = await this.resolveShopBySlug(slug);
    if (!resolved.shop) {
      throw new NotFoundException({ code: 'SHOP_NOT_FOUND', message: 'Boutique introuvable.' });
    }
    const shop = resolved.shop;
    const effectiveStatus = this.getEffectiveStatus(shop.merchant.status, shop.status);
    if (effectiveStatus === 'SUSPENDED' || effectiveStatus === 'TERMINATED') {
      throw new ForbiddenException({
        code: 'SHOP_UNAVAILABLE',
        message: 'Cette boutique est momentanément indisponible.',
      });
    }

    const cleanPhone = normalizePhone(input.phone);
    const cleanEmail = input.email?.trim().toLowerCase() || null;
    const shopClient = await this.shopDbManager.getClientForShop(shop.id);

    const existingByPhone = await shopClient.client.findUnique({ where: { phone: cleanPhone } });
    if (existingByPhone?.hasAccount) {
      throw new ConflictException({
        code: 'CUSTOMER_ACCOUNT_EXISTS',
        message: 'Un compte client existe déjà avec ce numéro. Connectez-vous.',
      });
    }

    if (cleanEmail) {
      const existingByEmail = await shopClient.client.findFirst({
        where: { email: cleanEmail, hasAccount: true },
      });
      if (existingByEmail) {
        throw new ConflictException({
          code: 'CUSTOMER_EMAIL_EXISTS',
          message: 'Cette adresse e-mail est déjà utilisée par un autre compte.',
        });
      }
    }

    const passwordHash = await argon2.hash(input.password, { type: argon2.argon2id });
    const now = new Date();

    const customer = existingByPhone
      ? await shopClient.client.update({
          where: { id: existingByPhone.id },
          data: {
            fullName: input.fullName.trim(),
            email: cleanEmail ?? existingByPhone.email,
            address: input.address?.trim() || existingByPhone.address,
            hasAccount: true,
            passwordHash,
            lastLoginAt: now,
          },
        })
      : await shopClient.client.create({
          data: {
            fullName: input.fullName.trim(),
            phone: cleanPhone,
            email: cleanEmail,
            address: input.address?.trim() || null,
            hasAccount: true,
            passwordHash,
            lastLoginAt: now,
          },
        });

    // Rattache automatiquement les commandes passées précédemment avec ce numéro
    await shopClient.onlineOrder.updateMany({
      where: { clientPhone: cleanPhone, clientId: null },
      data: { clientId: customer.id },
    });

    const token = this.signCustomerToken(customer.id, shop.id);
    return {
      token,
      customer: {
        id: customer.id,
        fullName: customer.fullName,
        phone: customer.phone,
        email: customer.email,
        address: customer.address,
      },
    };
  }

  async loginPublicCustomer(slug: string, input: { identifier: string; password: string }) {
    const resolved = await this.resolveShopBySlug(slug);
    if (!resolved.shop) {
      throw new NotFoundException({ code: 'SHOP_NOT_FOUND', message: 'Boutique introuvable.' });
    }
    const shop = resolved.shop;
    const shopClient = await this.shopDbManager.getClientForShop(shop.id);
    const raw = input.identifier.trim();
    const isEmail = raw.includes('@');

    const customer = isEmail
      ? await shopClient.client.findFirst({
          where: { email: raw.toLowerCase(), hasAccount: true },
        })
      : await shopClient.client.findFirst({
          where: { phone: normalizePhone(raw), hasAccount: true },
        });

    if (!customer || !customer.passwordHash || customer.isBlocked) {
      throw new UnauthorizedException({
        code: 'CUSTOMER_INVALID_CREDENTIALS',
        message: 'Identifiant ou mot de passe incorrect.',
      });
    }

    const ok = await argon2.verify(customer.passwordHash, input.password);
    if (!ok) {
      throw new UnauthorizedException({
        code: 'CUSTOMER_INVALID_CREDENTIALS',
        message: 'Identifiant ou mot de passe incorrect.',
      });
    }

    await shopClient.client.update({
      where: { id: customer.id },
      data: { lastLoginAt: new Date() },
    });

    const token = this.signCustomerToken(customer.id, shop.id);
    return {
      token,
      customer: {
        id: customer.id,
        fullName: customer.fullName,
        phone: customer.phone,
        email: customer.email,
        address: customer.address,
      },
    };
  }

  async getPublicCustomerProfile(slug: string, token: string | undefined) {
    const resolved = await this.resolveShopBySlug(slug);
    if (!resolved.shop) {
      return { authenticated: false as const, customer: null };
    }
    const shop = resolved.shop;
    const clientId = this.verifyCustomerToken(token, shop.id);
    if (!clientId) {
      return { authenticated: false as const, customer: null };
    }

    const shopClient = await this.shopDbManager.getClientForShop(shop.id);
    const customer = await shopClient.client.findUnique({
      where: { id: clientId },
      include: {
        onlineOrders: {
          orderBy: { createdAt: 'desc' },
          take: 25,
          include: { lines: true },
        },
        receivables: {
          orderBy: { createdAt: 'desc' },
          take: 20,
          include: {
            sale: { select: { saleNumber: true } },
            payments: { orderBy: { createdAt: 'desc' } },
          },
        },
      },
    });

    if (!customer || !customer.hasAccount || customer.isBlocked) {
      return { authenticated: false as const, customer: null };
    }

    const outstandingDebtXof = customer.receivables
      .filter((r) => r.status === 'OPEN' || r.status === 'PARTIALLY_PAID')
      .reduce((sum, r) => sum + r.remainingAmountXof, 0);

    return {
      authenticated: true as const,
      customer: {
        id: customer.id,
        fullName: customer.fullName,
        phone: customer.phone,
        email: customer.email,
        address: customer.address,
      },
      outstandingDebtXof,
      orders: customer.onlineOrders.map((o) => ({
        id: o.id,
        orderNumber: o.orderNumber,
        status: o.status,
        fulfillmentMode: o.fulfillmentMode,
        totalXof: o.totalXof,
        trackingPath: `/s/${shop.slug}/track?token=${o.secretToken}`,
        createdAt: o.createdAt.toISOString(),
        lines: o.lines.map((l) => ({
          id: l.id,
          productName: l.productName,
          selectedSize: l.selectedSize,
          selectedColor: l.selectedColor,
          orderedQty: l.orderedQty,
          lineTotalXof: l.lineTotalXof,
        })),
      })),
      receivables: customer.receivables.map((r) => ({
        id: r.id,
        status: r.status,
        description: r.description,
        dueDate: r.dueDate ? r.dueDate.toISOString() : null,
        saleNumber: r.sale?.saleNumber ?? null,
        initialAmountXof: r.initialAmountXof,
        paidAmountXof: r.paidAmountXof,
        remainingAmountXof: r.remainingAmountXof,
        createdAt: r.createdAt.toISOString(),
      })),
    };
  }
}

@ApiTags('Vitrine E-commerce & Commandes (Lot 5)')
@Controller()
export class OrdersController {
  constructor(private readonly ordersService: OrdersService) {}

  private setCustomerCookie(res: Response, token: string) {
    const env = getEnv();
    res.cookie('sc_customer_token', token, {
      httpOnly: true,
      secure: env.COOKIE_SECURE,
      sameSite: 'lax',
      path: '/',
      maxAge: 30 * 24 * 3600_000,
    });
  }

  private clearCustomerCookie(res: Response) {
    const env = getEnv();
    res.clearCookie('sc_customer_token', {
      httpOnly: true,
      secure: env.COOKIE_SECURE,
      sameSite: 'lax',
      path: '/',
    });
  }

  @Post('public/shops/:slug/auth/register')
  @Public()
  @ApiOperation({ summary: 'Créer un compte client optionnel sur une vitrine boutique' })
  async registerCustomer(
    @Param('slug') slug: string,
    @Body(new ZodValidationPipe(customerRegisterSchema))
    body: { fullName: string; phone: string; email?: string; address?: string; password: string },
    @Res({ passthrough: true }) res: Response,
  ) {
    const result = await this.ordersService.registerPublicCustomer(slug, body);
    this.setCustomerCookie(res, result.token);
    return { customer: result.customer };
  }

  @Post('public/shops/:slug/auth/login')
  @Public()
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Connexion client optionnelle sur une vitrine boutique' })
  async loginCustomer(
    @Param('slug') slug: string,
    @Body(new ZodValidationPipe(customerLoginSchema))
    body: { identifier: string; password: string },
    @Res({ passthrough: true }) res: Response,
  ) {
    const result = await this.ordersService.loginPublicCustomer(slug, body);
    this.setCustomerCookie(res, result.token);
    return { customer: result.customer };
  }

  @Post('public/shops/:slug/auth/logout')
  @Public()
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Déconnexion du compte client vitrine' })
  logoutCustomer(@Res({ passthrough: true }) res: Response) {
    this.clearCustomerCookie(res);
    return { ok: true };
  }

  @Get('public/shops/:slug/auth/me')
  @Public()
  @ApiOperation({ summary: 'Profil, commandes et solde du compte client connecté sur cette vitrine' })
  customerMe(@Param('slug') slug: string, @Req() req: RequestWithAuth) {
    const token = req.cookies?.sc_customer_token as string | undefined;
    return this.ordersService.getPublicCustomerProfile(slug, token);
  }

  @Get('public/shops/:slug/storefront')
  @Public()
  @ApiOperation({ summary: 'Catalogue public temps réel de la boutique (produits publiés & stock disponible)' })
  storefront(
    @Param('slug') slug: string,
    @Query('page') page?: string,
    @Query('limit') limit?: string,
    @Query('categoryId') categoryId?: string,
    @Query('search') search?: string,
  ) {
    return this.ordersService.getPublicStorefront(slug, {
      page: page ? Number(page) : 1,
      limit: limit ? Number(limit) : 100,
      categoryId,
      search,
    });
  }

  @Get('public/shops/:slug/qr')
  @Public()
  @ApiOperation({ summary: 'Générer le QR code permanent (SVG + PNG) pointant vers la vitrine boutique' })
  qr(@Param('slug') slug: string, @Query('origin') origin?: string) {
    return this.ordersService.generateShopQr(slug, origin);
  }

  @Post('public/shops/:slug/orders')
  @Public()
  @ApiOperation({ summary: 'Passer une commande client (avec ou sans compte) sur la vitrine' })
  createPublicOrder(
    @Param('slug') slug: string,
    @Body(new ZodValidationPipe(createPublicOrderSchema)) body: any,
    @Req() req: RequestWithAuth,
  ) {
    const ip =
      (req.headers['x-forwarded-for'] as string)?.split(',')[0]?.trim() || req.ip || 'unknown';
    const customerToken = req.cookies?.sc_customer_token as string | undefined;
    return this.ordersService.createPublicOrder(slug, body, ip, customerToken);
  }

  @Get('public/shops/:slug/orders/track')
  @Public()
  @ApiOperation({ summary: 'Suivre une commande via son lien secret unique' })
  trackByToken(@Param('slug') slug: string, @Query('token') token: string) {
    if (!token) throw new BadRequestException('Jeton de suivi manquant.');
    return this.ordersService.trackOrderBySecretToken(slug, token);
  }

  @Post('public/shops/:slug/orders/track-lookup')
  @Public()
  @ApiOperation({ summary: 'Suivi minimal par référence + téléphone (limité à 5 échecs/heure)' })
  trackLookup(
    @Param('slug') slug: string,
    @Body(new ZodValidationPipe(trackOrderLookupSchema)) body: { orderNumber: string; clientPhone: string },
    @Req() req: RequestWithAuth,
  ) {
    const ip =
      (req.headers['x-forwarded-for'] as string)?.split(',')[0]?.trim() || req.ip || 'unknown';
    return this.ordersService.trackOrderByLookup(slug, body, ip);
  }

  @Post('public/shops/:slug/orders/cancel-by-token')
  @Public()
  @ApiOperation({ summary: 'Annuler sa commande avant confirmation via le lien secret' })
  cancelByToken(
    @Param('slug') slug: string,
    @Body() body: { token: string; reason?: string },
  ) {
    if (!body?.token) throw new BadRequestException('Jeton manquant.');
    return this.ordersService.cancelOrderBySecretToken(slug, body.token, body.reason);
  }

  // --- Back-office ---
  @Get('shops/:shopId/orders')
  @ApiBearerAuth()
  @UseGuards(ShopScopeGuard, PermissionsGuard)
  @Roles('OWNER', 'AGENT')
  @RequirePermissions('orders:read')
  @ApiOperation({ summary: 'Lister les commandes en ligne reçues par la boutique' })
  listShopOrders(@Param('shopId') shopId: string, @Query('status') status?: string) {
    return this.ordersService.listShopOrders(shopId, status);
  }

  @Post('shops/:shopId/orders/:orderId/confirm')
  @ApiBearerAuth()
  @UseGuards(ShopScopeGuard, PermissionsGuard, OperatorGuard)
  @Roles('OWNER', 'AGENT')
  @RequirePermissions('orders:confirm')
  @RequireOperator()
  @ApiOperation({ summary: 'Confirmer une commande et réserver le stock immédiatement' })
  confirmOrder(
    @Param('shopId') shopId: string,
    @Param('orderId') orderId: string,
    @CurrentUser() user: AuthenticatedUser,
    @CurrentOperator() operator: DeclaredOperatorContext | undefined,
    @Req() req: RequestWithAuth,
  ) {
    return this.ordersService.confirmOrder(shopId, orderId, user, operator, {
      ipAddress: req.ip || null,
      userAgent: req.header('user-agent') || null,
      correlationId: req.correlationId || null,
    });
  }

  @Post('shops/:shopId/orders/:orderId/status')
  @ApiBearerAuth()
  @UseGuards(ShopScopeGuard, PermissionsGuard, OperatorGuard)
  @Roles('OWNER', 'AGENT')
  @RequirePermissions('orders:read')
  @RequireOperator()
  @ApiOperation({ summary: 'Faire évoluer le statut d’une commande (préparation, prête, livraison, refus, annulation)' })
  updateStatus(
    @Param('shopId') shopId: string,
    @Param('orderId') orderId: string,
    @Body(new ZodValidationPipe(updateOrderStatusSchema)) body: any,
    @CurrentUser() user: AuthenticatedUser,
    @CurrentOperator() operator: DeclaredOperatorContext | undefined,
    @Req() req: RequestWithAuth,
  ) {
    if (user.role === 'AGENT') {
      const access = user.shopAccesses.find((s) => s.shopId === shopId);
      const perms = access?.permissions;
      const needed =
        body.status === 'REJECTED' || body.status === 'CANCELLED'
          ? 'orders:refuse'
          : body.status === 'IN_DELIVERY'
            ? 'orders:deliver'
            : body.status === 'CONTACTED'
              ? 'orders:contact'
              : 'orders:prepare';
      if (!perms || !perms[needed]) {
        throw new ForbiddenException({
          code: 'PERMISSION_DENIED',
          message: `Permission requise : ${needed}.`,
        });
      }
    }
    return this.ordersService.updateOrderStatus(shopId, orderId, body, user, operator, {
      ipAddress: req.ip || null,
      userAgent: req.header('user-agent') || null,
      correlationId: req.correlationId || null,
    });
  }

  @Post('shops/:shopId/orders/:orderId/complete')
  @ApiBearerAuth()
  @UseGuards(ShopScopeGuard, PermissionsGuard, OperatorGuard)
  @Roles('OWNER', 'AGENT')
  @RequirePermissions('orders:deliver', 'sales:create')
  @RequireOperator()
  @ApiOperation({ summary: 'Remettre la commande au client -> crée la vente, décrémente stock, encaisse et génère le ticket' })
  completeOrder(
    @Param('shopId') shopId: string,
    @Param('orderId') orderId: string,
    @Body(new ZodValidationPipe(completeOrderToSaleSchema)) body: any,
    @CurrentUser() user: AuthenticatedUser,
    @CurrentOperator() operator: DeclaredOperatorContext | undefined,
    @Req() req: RequestWithAuth,
  ) {
    return this.ordersService.completeOrderToSale(shopId, orderId, body, user, operator, {
      ipAddress: req.ip || null,
      userAgent: req.header('user-agent') || null,
      correlationId: req.correlationId || null,
    });
  }

  @Get('shops/:shopId/blocked-phones')
  @ApiBearerAuth()
  @UseGuards(ShopScopeGuard)
  @Roles('OWNER', 'AGENT')
  listBlocked(@Param('shopId') shopId: string) {
    return this.ordersService.listBlockedPhones(shopId);
  }

  @Post('shops/:shopId/blocked-phones')
  @ApiBearerAuth()
  @UseGuards(ShopScopeGuard, PermissionsGuard)
  @Roles('OWNER', 'AGENT')
  @RequirePermissions('orders:refuse')
  blockPhone(
    @Param('shopId') shopId: string,
    @Body(new ZodValidationPipe(blockPhoneSchema)) body: { phone: string; reason?: string },
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.ordersService.blockPhone(shopId, body, user);
  }

  @Delete('shops/:shopId/blocked-phones/:id')
  @ApiBearerAuth()
  @UseGuards(ShopScopeGuard)
  @Roles('OWNER')
  unblockPhone(@Param('shopId') shopId: string, @Param('id') id: string) {
    return this.ordersService.unblockPhone(shopId, id);
  }
}

@Module({
  controllers: [OrdersController],
  providers: [OrdersService],
  exports: [OrdersService],
})
export class OrdersModule {}
