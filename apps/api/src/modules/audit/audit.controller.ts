import { Controller, ForbiddenException, Get, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { CurrentUser, Roles } from '../../common/auth/auth.decorators';
import { AuthenticatedUser } from '../../common/auth/request-context.types';
import { ControlPrismaService } from '../../common/database/control-prisma.service';
import { AuditService } from './audit.service';

@ApiTags('Audit')
@ApiBearerAuth()
@Controller('audit-logs')
export class AuditController {
  constructor(
    private readonly auditService: AuditService,
    private readonly controlPrisma: ControlPrismaService,
  ) {}

  @Get()
  @Roles('OWNER')
  @ApiOperation({ summary: 'Consulter le journal d’audit de son entreprise (Control DB + bases boutiques)' })
  async listForOwner(
    @CurrentUser() user: AuthenticatedUser,
    @Query('shopId') shopId?: string,
    @Query('action') action?: string,
    @Query('declaredOperatorId') declaredOperatorId?: string,
    @Query('from') from?: string,
    @Query('to') to?: string,
    @Query('page') page?: string,
    @Query('limit') limit?: string,
  ) {
    if (!user.merchantId) {
      throw new ForbiddenException({ code: 'MERCHANT_REQUIRED', message: 'Aucun marchand associé.' });
    }
    if (shopId && !user.shopAccesses.some((s) => s.shopId === shopId)) {
      throw new ForbiddenException({
        code: 'SHOP_ACCESS_DENIED',
        message: 'Cette boutique n’appartient pas à votre entreprise.',
      });
    }
    return this.auditService.listMerchantAuditLogs(user.merchantId, {
      shopId,
      action,
      declaredOperatorId,
      from,
      to,
      page: page ? Number(page) : 1,
      limit: limit ? Number(limit) : 25,
    });
  }

  @Get('verify-integrity')
  @Roles('OWNER', 'SUPER_ADMIN')
  @ApiOperation({ summary: 'Vérifier l’intégrité cryptographique (chaîne SHA-256) des journaux d’audit' })
  async verifyIntegrity(
    @CurrentUser() user: AuthenticatedUser,
    @Query('shopId') shopId?: string,
  ) {
    const controlIntegrity = await this.auditService.verifyControlChain();

    if (user.role === 'SUPER_ADMIN' && !user.supportGrant) {
      return { control: controlIntegrity, shops: [] };
    }

    if (!user.merchantId) {
      return { control: controlIntegrity, shops: [] };
    }

    const shops = await this.controlPrisma.shop.findMany({
      where: {
        merchantId: user.merchantId,
        dbStatus: 'READY',
        ...(shopId ? { id: shopId } : {}),
      },
      select: { id: true, name: true },
    });

    const shopChecks = await Promise.all(
      shops.map(async (s) => ({
        shopName: s.name,
        ...(await this.auditService.verifyShopChain(s.id)),
      })),
    );

    return {
      control: controlIntegrity,
      shops: shopChecks,
      allValid: controlIntegrity.valid && shopChecks.every((c) => c.valid),
    };
  }
}
