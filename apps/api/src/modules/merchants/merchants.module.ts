import {
  Body,
  Controller,
  ForbiddenException,
  Get,
  Injectable,
  Module,
  NotFoundException,
  Patch,
  Req,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { updateMerchantSchema } from '@shopcontrol/shared';
import { CurrentUser, Roles } from '../../common/auth/auth.decorators';
import { AuthenticatedUser, RequestWithAuth } from '../../common/auth/request-context.types';
import { ControlPrismaService } from '../../common/database/control-prisma.service';
import { ShopDatabaseManagerService } from '../../common/database/shop-database-manager.service';
import { ZodValidationPipe } from '../../common/validation/zod-validation.pipe';
import { AuditService } from '../audit/audit.service';

@Injectable()
export class MerchantsService {
  constructor(
    private readonly controlPrisma: ControlPrismaService,
    private readonly shopDbManager: ShopDatabaseManagerService,
    private readonly auditService: AuditService,
  ) {}

  async getMerchantProfile(merchantId: string) {
    const merchant = await this.controlPrisma.merchant.findUnique({
      where: { id: merchantId },
      include: {
        supportAccessGrants: {
          orderBy: { createdAt: 'desc' },
          take: 10,
          include: { superAdmin: { select: { fullName: true, email: true } } },
        },
      },
    });
    if (!merchant) {
      throw new NotFoundException({ code: 'MERCHANT_NOT_FOUND', message: 'Entreprise introuvable.' });
    }
    return {
      id: merchant.id,
      name: merchant.name,
      legalName: merchant.legalName,
      phone: merchant.phone,
      email: merchant.email,
      status: merchant.status,
      statusReason: merchant.statusReason,
      gracePeriodEndsAt: merchant.gracePeriodEndsAt?.toISOString() ?? null,
      currency: merchant.currency,
      defaultTimezone: merchant.defaultTimezone,
      createdAt: merchant.createdAt.toISOString(),
      supportAccessHistory: merchant.supportAccessGrants.map((g) => ({
        id: g.id,
        superAdminName: g.superAdmin.fullName,
        reason: g.reason,
        readOnly: g.readOnly,
        expiresAt: g.expiresAt.toISOString(),
        revokedAt: g.revokedAt?.toISOString() ?? null,
        createdAt: g.createdAt.toISOString(),
        active: !g.revokedAt && g.expiresAt > new Date(),
      })),
    };
  }

  async updateMerchant(
    merchantId: string,
    input: {
      name?: string;
      legalName?: string | null;
      phone?: string;
      email?: string;
      defaultTimezone?: string;
    },
    user: AuthenticatedUser,
    meta: { ipAddress?: string | null; userAgent?: string | null; correlationId?: string | null },
  ) {
    const existing = await this.controlPrisma.merchant.findUnique({ where: { id: merchantId } });
    if (!existing) {
      throw new NotFoundException({ code: 'MERCHANT_NOT_FOUND', message: 'Entreprise introuvable.' });
    }

    const updated = await this.controlPrisma.merchant.update({
      where: { id: merchantId },
      data: {
        ...(input.name !== undefined ? { name: input.name } : {}),
        ...(input.legalName !== undefined ? { legalName: input.legalName } : {}),
        ...(input.phone !== undefined ? { phone: input.phone } : {}),
        ...(input.email !== undefined ? { email: input.email } : {}),
        ...(input.defaultTimezone !== undefined ? { defaultTimezone: input.defaultTimezone } : {}),
      },
    });

    await this.auditService.recordControl({
      merchantId,
      actorUserId: user.userId,
      actorRole: user.role,
      action: 'MERCHANT_UPDATED',
      entityType: 'Merchant',
      entityId: merchantId,
      beforeData: { name: existing.name, phone: existing.phone, email: existing.email },
      afterData: { name: updated.name, phone: updated.phone, email: updated.email },
      ipAddress: meta.ipAddress,
      userAgent: meta.userAgent,
      correlationId: meta.correlationId,
    });

    return updated;
  }

  /**
   * Vue consolidée multi-boutiques (Critère #2) :
   * Interroge en parallèle la base de données dédiée de chaque boutique du Propriétaire
   * et garantit que la somme consolidée est strictement égale à la somme des ventilations par boutique.
   */
  async getConsolidatedOverview(merchantId: string) {
    const shops = await this.controlPrisma.shop.findMany({
      where: { merchantId },
      orderBy: { createdAt: 'asc' },
      include: {
        _count: {
          select: { userAccesses: { where: { isActive: true } } },
        },
      },
    });

    const byShop = await Promise.all(
      shops.map(async (shop) => {
        let activeOperatorsCount = 0;
        let activeTerminalsCount = 0;
        let shopAuditCount = 0;

        if (shop.dbStatus === 'READY') {
          const client = await this.shopDbManager.getClientForShop(shop.id);
          const [ops, terms, audits] = await Promise.all([
            client.shopOperator.count({ where: { isActive: true } }),
            client.terminal.count({ where: { isActive: true } }),
            client.shopAuditLog.count(),
          ]);
          activeOperatorsCount = ops;
          activeTerminalsCount = terms;
          shopAuditCount = audits;
        }

        return {
          shopId: shop.id,
          shopName: shop.name,
          slug: shop.slug,
          status: shop.status,
          dbName: shop.dbName,
          dbStatus: shop.dbStatus,
          activeAgentsCount: shop._count.userAccesses,
          activeOperatorsCount,
          activeTerminalsCount,
          shopAuditCount,
        };
      }),
    );

    const totals = byShop.reduce(
      (acc, item) => ({
        totalShops: acc.totalShops + 1,
        activeShops: acc.activeShops + (item.status === 'ACTIVE' ? 1 : 0),
        suspendedShops: acc.suspendedShops + (item.status === 'SUSPENDED' ? 1 : 0),
        readyDatabases: acc.readyDatabases + (item.dbStatus === 'READY' ? 1 : 0),
        activeAgentsCount: acc.activeAgentsCount + item.activeAgentsCount,
        activeOperatorsCount: acc.activeOperatorsCount + item.activeOperatorsCount,
        activeTerminalsCount: acc.activeTerminalsCount + item.activeTerminalsCount,
        shopAuditCount: acc.shopAuditCount + item.shopAuditCount,
      }),
      {
        totalShops: 0,
        activeShops: 0,
        suspendedShops: 0,
        readyDatabases: 0,
        activeAgentsCount: 0,
        activeOperatorsCount: 0,
        activeTerminalsCount: 0,
        shopAuditCount: 0,
      },
    );

    return {
      merchantId,
      totals,
      byShop,
    };
  }
}

@ApiTags('Entreprise Marchande')
@ApiBearerAuth()
@Controller('merchant')
export class MerchantsController {
  constructor(private readonly merchantsService: MerchantsService) {}

  @Get()
  @Roles('OWNER')
  @ApiOperation({ summary: 'Consulter le profil de son entreprise et l’historique des accès support' })
  getProfile(@CurrentUser() user: AuthenticatedUser) {
    if (!user.merchantId) {
      throw new ForbiddenException({ code: 'MERCHANT_REQUIRED', message: 'Aucun marchand associé.' });
    }
    return this.merchantsService.getMerchantProfile(user.merchantId);
  }

  @Patch()
  @Roles('OWNER')
  @ApiOperation({ summary: 'Modifier les informations de son entreprise' })
  update(
    @CurrentUser() user: AuthenticatedUser,
    @Body(new ZodValidationPipe(updateMerchantSchema))
    body: {
      name?: string;
      legalName?: string | null;
      phone?: string;
      email?: string;
      defaultTimezone?: string;
    },
    @Req() req: RequestWithAuth,
  ) {
    if (!user.merchantId) {
      throw new ForbiddenException({ code: 'MERCHANT_REQUIRED', message: 'Aucun marchand associé.' });
    }
    return this.merchantsService.updateMerchant(user.merchantId, body, user, {
      ipAddress: req.ip || null,
      userAgent: req.header('user-agent') || null,
      correlationId: req.correlationId || null,
    });
  }

  @Get('overview')
  @Roles('OWNER')
  @ApiOperation({ summary: 'Vue consolidée multi-boutiques avec ventilation par boutique' })
  consolidatedOverview(@CurrentUser() user: AuthenticatedUser) {
    if (!user.merchantId) {
      throw new ForbiddenException({ code: 'MERCHANT_REQUIRED', message: 'Aucun marchand associé.' });
    }
    return this.merchantsService.getConsolidatedOverview(user.merchantId);
  }
}

@Module({
  controllers: [MerchantsController],
  providers: [MerchantsService],
  exports: [MerchantsService],
})
export class MerchantsModule {}
