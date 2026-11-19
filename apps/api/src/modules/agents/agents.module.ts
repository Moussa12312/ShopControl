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
  Req,
  UseGuards,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import * as argon2 from 'argon2';
import {
  createAgentSchema,
  normalizePermissionMap,
  PermissionMap,
  resetAgentPasswordSchema,
  updateAgentSchema,
} from '@shopcontrol/shared';
import { CurrentUser, Roles } from '../../common/auth/auth.decorators';
import { AuthenticatedUser, RequestWithAuth } from '../../common/auth/request-context.types';
import { ControlPrismaService } from '../../common/database/control-prisma.service';
import { ShopScopeGuard } from '../../common/guards/shop-scope.guard';
import { ZodValidationPipe } from '../../common/validation/zod-validation.pipe';
import { AuditService } from '../audit/audit.service';
import { NotificationsService } from '../notifications/notifications.module';
import { RequestMeta } from '../auth/auth.service';

@Injectable()
export class AgentsService {
  constructor(
    private readonly controlPrisma: ControlPrismaService,
    private readonly auditService: AuditService,
    private readonly notificationsService: NotificationsService,
  ) {}

  async listAgentsForShop(shopId: string) {
    const accesses = await this.controlPrisma.userShopAccess.findMany({
      where: { shopId, user: { role: 'AGENT' } },
      orderBy: { createdAt: 'desc' },
      include: {
        user: {
          include: {
            sessions: {
              where: { revokedAt: null, expiresAt: { gt: new Date() } },
              select: { id: true },
            },
          },
        },
      },
    });

    return accesses.map((a) => ({
      id: a.user.id,
      shopId: a.shopId,
      fullName: a.user.fullName,
      email: a.user.email,
      phone: a.user.phone,
      isActive: a.user.isActive && a.isActive,
      permissions: normalizePermissionMap(a.permissions),
      maxDiscountPercent: a.maxDiscountPercent,
      maxExpenseAmountXof: a.maxExpenseAmountXof,
      activeSessionsCount: a.user.sessions.length,
      lastLoginAt: a.user.lastLoginAt?.toISOString() ?? null,
      createdAt: a.user.createdAt.toISOString(),
    }));
  }

  async createAgent(
    shopId: string,
    input: {
      fullName: string;
      email: string;
      phone?: string;
      password: string;
      permissions?: Partial<PermissionMap>;
      maxDiscountPercent?: number;
      maxExpenseAmountXof?: number;
    },
    actor: AuthenticatedUser,
    meta: RequestMeta,
  ) {
    const shop = await this.controlPrisma.shop.findUnique({ where: { id: shopId } });
    if (!shop) {
      throw new NotFoundException({ code: 'SHOP_NOT_FOUND', message: 'Boutique introuvable.' });
    }

    const email = input.email.trim().toLowerCase();
    const existing = await this.controlPrisma.user.findUnique({ where: { email } });
    if (existing) {
      throw new ConflictException({
        code: 'EMAIL_ALREADY_USED',
        message: 'Cette adresse e-mail est déjà utilisée par un autre compte.',
      });
    }

    const passwordHash = await argon2.hash(input.password, { type: argon2.argon2id });
    const permissions = normalizePermissionMap(input.permissions);

    const created = await this.controlPrisma.$transaction(async (tx) => {
      const user = await tx.user.create({
        data: {
          merchantId: shop.merchantId,
          role: 'AGENT',
          email,
          phone: input.phone || null,
          fullName: input.fullName,
          passwordHash,
          isActive: true,
        },
      });

      const access = await tx.userShopAccess.create({
        data: {
          userId: user.id,
          shopId,
          permissions: permissions as object,
          maxDiscountPercent: input.maxDiscountPercent ?? 0,
          maxExpenseAmountXof: input.maxExpenseAmountXof ?? 0,
          isActive: true,
        },
      });

      return { user, access };
    });

    await this.auditService.recordControl({
      merchantId: shop.merchantId,
      shopId,
      actorUserId: actor.userId,
      actorRole: actor.role,
      action: 'AGENT_CREATED',
      entityType: 'User',
      entityId: created.user.id,
      afterData: {
        email: created.user.email,
        fullName: created.user.fullName,
        maxDiscountPercent: created.access.maxDiscountPercent,
        maxExpenseAmountXof: created.access.maxExpenseAmountXof,
        permissions,
      },
      ipAddress: meta.ipAddress,
      userAgent: meta.userAgent,
      correlationId: meta.correlationId,
    });

    return {
      id: created.user.id,
      shopId,
      fullName: created.user.fullName,
      email: created.user.email,
      phone: created.user.phone,
      isActive: true,
      permissions,
      maxDiscountPercent: created.access.maxDiscountPercent,
      maxExpenseAmountXof: created.access.maxExpenseAmountXof,
      activeSessionsCount: 0,
      lastLoginAt: null,
      createdAt: created.user.createdAt.toISOString(),
    };
  }

  async updateAgent(
    shopId: string,
    agentId: string,
    input: {
      fullName?: string;
      phone?: string | null;
      isActive?: boolean;
      permissions?: Partial<PermissionMap>;
      maxDiscountPercent?: number;
      maxExpenseAmountXof?: number;
    },
    actor: AuthenticatedUser,
    meta: RequestMeta,
  ) {
    const access = await this.controlPrisma.userShopAccess.findUnique({
      where: { userId_shopId: { userId: agentId, shopId } },
      include: { user: true, shop: true },
    });
    if (!access || access.user.role !== 'AGENT') {
      throw new NotFoundException({
        code: 'AGENT_NOT_FOUND',
        message: 'Compte Agent introuvable dans cette boutique.',
      });
    }

    const beforePermissions = normalizePermissionMap(access.permissions);
    const nextPermissions = input.permissions
      ? normalizePermissionMap({ ...beforePermissions, ...input.permissions })
      : beforePermissions;

    const updated = await this.controlPrisma.$transaction(async (tx) => {
      const u = await tx.user.update({
        where: { id: agentId },
        data: {
          ...(input.fullName !== undefined ? { fullName: input.fullName } : {}),
          ...(input.phone !== undefined ? { phone: input.phone } : {}),
          ...(input.isActive !== undefined ? { isActive: input.isActive } : {}),
        },
      });

      const a = await tx.userShopAccess.update({
        where: { id: access.id },
        data: {
          ...(input.isActive !== undefined ? { isActive: input.isActive } : {}),
          ...(input.permissions !== undefined ? { permissions: nextPermissions as object } : {}),
          ...(input.maxDiscountPercent !== undefined
            ? { maxDiscountPercent: input.maxDiscountPercent }
            : {}),
          ...(input.maxExpenseAmountXof !== undefined
            ? { maxExpenseAmountXof: input.maxExpenseAmountXof }
            : {}),
        },
      });

      // Désactivation d'un compte -> révocation immédiate de ses sessions sans effacer son historique (Section 12.1)
      if (input.isActive === false) {
        await tx.userSession.updateMany({
          where: { userId: agentId, revokedAt: null },
          data: { revokedAt: new Date(), revokedByUserId: actor.userId },
        });
      }

      return { user: u, access: a };
    });

    const action =
      input.isActive === false
        ? 'AGENT_DEACTIVATED'
        : input.isActive === true && !access.user.isActive
          ? 'AGENT_REACTIVATED'
          : input.permissions !== undefined
            ? 'AGENT_PERMISSIONS_UPDATED'
            : 'AGENT_UPDATED';

    await this.auditService.recordControl({
      merchantId: access.shop.merchantId,
      shopId,
      actorUserId: actor.userId,
      actorRole: actor.role,
      action,
      entityType: 'User',
      entityId: agentId,
      beforeData: {
        isActive: access.user.isActive,
        maxDiscountPercent: access.maxDiscountPercent,
        maxExpenseAmountXof: access.maxExpenseAmountXof,
        permissions: beforePermissions,
      },
      afterData: {
        isActive: updated.user.isActive,
        maxDiscountPercent: updated.access.maxDiscountPercent,
        maxExpenseAmountXof: updated.access.maxExpenseAmountXof,
        permissions: nextPermissions,
      },
      ipAddress: meta.ipAddress,
      userAgent: meta.userAgent,
      correlationId: meta.correlationId,
    });

    if (input.permissions !== undefined) {
      await this.notificationsService.create({
        merchantId: access.shop.merchantId,
        shopId,
        recipientUserId: agentId,
        type: 'SECURITY',
        priority: 'INFO',
        title: 'Permissions mises à jour',
        message: `Le propriétaire a mis à jour vos permissions sur la boutique ${access.shop.name}.`,
        targetPath: '/agent/profile',
      });
    }

    return {
      id: updated.user.id,
      shopId,
      fullName: updated.user.fullName,
      email: updated.user.email,
      phone: updated.user.phone,
      isActive: updated.user.isActive && updated.access.isActive,
      permissions: nextPermissions,
      maxDiscountPercent: updated.access.maxDiscountPercent,
      maxExpenseAmountXof: updated.access.maxExpenseAmountXof,
    };
  }

  /**
   * Réinitialisation du mot de passe Agent par le Propriétaire sans jamais afficher l'ancien (Section 12.1).
   * Révoque immédiatement toutes les sessions actives de l'Agent.
   */
  async resetAgentPassword(
    shopId: string,
    agentId: string,
    newPassword: string,
    actor: AuthenticatedUser,
    meta: RequestMeta,
  ) {
    const access = await this.controlPrisma.userShopAccess.findUnique({
      where: { userId_shopId: { userId: agentId, shopId } },
      include: { user: true, shop: true },
    });
    if (!access || access.user.role !== 'AGENT') {
      throw new NotFoundException({
        code: 'AGENT_NOT_FOUND',
        message: 'Compte Agent introuvable dans cette boutique.',
      });
    }

    const passwordHash = await argon2.hash(newPassword, { type: argon2.argon2id });

    await this.controlPrisma.$transaction([
      this.controlPrisma.user.update({
        where: { id: agentId },
        data: { passwordHash, failedLoginCount: 0, lockedUntil: null },
      }),
      this.controlPrisma.userSession.updateMany({
        where: { userId: agentId, revokedAt: null },
        data: { revokedAt: new Date(), revokedByUserId: actor.userId },
      }),
    ]);

    await this.auditService.recordControl({
      merchantId: access.shop.merchantId,
      shopId,
      actorUserId: actor.userId,
      actorRole: actor.role,
      action: 'AGENT_PASSWORD_RESET',
      entityType: 'User',
      entityId: agentId,
      reason: 'Réinitialisation mot de passe par le propriétaire et révocation des sessions',
      ipAddress: meta.ipAddress,
      userAgent: meta.userAgent,
      correlationId: meta.correlationId,
    });

    return { ok: true, message: 'Mot de passe réinitialisé et sessions actives révoquées.' };
  }

  async listAgentSessions(shopId: string, agentId: string) {
    const access = await this.controlPrisma.userShopAccess.findUnique({
      where: { userId_shopId: { userId: agentId, shopId } },
    });
    if (!access) {
      throw new NotFoundException({ code: 'AGENT_NOT_FOUND', message: 'Agent introuvable.' });
    }
    const sessions = await this.controlPrisma.userSession.findMany({
      where: { userId: agentId, revokedAt: null, expiresAt: { gt: new Date() } },
      orderBy: { lastActiveAt: 'desc' },
    });
    return sessions.map((s) => ({
      id: s.id,
      deviceName: s.deviceName || 'Terminal boutique',
      userAgent: s.userAgent,
      ipAddress: s.ipAddress,
      lastActiveAt: s.lastActiveAt.toISOString(),
      createdAt: s.createdAt.toISOString(),
      expiresAt: s.expiresAt.toISOString(),
    }));
  }

  async revokeAgentSession(
    shopId: string,
    agentId: string,
    sessionId: string,
    actor: AuthenticatedUser,
    meta: RequestMeta,
  ) {
    const access = await this.controlPrisma.userShopAccess.findUnique({
      where: { userId_shopId: { userId: agentId, shopId } },
      include: { shop: true },
    });
    if (!access) {
      throw new NotFoundException({ code: 'AGENT_NOT_FOUND', message: 'Agent introuvable.' });
    }
    const session = await this.controlPrisma.userSession.findFirst({
      where: { id: sessionId, userId: agentId },
    });
    if (!session) {
      throw new BadRequestException({ code: 'SESSION_NOT_FOUND', message: 'Session introuvable.' });
    }

    await this.controlPrisma.userSession.update({
      where: { id: sessionId },
      data: { revokedAt: new Date(), revokedByUserId: actor.userId },
    });

    await this.auditService.recordControl({
      merchantId: access.shop.merchantId,
      shopId,
      actorUserId: actor.userId,
      actorRole: actor.role,
      action: 'SESSION_REVOKED',
      entityType: 'UserSession',
      entityId: sessionId,
      reason: 'Déconnexion à distance d’un terminal Agent par le propriétaire',
      ipAddress: meta.ipAddress,
      userAgent: meta.userAgent,
      correlationId: meta.correlationId,
    });

    return { ok: true };
  }
}

@ApiTags('Agents')
@ApiBearerAuth()
@Controller('shops/:shopId/agents')
@UseGuards(ShopScopeGuard)
@Roles('OWNER')
export class AgentsController {
  constructor(private readonly agentsService: AgentsService) {}

  @Get()
  @ApiOperation({ summary: 'Lister les comptes Agent rattachés à une boutique' })
  list(@Param('shopId') shopId: string) {
    return this.agentsService.listAgentsForShop(shopId);
  }

  @Post()
  @ApiOperation({ summary: 'Créer un compte Agent strictement rattaché à cette boutique' })
  create(
    @Param('shopId') shopId: string,
    @Body(new ZodValidationPipe(createAgentSchema))
    body: {
      fullName: string;
      email: string;
      phone?: string;
      password: string;
      permissions?: Partial<PermissionMap>;
      maxDiscountPercent?: number;
      maxExpenseAmountXof?: number;
    },
    @CurrentUser() user: AuthenticatedUser,
    @Req() req: RequestWithAuth,
  ) {
    return this.agentsService.createAgent(shopId, body, user, {
      ipAddress: req.ip || null,
      userAgent: req.header('user-agent') || null,
      correlationId: req.correlationId || null,
    });
  }

  @Patch(':agentId')
  @ApiOperation({ summary: 'Modifier les permissions, plafonds ou statut d’un compte Agent' })
  update(
    @Param('shopId') shopId: string,
    @Param('agentId') agentId: string,
    @Body(new ZodValidationPipe(updateAgentSchema))
    body: {
      fullName?: string;
      phone?: string | null;
      isActive?: boolean;
      permissions?: Partial<PermissionMap>;
      maxDiscountPercent?: number;
      maxExpenseAmountXof?: number;
    },
    @CurrentUser() user: AuthenticatedUser,
    @Req() req: RequestWithAuth,
  ) {
    return this.agentsService.updateAgent(shopId, agentId, body, user, {
      ipAddress: req.ip || null,
      userAgent: req.header('user-agent') || null,
      correlationId: req.correlationId || null,
    });
  }

  @Post(':agentId/reset-password')
  @ApiOperation({ summary: 'Réinitialiser le mot de passe d’un Agent et révoquer ses sessions actives' })
  resetPassword(
    @Param('shopId') shopId: string,
    @Param('agentId') agentId: string,
    @Body(new ZodValidationPipe(resetAgentPasswordSchema)) body: { newPassword: string },
    @CurrentUser() user: AuthenticatedUser,
    @Req() req: RequestWithAuth,
  ) {
    return this.agentsService.resetAgentPassword(shopId, agentId, body.newPassword, user, {
      ipAddress: req.ip || null,
      userAgent: req.header('user-agent') || null,
      correlationId: req.correlationId || null,
    });
  }

  @Get(':agentId/sessions')
  @ApiOperation({ summary: 'Lister les appareils/sessions actifs d’un Agent' })
  sessions(@Param('shopId') shopId: string, @Param('agentId') agentId: string) {
    return this.agentsService.listAgentSessions(shopId, agentId);
  }

  @Delete(':agentId/sessions/:sessionId')
  @ApiOperation({ summary: 'Déconnecter à distance une session Agent' })
  revokeSession(
    @Param('shopId') shopId: string,
    @Param('agentId') agentId: string,
    @Param('sessionId') sessionId: string,
    @CurrentUser() user: AuthenticatedUser,
    @Req() req: RequestWithAuth,
  ) {
    return this.agentsService.revokeAgentSession(shopId, agentId, sessionId, user, {
      ipAddress: req.ip || null,
      userAgent: req.header('user-agent') || null,
      correlationId: req.correlationId || null,
    });
  }
}

@Module({
  controllers: [AgentsController],
  providers: [AgentsService],
  exports: [AgentsService],
})
export class AgentsModule {}
