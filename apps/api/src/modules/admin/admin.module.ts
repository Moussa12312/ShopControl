import {
  BadRequestException,
  Body,
  ConflictException,
  Controller,
  Delete,
  Get,
  Injectable,
  Module,
  NotFoundException,
  Param,
  Patch,
  Post,
  Query,
  Req,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import * as argon2 from 'argon2';
import {
  adminCreateShopSchema,
  adminUpdateShopTypesSchema,
  canShopDeliver,
  createMerchantSchema,
  createSupportAccessSchema,
  DEFAULT_DELIVERY_CONFIG,
  normalizeBusinessProfile,
  normalizeShopType,
  SHOP_TYPE_SHORT_LABELS,
  ShopType,
  TenantStatus,
  TENANT_STATUS_LABELS,
  updateTenantStatusSchema,
} from '@shopcontrol/shared';
import { CurrentUser, Roles } from '../../common/auth/auth.decorators';
import { AuthenticatedUser, RequestWithAuth } from '../../common/auth/request-context.types';
import { ControlPrismaService } from '../../common/database/control-prisma.service';
import { ShopDatabaseManagerService } from '../../common/database/shop-database-manager.service';
import { ZodValidationPipe } from '../../common/validation/zod-validation.pipe';
import { AuditService } from '../audit/audit.service';
import { NotificationsService } from '../notifications/notifications.module';
import { ShopsModule } from '../shops/shops.module';
import { ShopsService } from '../shops/shops.service';
import { RequestMeta } from '../auth/auth.service';

@Injectable()
export class AdminService {
  constructor(
    private readonly controlPrisma: ControlPrismaService,
    private readonly shopDbManager: ShopDatabaseManagerService,
    private readonly shopsService: ShopsService,
    private readonly auditService: AuditService,
    private readonly notificationsService: NotificationsService,
  ) {}

  async getDashboard() {
    const [
      merchantsByStatus,
      shopsByStatus,
      shopsByDbStatus,
      activeSessionsCount,
      activeSupportGrantsCount,
      recentAudit,
    ] = await Promise.all([
      this.controlPrisma.merchant.groupBy({ by: ['status'], _count: { id: true } }),
      this.controlPrisma.shop.groupBy({ by: ['status'], _count: { id: true } }),
      this.controlPrisma.shop.groupBy({ by: ['dbStatus'], _count: { id: true } }),
      this.controlPrisma.userSession.count({
        where: { revokedAt: null, expiresAt: { gt: new Date() } },
      }),
      this.controlPrisma.supportAccessGrant.count({
        where: { revokedAt: null, expiresAt: { gt: new Date() } },
      }),
      this.controlPrisma.auditLog.findMany({
        orderBy: { createdAt: 'desc' },
        take: 10,
        include: { actor: { select: { fullName: true } } },
      }),
    ]);

    const toRecord = (rows: Array<{ _count: { id: number } } & Record<string, unknown>>, key: string) =>
      rows.reduce<Record<string, number>>((acc, r) => {
        acc[String(r[key])] = r._count.id;
        return acc;
      }, {});

    const mCounts = toRecord(merchantsByStatus, 'status');
    const sCounts = toRecord(shopsByStatus, 'status');
    const dbCounts = toRecord(shopsByDbStatus, 'dbStatus');

    return {
      merchants: {
        total: Object.values(mCounts).reduce((a, b) => a + b, 0),
        ACTIVE: mCounts.ACTIVE ?? 0,
        PAST_DUE: mCounts.PAST_DUE ?? 0,
        SUSPENDED: mCounts.SUSPENDED ?? 0,
        TERMINATED: mCounts.TERMINATED ?? 0,
      },
      shops: {
        total: Object.values(sCounts).reduce((a, b) => a + b, 0),
        ACTIVE: sCounts.ACTIVE ?? 0,
        PAST_DUE: sCounts.PAST_DUE ?? 0,
        SUSPENDED: sCounts.SUSPENDED ?? 0,
        TERMINATED: sCounts.TERMINATED ?? 0,
        dbReady: dbCounts.READY ?? 0,
        dbFailed: dbCounts.MIGRATION_FAILED ?? 0,
      },
      security: {
        activeSessionsCount,
        activeSupportGrantsCount,
      },
      recentAudit: recentAudit.map((r) => ({
        id: r.id,
        action: r.action,
        entityType: r.entityType,
        actorName: r.actor?.fullName ?? null,
        reason: r.reason,
        createdAt: r.createdAt.toISOString(),
      })),
    };
  }

  async listMerchants(params: { search?: string; status?: string; page?: number; limit?: number }) {
    const page = Math.max(1, params.page || 1);
    const limit = Math.min(100, Math.max(1, params.limit || 20));
    const where: Record<string, unknown> = {};

    if (params.status) {
      where.status = params.status;
    }
    if (params.search?.trim()) {
      const q = params.search.trim();
      where.OR = [
        { name: { contains: q, mode: 'insensitive' } },
        { email: { contains: q, mode: 'insensitive' } },
        { phone: { contains: q, mode: 'insensitive' } },
      ];
    }

    const [total, merchants] = await Promise.all([
      this.controlPrisma.merchant.count({ where }),
      this.controlPrisma.merchant.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        skip: (page - 1) * limit,
        take: limit,
        include: {
          users: {
            where: { role: 'OWNER' },
            select: { id: true, fullName: true, email: true, isActive: true, lastLoginAt: true },
          },
          _count: { select: { shops: true, users: true } },
        },
      }),
    ]);

    return {
      items: merchants.map((m) => ({
        id: m.id,
        name: m.name,
        legalName: m.legalName,
        phone: m.phone,
        email: m.email,
        status: m.status,
        statusReason: m.statusReason,
        gracePeriodEndsAt: m.gracePeriodEndsAt?.toISOString() ?? null,
        currency: m.currency,
        defaultTimezone: m.defaultTimezone,
        shopsCount: m._count.shops,
        usersCount: m._count.users,
        owner: m.users[0]
          ? {
              id: m.users[0].id,
              fullName: m.users[0].fullName,
              email: m.users[0].email,
              lastLoginAt: m.users[0].lastLoginAt?.toISOString() ?? null,
            }
          : null,
        createdAt: m.createdAt.toISOString(),
      })),
      total,
      page,
      limit,
    };
  }

  async createMerchant(
    input: {
      merchantName: string;
      legalName?: string;
      phone: string;
      email: string;
      currency: string;
      defaultTimezone: string;
      ownerFullName: string;
      ownerEmail: string;
      ownerPhone?: string;
      ownerPassword: string;
      initialShopName?: string;
      initialShopSlug?: string;
      initialShopType?: ShopType;
      initialShopTypes?: ShopType[];
    },
    actor: AuthenticatedUser,
    meta: RequestMeta,
  ) {
    const ownerEmail = input.ownerEmail.trim().toLowerCase();
    const dupOwner = await this.controlPrisma.user.findUnique({ where: { email: ownerEmail } });
    if (dupOwner) {
      throw new ConflictException({
        code: 'EMAIL_ALREADY_USED',
        message: 'L’adresse e-mail du propriétaire est déjà utilisée.',
      });
    }

    const passwordHash = await argon2.hash(input.ownerPassword, { type: argon2.argon2id });

    const { merchant, owner } = await this.controlPrisma.$transaction(async (tx) => {
      const m = await tx.merchant.create({
        data: {
          name: input.merchantName,
          legalName: input.legalName || null,
          phone: input.phone,
          email: input.email.trim().toLowerCase(),
          currency: input.currency,
          defaultTimezone: input.defaultTimezone,
          status: 'ACTIVE',
        },
      });

      const u = await tx.user.create({
        data: {
          merchantId: m.id,
          role: 'OWNER',
          email: ownerEmail,
          phone: input.ownerPhone || input.phone,
          fullName: input.ownerFullName,
          passwordHash,
          isActive: true,
        },
      });

      return { merchant: m, owner: u };
    });

    await this.auditService.recordControl({
      merchantId: merchant.id,
      actorUserId: actor.userId,
      actorRole: 'SUPER_ADMIN',
      action: 'MERCHANT_CREATED',
      entityType: 'Merchant',
      entityId: merchant.id,
      afterData: {
        merchantName: merchant.name,
        ownerEmail: owner.email,
        currency: merchant.currency,
      },
      ipAddress: meta.ipAddress,
      userAgent: meta.userAgent,
      correlationId: meta.correlationId,
    });

    let initialShop: unknown = null;
    if (input.initialShopName?.trim()) {
      const primaryType =
        input.initialShopType ||
        (input.initialShopTypes && input.initialShopTypes[0]) ||
        'GENERAL';
      const enabledTypes =
        input.initialShopTypes && input.initialShopTypes.length > 0
          ? Array.from(new Set<ShopType>([primaryType, ...input.initialShopTypes]))
          : [primaryType];

      initialShop = await this.shopsService.createShopForMerchant(
        merchant.id,
        {
          name: input.initialShopName.trim(),
          slug: input.initialShopSlug,
          shopType: primaryType,
          businessProfile: { enabledShopTypes: enabledTypes },
          currency: merchant.currency,
          timezone: merchant.defaultTimezone,
        },
        { userId: actor.userId, role: 'SUPER_ADMIN' },
        meta,
      );
    }

    return {
      merchant: {
        id: merchant.id,
        name: merchant.name,
        status: merchant.status,
        currency: merchant.currency,
      },
      owner: {
        id: owner.id,
        email: owner.email,
        fullName: owner.fullName,
      },
      initialShop,
    };
  }

  async updateMerchantStatus(
    merchantId: string,
    input: { status: TenantStatus; reason: string; gracePeriodEndsAt?: string | null },
    actor: AuthenticatedUser,
    meta: RequestMeta,
  ) {
    const existing = await this.controlPrisma.merchant.findUnique({ where: { id: merchantId } });
    if (!existing) {
      throw new NotFoundException({ code: 'MERCHANT_NOT_FOUND', message: 'Marchand introuvable.' });
    }

    const updated = await this.controlPrisma.merchant.update({
      where: { id: merchantId },
      data: {
        status: input.status,
        statusReason: input.reason,
        gracePeriodEndsAt:
          input.status === 'PAST_DUE' && input.gracePeriodEndsAt
            ? new Date(input.gracePeriodEndsAt)
            : input.status === 'ACTIVE'
              ? null
              : existing.gracePeriodEndsAt,
      },
    });

    await this.auditService.recordControl({
      merchantId,
      actorUserId: actor.userId,
      actorRole: 'SUPER_ADMIN',
      action: 'MERCHANT_STATUS_CHANGED',
      entityType: 'Merchant',
      entityId: merchantId,
      beforeData: { status: existing.status },
      afterData: { status: updated.status },
      reason: input.reason,
      ipAddress: meta.ipAddress,
      userAgent: meta.userAgent,
      correlationId: meta.correlationId,
    });

    await this.notificationsService.notifyMerchantOwners(merchantId, {
      type: 'PLATFORM',
      priority: input.status === 'SUSPENDED' || input.status === 'TERMINATED' ? 'URGENT' : 'WARNING',
      title: `Statut du compte : ${TENANT_STATUS_LABELS[input.status]}`,
      message: `Le statut de votre entreprise est passé à « ${TENANT_STATUS_LABELS[input.status]} ». Motif : ${input.reason}`,
      targetPath: '/owner/settings',
    });

    return updated;
  }

  async listAllShops(params: { search?: string; status?: string; page?: number; limit?: number }) {
    const page = Math.max(1, params.page || 1);
    const limit = Math.min(100, Math.max(1, params.limit || 25));
    const where: Record<string, unknown> = {};
    if (params.status) where.status = params.status;
    if (params.search?.trim()) {
      const q = params.search.trim();
      where.OR = [
        { name: { contains: q, mode: 'insensitive' } },
        { slug: { contains: q, mode: 'insensitive' } },
        { dbName: { contains: q, mode: 'insensitive' } },
      ];
    }

    const [total, shops] = await Promise.all([
      this.controlPrisma.shop.count({ where }),
      this.controlPrisma.shop.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        skip: (page - 1) * limit,
        take: limit,
        include: {
          merchant: { select: { id: true, name: true, status: true } },
        },
      }),
    ]);

    return {
      items: shops.map((s) => {
        const shopType = normalizeShopType(s.shopType);
        return {
          id: s.id,
          name: s.name,
          slug: s.slug,
          shopType,
          businessProfile: normalizeBusinessProfile(shopType, s.businessProfile),
          status: s.status,
          statusReason: s.statusReason,
          dbName: s.dbName,
          dbStatus: s.dbStatus,
          dbSchemaVersion: s.dbSchemaVersion,
          merchant: s.merchant,
          createdAt: s.createdAt.toISOString(),
        };
      }),
      total,
      page,
      limit,
    };
  }

  async createShopByAdmin(
    input: {
      merchantId: string;
      name: string;
      slug?: string;
      shopType: ShopType;
      enabledShopTypes?: ShopType[];
    },
    actor: AuthenticatedUser,
    meta: RequestMeta,
  ) {
    const enabledTypes =
      input.enabledShopTypes && input.enabledShopTypes.length > 0
        ? Array.from(new Set<ShopType>([input.shopType, ...input.enabledShopTypes]))
        : [input.shopType];

    return this.shopsService.createShopForMerchant(
      input.merchantId,
      {
        name: input.name.trim(),
        slug: input.slug,
        shopType: input.shopType,
        businessProfile: { enabledShopTypes: enabledTypes },
      },
      { userId: actor.userId, role: 'SUPER_ADMIN' },
      meta,
    );
  }

  async updateShopTypesByAdmin(
    shopId: string,
    input: {
      shopType: ShopType;
      enabledShopTypes?: ShopType[];
      seedCategories?: boolean;
    },
    actor: AuthenticatedUser,
    meta: RequestMeta,
  ) {
    const existing = await this.controlPrisma.shop.findUnique({ where: { id: shopId } });
    if (!existing) {
      throw new NotFoundException({ code: 'SHOP_NOT_FOUND', message: 'Boutique introuvable.' });
    }

    const primaryType = normalizeShopType(input.shopType);
    const enabledTypes =
      input.enabledShopTypes && input.enabledShopTypes.length > 0
        ? Array.from(new Set<ShopType>([primaryType, ...input.enabledShopTypes]))
        : [primaryType];

    const nextProfile = normalizeBusinessProfile(primaryType, {
      enabledShopTypes: enabledTypes,
    });
    const allowDelivery = canShopDeliver(primaryType, enabledTypes);
    const currentDeliveryCfg = {
      ...DEFAULT_DELIVERY_CONFIG,
      ...((existing.deliveryConfig as object) || {}),
    } as Record<string, unknown>;

    const updated = await this.controlPrisma.shop.update({
      where: { id: shopId },
      data: {
        shopType: primaryType,
        businessProfile: nextProfile as object,
        ...(!allowDelivery
          ? {
              deliveryConfig: {
                ...currentDeliveryCfg,
                pickupEnabled: true,
                deliveryEnabled: false,
                defaultDeliveryFeeXof: 0,
                deliveryZones: [],
              } as object,
            }
          : {}),
      },
    });

    let seededCategoriesCount = 0;
    if (updated.dbStatus === 'READY') {
      await this.shopDbManager.syncShopLocalConfig({
        id: updated.id,
        merchantId: updated.merchantId,
        name: updated.name,
        slug: updated.slug,
        dbName: updated.dbName,
        shopType: primaryType,
        businessProfile: nextProfile,
        currency: updated.currency,
        timezone: updated.timezone,
        dailyReportTime: updated.dailyReportTime,
        taxMode: updated.taxMode,
        defaultTaxRateBps: updated.defaultTaxRateBps,
        requireOperatorPin: updated.requireOperatorPin,
        paymentMethods: updated.paymentMethods,
        openingHours: updated.openingHours,
      });

      if (input.seedCategories !== false) {
        seededCategoriesCount = await this.shopDbManager.seedCategoriesForShopTypes(
          updated.id,
          enabledTypes,
        );
      }
    }

    await this.auditService.recordControl({
      merchantId: existing.merchantId,
      shopId,
      actorUserId: actor.userId,
      actorRole: 'SUPER_ADMIN',
      action: 'SHOP_TYPES_UPDATED_BY_ADMIN',
      entityType: 'Shop',
      entityId: shopId,
      beforeData: { shopType: existing.shopType },
      afterData: {
        shopType: primaryType,
        enabledShopTypes: enabledTypes,
        seededCategoriesCount,
      },
      ipAddress: meta.ipAddress,
      userAgent: meta.userAgent,
      correlationId: meta.correlationId,
    });

    const labels = enabledTypes.map((t) => SHOP_TYPE_SHORT_LABELS[t]).join(', ');
    await this.notificationsService.notifyMerchantOwners(existing.merchantId, {
      shopId,
      type: 'PLATFORM',
      priority: 'INFO',
      title: `Type(s) de boutique mis à jour : ${existing.name}`,
      message: `Le Super Admin a activé le(s) rayon(s) « ${labels} » sur votre boutique ${existing.name}. Les catégories correspondantes sont disponibles dans Produits.`,
      targetPath: '/commerce/products',
    });

    return {
      ...updated,
      shopType: primaryType,
      businessProfile: nextProfile,
      seededCategoriesCount,
    };
  }

  async updateShopStatus(
    shopId: string,
    input: { status: TenantStatus; reason: string },
    actor: AuthenticatedUser,
    meta: RequestMeta,
  ) {
    const existing = await this.controlPrisma.shop.findUnique({ where: { id: shopId } });
    if (!existing) {
      throw new NotFoundException({ code: 'SHOP_NOT_FOUND', message: 'Boutique introuvable.' });
    }

    const updated = await this.controlPrisma.shop.update({
      where: { id: shopId },
      data: {
        status: input.status,
        statusReason: input.reason,
      },
    });

    await this.auditService.recordControl({
      merchantId: existing.merchantId,
      shopId,
      actorUserId: actor.userId,
      actorRole: 'SUPER_ADMIN',
      action: 'SHOP_STATUS_CHANGED',
      entityType: 'Shop',
      entityId: shopId,
      beforeData: { status: existing.status },
      afterData: { status: updated.status },
      reason: input.reason,
      ipAddress: meta.ipAddress,
      userAgent: meta.userAgent,
      correlationId: meta.correlationId,
    });

    await this.notificationsService.notifyMerchantOwners(existing.merchantId, {
      shopId,
      type: 'PLATFORM',
      priority: input.status === 'SUSPENDED' ? 'URGENT' : 'INFO',
      title: `Boutique ${existing.name} : ${TENANT_STATUS_LABELS[input.status]}`,
      message: `Le statut de la boutique ${existing.name} est passé à « ${TENANT_STATUS_LABELS[input.status]} ». Motif : ${input.reason}`,
      targetPath: '/owner/shops',
    });

    return updated;
  }

  async retryShopProvisioning(shopId: string, actor: AuthenticatedUser, meta: RequestMeta) {
    const shop = await this.controlPrisma.shop.findUnique({ where: { id: shopId } });
    if (!shop) {
      throw new NotFoundException({ code: 'SHOP_NOT_FOUND', message: 'Boutique introuvable.' });
    }

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

    const updated = await this.controlPrisma.shop.update({
      where: { id: shopId },
      data: { dbStatus: 'READY', dbSchemaVersion: provisioned.schemaVersion },
    });

    await this.auditService.recordControl({
      merchantId: shop.merchantId,
      shopId,
      actorUserId: actor.userId,
      actorRole: 'SUPER_ADMIN',
      action: 'SHOP_DB_PROVISIONED',
      entityType: 'Shop',
      entityId: shopId,
      afterData: { dbName: shop.dbName, schemaVersion: provisioned.schemaVersion },
      ipAddress: meta.ipAddress,
      userAgent: meta.userAgent,
      correlationId: meta.correlationId,
    });

    return updated;
  }

  /**
   * Accès d'assistance exceptionnel Super Admin (Section 4.1) :
   * Borné dans le temps (<= 2 h), lecture seule par défaut, motif obligatoire,
   * journalisé et notifié immédiatement au Propriétaire.
   */
  async createSupportAccessGrant(
    input: { merchantId: string; reason: string; durationMinutes: number; readOnly: boolean },
    actor: AuthenticatedUser,
    meta: RequestMeta,
  ) {
    const merchant = await this.controlPrisma.merchant.findUnique({
      where: { id: input.merchantId },
    });
    if (!merchant) {
      throw new NotFoundException({ code: 'MERCHANT_NOT_FOUND', message: 'Marchand introuvable.' });
    }

    const clampedMinutes = Math.min(120, Math.max(15, input.durationMinutes));
    const expiresAt = new Date(Date.now() + clampedMinutes * 60_000);

    const grant = await this.controlPrisma.supportAccessGrant.create({
      data: {
        superAdminId: actor.userId,
        merchantId: merchant.id,
        reason: input.reason,
        readOnly: input.readOnly ?? true,
        expiresAt,
      },
    });

    await this.auditService.recordControl({
      merchantId: merchant.id,
      actorUserId: actor.userId,
      actorRole: 'SUPER_ADMIN',
      action: 'SUPPORT_ACCESS_GRANTED',
      entityType: 'SupportAccessGrant',
      entityId: grant.id,
      afterData: {
        readOnly: grant.readOnly,
        durationMinutes: clampedMinutes,
        expiresAt: grant.expiresAt.toISOString(),
      },
      reason: input.reason,
      ipAddress: meta.ipAddress,
      userAgent: meta.userAgent,
      correlationId: meta.correlationId,
    });

    await this.notificationsService.notifyMerchantOwners(merchant.id, {
      type: 'SECURITY',
      priority: 'WARNING',
      title: 'Accès d’assistance plateforme ouvert',
      message: `Un administrateur ShopControl (${actor.fullName}) a ouvert un accès d’assistance ${grant.readOnly ? 'en lecture seule' : 'étendu'} jusqu’à ${expiresAt.toISOString()}. Motif : ${input.reason}`,
      targetPath: '/owner/settings',
    });

    return {
      id: grant.id,
      merchantId: grant.merchantId,
      merchantName: merchant.name,
      reason: grant.reason,
      readOnly: grant.readOnly,
      expiresAt: grant.expiresAt.toISOString(),
      createdAt: grant.createdAt.toISOString(),
    };
  }

  async listSupportGrants() {
    const grants = await this.controlPrisma.supportAccessGrant.findMany({
      orderBy: { createdAt: 'desc' },
      take: 50,
      include: {
        merchant: { select: { id: true, name: true } },
        superAdmin: { select: { id: true, fullName: true, email: true } },
      },
    });

    return grants.map((g) => ({
      id: g.id,
      merchant: g.merchant,
      superAdmin: g.superAdmin,
      reason: g.reason,
      readOnly: g.readOnly,
      expiresAt: g.expiresAt.toISOString(),
      revokedAt: g.revokedAt?.toISOString() ?? null,
      createdAt: g.createdAt.toISOString(),
      active: !g.revokedAt && g.expiresAt > new Date(),
    }));
  }

  async revokeSupportGrant(grantId: string, actor: AuthenticatedUser, meta: RequestMeta) {
    const grant = await this.controlPrisma.supportAccessGrant.findUnique({
      where: { id: grantId },
    });
    if (!grant) {
      throw new NotFoundException({ code: 'GRANT_NOT_FOUND', message: 'Mandat introuvable.' });
    }
    if (grant.revokedAt) {
      throw new BadRequestException({
        code: 'GRANT_ALREADY_REVOKED',
        message: 'Ce mandat est déjà clôturé.',
      });
    }

    await this.controlPrisma.supportAccessGrant.update({
      where: { id: grantId },
      data: { revokedAt: new Date(), revokedByUserId: actor.userId },
    });

    await this.auditService.recordControl({
      merchantId: grant.merchantId,
      actorUserId: actor.userId,
      actorRole: actor.role,
      action: 'SUPPORT_ACCESS_REVOKED',
      entityType: 'SupportAccessGrant',
      entityId: grantId,
      reason: 'Clôture du mandat d’assistance',
      ipAddress: meta.ipAddress,
      userAgent: meta.userAgent,
      correlationId: meta.correlationId,
    });

    return { ok: true };
  }
}

@ApiTags('Administration Plateforme (Super Admin)')
@ApiBearerAuth()
@Controller('admin')
@Roles('SUPER_ADMIN')
export class AdminController {
  constructor(
    private readonly adminService: AdminService,
    private readonly auditService: AuditService,
  ) {}

  @Get('dashboard')
  @ApiOperation({ summary: 'Indicateurs globaux de la plateforme' })
  dashboard() {
    return this.adminService.getDashboard();
  }

  @Get('merchants')
  @ApiOperation({ summary: 'Lister les entreprises marchandes' })
  listMerchants(
    @Query('search') search?: string,
    @Query('status') status?: string,
    @Query('page') page?: string,
    @Query('limit') limit?: string,
  ) {
    return this.adminService.listMerchants({
      search,
      status,
      page: page ? Number(page) : 1,
      limit: limit ? Number(limit) : 20,
    });
  }

  @Post('merchants')
  @ApiOperation({ summary: 'Créer un marchand, son Propriétaire et éventuellement sa 1re boutique (+ BDD dédiée)' })
  createMerchant(
    @Body(new ZodValidationPipe(createMerchantSchema)) body: any,
    @CurrentUser() user: AuthenticatedUser,
    @Req() req: RequestWithAuth,
  ) {
    return this.adminService.createMerchant(body, user, {
      ipAddress: req.ip || null,
      userAgent: req.header('user-agent') || null,
      correlationId: req.correlationId || null,
    });
  }

  @Patch('merchants/:merchantId/status')
  @ApiOperation({ summary: 'Modifier le statut d’un marchand (Actif / Impayé / Suspendu / Résilié)' })
  updateMerchantStatus(
    @Param('merchantId') merchantId: string,
    @Body(new ZodValidationPipe(updateTenantStatusSchema))
    body: { status: TenantStatus; reason: string; gracePeriodEndsAt?: string | null },
    @CurrentUser() user: AuthenticatedUser,
    @Req() req: RequestWithAuth,
  ) {
    return this.adminService.updateMerchantStatus(merchantId, body, user, {
      ipAddress: req.ip || null,
      userAgent: req.header('user-agent') || null,
      correlationId: req.correlationId || null,
    });
  }

  @Get('shops')
  @ApiOperation({ summary: 'Lister toutes les boutiques et l’état de leurs bases dédiées' })
  listShops(
    @Query('search') search?: string,
    @Query('status') status?: string,
    @Query('page') page?: string,
    @Query('limit') limit?: string,
  ) {
    return this.adminService.listAllShops({
      search,
      status,
      page: page ? Number(page) : 1,
      limit: limit ? Number(limit) : 25,
    });
  }

  @Post('shops')
  @ApiOperation({ summary: 'Créer une nouvelle boutique pour un marchand avec son type métier (Super Admin)' })
  createShopByAdmin(
    @Body(new ZodValidationPipe(adminCreateShopSchema)) body: any,
    @CurrentUser() user: AuthenticatedUser,
    @Req() req: RequestWithAuth,
  ) {
    return this.adminService.createShopByAdmin(body, user, {
      ipAddress: req.ip || null,
      userAgent: req.header('user-agent') || null,
      correlationId: req.correlationId || null,
    });
  }

  @Patch('shops/:shopId/types')
  @ApiOperation({ summary: 'Définir ou ajouter des types métiers (Cosmétique, Mode, Rue, Quincaillerie…) sur une boutique (Super Admin)' })
  updateShopTypes(
    @Param('shopId') shopId: string,
    @Body(new ZodValidationPipe(adminUpdateShopTypesSchema)) body: any,
    @CurrentUser() user: AuthenticatedUser,
    @Req() req: RequestWithAuth,
  ) {
    return this.adminService.updateShopTypesByAdmin(shopId, body, user, {
      ipAddress: req.ip || null,
      userAgent: req.header('user-agent') || null,
      correlationId: req.correlationId || null,
    });
  }

  @Patch('shops/:shopId/status')
  @ApiOperation({ summary: 'Suspendre ou réactiver une boutique individuellement (sans effacer ses données)' })
  updateShopStatus(
    @Param('shopId') shopId: string,
    @Body(new ZodValidationPipe(updateTenantStatusSchema))
    body: { status: TenantStatus; reason: string },
    @CurrentUser() user: AuthenticatedUser,
    @Req() req: RequestWithAuth,
  ) {
    return this.adminService.updateShopStatus(shopId, body, user, {
      ipAddress: req.ip || null,
      userAgent: req.header('user-agent') || null,
      correlationId: req.correlationId || null,
    });
  }

  @Post('shops/:shopId/retry-provision')
  @ApiOperation({ summary: 'Relancer le provisionnement/migration de la base dédiée d’une boutique' })
  retryProvision(
    @Param('shopId') shopId: string,
    @CurrentUser() user: AuthenticatedUser,
    @Req() req: RequestWithAuth,
  ) {
    return this.adminService.retryShopProvisioning(shopId, user, {
      ipAddress: req.ip || null,
      userAgent: req.header('user-agent') || null,
      correlationId: req.correlationId || null,
    });
  }

  @Get('support-access')
  @ApiOperation({ summary: 'Lister les mandats d’accès d’assistance exceptionnels' })
  listSupportGrants() {
    return this.adminService.listSupportGrants();
  }

  @Post('support-access')
  @ApiOperation({ summary: 'Ouvrir un mandat d’accès d’assistance borné (≤ 2 h, lecture seule, notifié au marchand)' })
  createSupportGrant(
    @Body(new ZodValidationPipe(createSupportAccessSchema))
    body: { merchantId: string; reason: string; durationMinutes: number; readOnly: boolean },
    @CurrentUser() user: AuthenticatedUser,
    @Req() req: RequestWithAuth,
  ) {
    return this.adminService.createSupportAccessGrant(body, user, {
      ipAddress: req.ip || null,
      userAgent: req.header('user-agent') || null,
      correlationId: req.correlationId || null,
    });
  }

  @Delete('support-access/:grantId')
  @ApiOperation({ summary: 'Clôturer un mandat d’accès d’assistance' })
  revokeSupportGrant(
    @Param('grantId') grantId: string,
    @CurrentUser() user: AuthenticatedUser,
    @Req() req: RequestWithAuth,
  ) {
    return this.adminService.revokeSupportGrant(grantId, user, {
      ipAddress: req.ip || null,
      userAgent: req.header('user-agent') || null,
      correlationId: req.correlationId || null,
    });
  }

  @Get('audit-logs')
  @ApiOperation({ summary: 'Consulter le journal d’audit plateforme et sécurité' })
  listPlatformAudit(
    @Query('merchantId') merchantId?: string,
    @Query('shopId') shopId?: string,
    @Query('action') action?: string,
    @Query('page') page?: string,
    @Query('limit') limit?: string,
  ) {
    return this.auditService.listPlatformAuditLogs({
      merchantId,
      shopId,
      action,
      page: page ? Number(page) : 1,
      limit: limit ? Number(limit) : 25,
    });
  }
}

@Module({
  imports: [ShopsModule],
  controllers: [AdminController],
  providers: [AdminService],
})
export class AdminModule {}
