import * as crypto from 'crypto';
import {
  ConflictException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import {
  DEFAULT_CURRENCY,
  DEFAULT_DAILY_REPORT_TIME,
  DEFAULT_OPENING_HOURS,
  DEFAULT_PAYMENT_METHODS,
  DEFAULT_TIMEZONE,
  slugifyShopName,
  TaxMode,
  TenantStatus,
} from '@shopcontrol/shared';
import { ControlPrismaService } from '../../common/database/control-prisma.service';
import { ShopDatabaseManagerService } from '../../common/database/shop-database-manager.service';
import { AuditService } from '../audit/audit.service';
import { AuthenticatedUser } from '../../common/auth/request-context.types';
import { RequestMeta } from '../auth/auth.service';

export interface CreateShopPayload {
  name: string;
  slug?: string;
  phone?: string;
  email?: string;
  address?: string;
  currency?: string;
  timezone?: string;
  dailyReportTime?: string;
  taxMode?: TaxMode;
  defaultTaxRateBps?: number;
  requireOperatorPin?: boolean;
  openingHours?: unknown;
  paymentMethods?: unknown;
}

@Injectable()
export class ShopsService {
  private readonly logger = new Logger(ShopsService.name);

  constructor(
    private readonly controlPrisma: ControlPrismaService,
    private readonly shopDbManager: ShopDatabaseManagerService,
    private readonly auditService: AuditService,
  ) {}

  async ensureUniqueSlug(desired: string): Promise<string> {
    const base = slugifyShopName(desired);
    let candidate = base;
    let attempt = 0;

    while (attempt < 50) {
      const [existingShop, existingRedirect] = await Promise.all([
        this.controlPrisma.shop.findUnique({ where: { slug: candidate }, select: { id: true } }),
        this.controlPrisma.shopSlugRedirect.findUnique({
          where: { oldSlug: candidate },
          select: { id: true },
        }),
      ]);
      if (!existingShop && !existingRedirect) {
        return candidate;
      }
      attempt += 1;
      candidate = `${base}-${attempt + 1}`;
    }

    return `${base}-${crypto.randomBytes(2).toString('hex')}`;
  }

  /**
   * Crée une boutique dans Control DB puis provisionne et migre automatiquement
   * sa propre base de données PostgreSQL dédiée (`shopcontrol_shop_<id>`).
   */
  async createShopForMerchant(
    merchantId: string,
    input: CreateShopPayload,
    actor: { userId: string; role: 'OWNER' | 'SUPER_ADMIN' },
    meta: RequestMeta,
  ) {
    const merchant = await this.controlPrisma.merchant.findUnique({
      where: { id: merchantId },
      select: { id: true, currency: true, defaultTimezone: true },
    });
    if (!merchant) {
      throw new NotFoundException({ code: 'MERCHANT_NOT_FOUND', message: 'Marchand introuvable.' });
    }

    let slug: string;
    if (input.slug) {
      const clean = input.slug.trim().toLowerCase();
      const [dupShop, dupRedirect] = await Promise.all([
        this.controlPrisma.shop.findUnique({ where: { slug: clean }, select: { id: true } }),
        this.controlPrisma.shopSlugRedirect.findUnique({
          where: { oldSlug: clean },
          select: { id: true },
        }),
      ]);
      if (dupShop || dupRedirect) {
        throw new ConflictException({
          code: 'SLUG_ALREADY_USED',
          message: `L’identifiant URL « ${clean} » est déjà utilisé par une autre boutique.`,
        });
      }
      slug = clean;
    } else {
      slug = await this.ensureUniqueSlug(input.name);
    }

    const shopId = crypto.randomUUID();
    const dbName = this.shopDbManager.buildShopDatabaseName(shopId);
    const currency = input.currency || merchant.currency || DEFAULT_CURRENCY;
    const timezone = input.timezone || merchant.defaultTimezone || DEFAULT_TIMEZONE;
    const dailyReportTime = input.dailyReportTime || DEFAULT_DAILY_REPORT_TIME;
    const openingHours = input.openingHours ?? DEFAULT_OPENING_HOURS;
    const paymentMethods = input.paymentMethods ?? DEFAULT_PAYMENT_METHODS;

    const shop = await this.controlPrisma.shop.create({
      data: {
        id: shopId,
        merchantId,
        name: input.name,
        slug,
        status: 'ACTIVE',
        dbName,
        dbStatus: 'PROVISIONING',
        phone: input.phone || null,
        email: input.email || null,
        address: input.address || null,
        currency,
        timezone,
        dailyReportTime,
        taxMode: input.taxMode || 'NONE',
        defaultTaxRateBps: input.defaultTaxRateBps ?? 0,
        requireOperatorPin: input.requireOperatorPin ?? false,
        openingHours: openingHours as object,
        paymentMethods: paymentMethods as object,
      },
    });

    try {
      const provisioned = await this.shopDbManager.provisionShopDatabase({
        id: shop.id,
        merchantId: shop.merchantId,
        name: shop.name,
        slug: shop.slug,
        dbName: shop.dbName,
        currency: shop.currency,
        timezone: shop.timezone,
        dailyReportTime: shop.dailyReportTime,
        taxMode: shop.taxMode,
        defaultTaxRateBps: shop.defaultTaxRateBps,
        requireOperatorPin: shop.requireOperatorPin,
        paymentMethods: shop.paymentMethods,
        openingHours: shop.openingHours,
      });

      const readyShop = await this.controlPrisma.shop.update({
        where: { id: shop.id },
        data: {
          dbStatus: 'READY',
          dbSchemaVersion: provisioned.schemaVersion,
        },
      });

      await this.auditService.recordControl({
        merchantId,
        shopId: readyShop.id,
        actorUserId: actor.userId,
        actorRole: actor.role,
        action: 'SHOP_CREATED',
        entityType: 'Shop',
        entityId: readyShop.id,
        afterData: {
          name: readyShop.name,
          slug: readyShop.slug,
          dbName: readyShop.dbName,
          dbSchemaVersion: readyShop.dbSchemaVersion,
        },
        ipAddress: meta.ipAddress,
        userAgent: meta.userAgent,
        correlationId: meta.correlationId,
      });

      await this.auditService.recordShop({
        shopId: readyShop.id,
        actorUserId: actor.userId,
        actorRole: actor.role,
        action: 'SHOP_DB_PROVISIONED',
        entityType: 'ShopDatabase',
        entityId: readyShop.dbName,
        afterData: {
          dbName: readyShop.dbName,
          schemaVersion: provisioned.schemaVersion,
        },
        ipAddress: meta.ipAddress,
        userAgent: meta.userAgent,
        correlationId: meta.correlationId,
      });

      return readyShop;
    } catch (err) {
      this.logger.error(`Échec du provisionnement BDD pour la boutique ${shop.id} (${dbName})`, err);
      await this.controlPrisma.shop.update({
        where: { id: shop.id },
        data: { dbStatus: 'MIGRATION_FAILED' },
      });
      await this.auditService.recordControl({
        merchantId,
        shopId: shop.id,
        actorUserId: actor.userId,
        actorRole: actor.role,
        action: 'SHOP_DB_MIGRATION_FAILED',
        entityType: 'Shop',
        entityId: shop.id,
        afterData: { dbName, error: err instanceof Error ? err.message : 'unknown' },
        ipAddress: meta.ipAddress,
        userAgent: meta.userAgent,
        correlationId: meta.correlationId,
      });
      throw err;
    }
  }

  async listShopsForUser(user: AuthenticatedUser) {
    const shopIds = user.shopAccesses.map((s) => s.shopId);
    if (shopIds.length === 0) {
      return [];
    }

    const shops = await this.controlPrisma.shop.findMany({
      where: { id: { in: shopIds } },
      orderBy: { createdAt: 'asc' },
      include: {
        _count: {
          select: {
            userAccesses: { where: { isActive: true } },
            slugRedirects: true,
          },
        },
      },
    });

    return Promise.all(
      shops.map(async (shop) => {
        let operatorsCount = 0;
        let terminalsCount = 0;
        if (shop.dbStatus === 'READY') {
          const client = await this.shopDbManager.getClientForShop(shop.id);
          const [ops, terms] = await Promise.all([
            client.shopOperator.count({ where: { isActive: true } }),
            client.terminal.count({ where: { isActive: true } }),
          ]);
          operatorsCount = ops;
          terminalsCount = terms;
        }

        return {
          id: shop.id,
          merchantId: shop.merchantId,
          name: shop.name,
          slug: shop.slug,
          status: shop.status,
          statusReason: shop.statusReason,
          dbName: shop.dbName,
          dbStatus: shop.dbStatus,
          dbSchemaVersion: shop.dbSchemaVersion,
          phone: shop.phone,
          email: shop.email,
          address: shop.address,
          currency: shop.currency,
          timezone: shop.timezone,
          dailyReportTime: shop.dailyReportTime,
          taxMode: shop.taxMode,
          defaultTaxRateBps: shop.defaultTaxRateBps,
          requireOperatorPin: shop.requireOperatorPin,
          openingHours: shop.openingHours,
          paymentMethods: shop.paymentMethods,
          activeAgentsCount: shop._count.userAccesses,
          activeOperatorsCount: operatorsCount,
          activeTerminalsCount: terminalsCount,
          createdAt: shop.createdAt.toISOString(),
        };
      }),
    );
  }

  async getShopDetails(shopId: string) {
    const shop = await this.controlPrisma.shop.findUnique({
      where: { id: shopId },
      include: {
        slugRedirects: { orderBy: { createdAt: 'desc' } },
      },
    });
    if (!shop) {
      throw new NotFoundException({ code: 'SHOP_NOT_FOUND', message: 'Boutique introuvable.' });
    }
    return shop;
  }

  async updateShop(
    shopId: string,
    input: Partial<CreateShopPayload>,
    user: AuthenticatedUser,
    meta: RequestMeta,
  ) {
    const existing = await this.controlPrisma.shop.findUnique({ where: { id: shopId } });
    if (!existing) {
      throw new NotFoundException({ code: 'SHOP_NOT_FOUND', message: 'Boutique introuvable.' });
    }

    let slugChanged = false;
    let nextSlug = existing.slug;
    if (input.slug && input.slug.trim().toLowerCase() !== existing.slug) {
      const candidate = input.slug.trim().toLowerCase();
      const [dupShop, dupRedirect] = await Promise.all([
        this.controlPrisma.shop.findUnique({ where: { slug: candidate } }),
        this.controlPrisma.shopSlugRedirect.findUnique({ where: { oldSlug: candidate } }),
      ]);
      if (dupShop && dupShop.id !== shopId) {
        throw new ConflictException({
          code: 'SLUG_ALREADY_USED',
          message: `L’identifiant URL « ${candidate} » est déjà utilisé.`,
        });
      }
      if (dupRedirect && dupRedirect.shopId !== shopId) {
        throw new ConflictException({
          code: 'SLUG_ALREADY_USED',
          message: `L’identifiant URL « ${candidate} » est réservé par une redirection existante.`,
        });
      }
      slugChanged = true;
      nextSlug = candidate;
    }

    const updated = await this.controlPrisma.$transaction(async (tx) => {
      if (slugChanged) {
        // Supprime une éventuelle ancienne redirection si la boutique reprend un ancien slug qui lui appartenait
        await tx.shopSlugRedirect.deleteMany({
          where: { oldSlug: nextSlug, shopId },
        });
        // Enregistre l'ancien slug pour garantir que les QR codes déjà imprimés redirigent (Section 8.1)
        await tx.shopSlugRedirect.upsert({
          where: { oldSlug: existing.slug },
          create: { oldSlug: existing.slug, shopId },
          update: { shopId },
        });
      }

      return tx.shop.update({
        where: { id: shopId },
        data: {
          ...(input.name !== undefined ? { name: input.name } : {}),
          ...(slugChanged ? { slug: nextSlug } : {}),
          ...(input.phone !== undefined ? { phone: input.phone || null } : {}),
          ...(input.email !== undefined ? { email: input.email || null } : {}),
          ...(input.address !== undefined ? { address: input.address || null } : {}),
          ...(input.currency !== undefined ? { currency: input.currency } : {}),
          ...(input.timezone !== undefined ? { timezone: input.timezone } : {}),
          ...(input.dailyReportTime !== undefined ? { dailyReportTime: input.dailyReportTime } : {}),
          ...(input.taxMode !== undefined ? { taxMode: input.taxMode } : {}),
          ...(input.defaultTaxRateBps !== undefined ? { defaultTaxRateBps: input.defaultTaxRateBps } : {}),
          ...(input.requireOperatorPin !== undefined
            ? { requireOperatorPin: input.requireOperatorPin }
            : {}),
          ...(input.openingHours !== undefined ? { openingHours: input.openingHours as object } : {}),
          ...(input.paymentMethods !== undefined
            ? { paymentMethods: input.paymentMethods as object }
            : {}),
        },
      });
    });

    if (updated.dbStatus === 'READY') {
      await this.shopDbManager.syncShopLocalConfig({
        id: updated.id,
        merchantId: updated.merchantId,
        name: updated.name,
        slug: updated.slug,
        dbName: updated.dbName,
        currency: updated.currency,
        timezone: updated.timezone,
        dailyReportTime: updated.dailyReportTime,
        taxMode: updated.taxMode,
        defaultTaxRateBps: updated.defaultTaxRateBps,
        requireOperatorPin: updated.requireOperatorPin,
        paymentMethods: updated.paymentMethods,
        openingHours: updated.openingHours,
      });
    }

    await this.auditService.recordControl({
      merchantId: updated.merchantId,
      shopId: updated.id,
      actorUserId: user.userId,
      actorRole: user.role,
      action: slugChanged ? 'SHOP_SLUG_CHANGED' : 'SHOP_UPDATED',
      entityType: 'Shop',
      entityId: updated.id,
      beforeData: {
        name: existing.name,
        slug: existing.slug,
        requireOperatorPin: existing.requireOperatorPin,
        taxMode: existing.taxMode,
      },
      afterData: {
        name: updated.name,
        slug: updated.slug,
        requireOperatorPin: updated.requireOperatorPin,
        taxMode: updated.taxMode,
      },
      ipAddress: meta.ipAddress,
      userAgent: meta.userAgent,
      correlationId: meta.correlationId,
    });

    return updated;
  }

  /**
   * Synthèse réelle d'une boutique, lue directement depuis sa base PostgreSQL dédiée.
   */
  async getShopOverview(shopId: string) {
    const shop = await this.controlPrisma.shop.findUnique({
      where: { id: shopId },
      include: {
        _count: {
          select: { userAccesses: { where: { isActive: true } } },
        },
      },
    });
    if (!shop) {
      throw new NotFoundException({ code: 'SHOP_NOT_FOUND', message: 'Boutique introuvable.' });
    }

    let activeOperatorsCount = 0;
    let activeTerminalsCount = 0;
    let shopAuditCount = 0;
    let recentShopEvents: Array<{
      id: string;
      action: string;
      entityType: string;
      declaredOperatorName: string | null;
      createdAt: string;
    }> = [];

    if (shop.dbStatus === 'READY') {
      const client = await this.shopDbManager.getClientForShop(shop.id);
      const [ops, terms, auditCount, latest] = await Promise.all([
        client.shopOperator.count({ where: { isActive: true } }),
        client.terminal.count({ where: { isActive: true } }),
        client.shopAuditLog.count(),
        client.shopAuditLog.findMany({
          orderBy: { createdAt: 'desc' },
          take: 8,
          select: {
            id: true,
            action: true,
            entityType: true,
            declaredOperatorName: true,
            createdAt: true,
          },
        }),
      ]);
      activeOperatorsCount = ops;
      activeTerminalsCount = terms;
      shopAuditCount = auditCount;
      recentShopEvents = latest.map((e) => ({
        ...e,
        createdAt: e.createdAt.toISOString(),
      }));
    }

    return {
      shop: {
        id: shop.id,
        name: shop.name,
        slug: shop.slug,
        status: shop.status,
        dbName: shop.dbName,
        dbStatus: shop.dbStatus,
        dbSchemaVersion: shop.dbSchemaVersion,
        currency: shop.currency,
        timezone: shop.timezone,
        dailyReportTime: shop.dailyReportTime,
        requireOperatorPin: shop.requireOperatorPin,
      },
      metrics: {
        activeAgentsCount: shop._count.userAccesses,
        activeOperatorsCount,
        activeTerminalsCount,
        shopAuditCount,
      },
      recentShopEvents,
    };
  }

  /**
   * Route publique (préparation Lot 5 + Critère #29) :
   * Résout un slug ou une redirection d'ancien slug, et reflète exactement la cascade de statuts.
   */
  async getPublicShopStatus(slug: string) {
    const clean = slug.trim().toLowerCase();

    let shop = await this.controlPrisma.shop.findUnique({
      where: { slug: clean },
      include: {
        merchant: { select: { name: true, status: true } },
      },
    });

    if (!shop) {
      const redirect = await this.controlPrisma.shopSlugRedirect.findUnique({
        where: { oldSlug: clean },
        include: {
          shop: {
            include: { merchant: { select: { name: true, status: true } } },
          },
        },
      });
      if (!redirect) {
        throw new NotFoundException({
          code: 'SHOP_NOT_FOUND',
          message: 'Cette boutique est introuvable.',
        });
      }
      return {
        redirectToSlug: redirect.shop.slug,
        available: false,
        status: redirect.shop.status,
      };
    }

    const effectiveStatus = this.resolveEffectivePublicStatus(
      shop.merchant.status as TenantStatus,
      shop.status as TenantStatus,
    );

    if (effectiveStatus === 'SUSPENDED') {
      return {
        redirectToSlug: null,
        available: false,
        status: 'SUSPENDED' as const,
        shopName: shop.name,
        message: 'Boutique momentanément indisponible. Aucune commande ne peut être passée pour le moment.',
      };
    }

    if (effectiveStatus === 'TERMINATED') {
      return {
        redirectToSlug: null,
        available: false,
        status: 'TERMINATED' as const,
        shopName: shop.name,
        message: 'Cette vitrine n’est plus en ligne.',
      };
    }

    return {
      redirectToSlug: null,
      available: true,
      status: effectiveStatus,
      shop: {
        id: shop.id,
        name: shop.name,
        slug: shop.slug,
        phone: shop.phone,
        address: shop.address,
        currency: shop.currency,
        timezone: shop.timezone,
        openingHours: shop.openingHours,
      },
    };
  }

  private resolveEffectivePublicStatus(
    merchantStatus: TenantStatus,
    shopStatus: TenantStatus,
  ): TenantStatus {
    if (merchantStatus === 'TERMINATED' || shopStatus === 'TERMINATED') return 'TERMINATED';
    if (merchantStatus === 'SUSPENDED' || shopStatus === 'SUSPENDED') return 'SUSPENDED';
    if (merchantStatus === 'PAST_DUE' || shopStatus === 'PAST_DUE') return 'PAST_DUE';
    return 'ACTIVE';
  }
}
