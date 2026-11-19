import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import * as jwt from 'jsonwebtoken';
import {
  createAllPermissions,
  normalizePermissionMap,
  TenantStatus,
  UserRole,
} from '@shopcontrol/shared';
import { getEnv } from '../config/env.config';
import { ControlPrismaService } from '../database/control-prisma.service';
import { IS_PUBLIC_KEY } from '../auth/auth.decorators';
import {
  AuthenticatedUser,
  RequestWithAuth,
  ShopAccessSummary,
  SupportGrantContext,
} from '../auth/request-context.types';

export interface AccessTokenPayload {
  sub: string;
  sid: string;
  role: UserRole;
  typ: 'access';
}

@Injectable()
export class JwtAuthGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly controlPrisma: ControlPrismaService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const isPublic = this.reflector.getAllAndOverride<boolean>(IS_PUBLIC_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (isPublic) {
      return true;
    }

    const req = context.switchToHttp().getRequest<RequestWithAuth>();
    const token = this.extractToken(req);
    if (!token) {
      throw new UnauthorizedException({
        code: 'AUTH_REQUIRED',
        message: 'Authentification requise.',
      });
    }

    const env = getEnv();
    let payload: AccessTokenPayload;
    try {
      payload = jwt.verify(token, env.JWT_ACCESS_SECRET) as AccessTokenPayload;
      if (payload.typ !== 'access' || !payload.sub || !payload.sid) {
        throw new Error('Invalid token type');
      }
    } catch {
      throw new UnauthorizedException({
        code: 'TOKEN_INVALID',
        message: 'Session expirée ou jeton invalide. Veuillez vous reconnecter.',
      });
    }

    const session = await this.controlPrisma.userSession.findUnique({
      where: { id: payload.sid },
      include: {
        user: {
          include: {
            merchant: {
              include: {
                shops: {
                  orderBy: { createdAt: 'asc' },
                },
              },
            },
            shopAccesses: {
              where: { isActive: true },
              include: { shop: true },
            },
          },
        },
      },
    });

    if (!session || session.revokedAt || session.expiresAt <= new Date()) {
      throw new UnauthorizedException({
        code: 'SESSION_REVOKED',
        message: 'Votre session a été révoquée ou a expiré.',
      });
    }

    if (!session.user || !session.user.isActive || session.user.id !== payload.sub) {
      throw new UnauthorizedException({
        code: 'ACCOUNT_DISABLED',
        message: 'Ce compte utilisateur est désactivé.',
      });
    }

    // Expiration par inactivité plus courte pour un compte Agent partagé (Section 12.1)
    const maxIdleHours =
      session.user.role === 'AGENT'
        ? env.SESSION_TTL_AGENT_HOURS
        : session.user.role === 'SUPER_ADMIN'
          ? env.SESSION_TTL_SUPER_ADMIN_HOURS
          : env.SESSION_TTL_OWNER_HOURS;
    const idleLimitMs = maxIdleHours * 60 * 60 * 1000;
    if (Date.now() - session.lastActiveAt.getTime() > idleLimitMs) {
      await this.controlPrisma.userSession.update({
        where: { id: session.id },
        data: { revokedAt: new Date() },
      });
      throw new UnauthorizedException({
        code: 'SESSION_IDLE_EXPIRED',
        message: 'Session expirée pour inactivité. Veuillez vous reconnecter.',
      });
    }

    // Rafraîchit lastActiveAt au maximum une fois par minute
    if (Date.now() - session.lastActiveAt.getTime() > 60_000) {
      void this.controlPrisma.userSession
        .update({
          where: { id: session.id },
          data: { lastActiveAt: new Date() },
        })
        .catch(() => undefined);
    }

    const user = session.user;
    let merchantId = user.merchantId;
    let merchantStatus: TenantStatus | null = (user.merchant?.status as TenantStatus) ?? null;
    let shopAccesses: ShopAccessSummary[] = [];
    let supportGrant: SupportGrantContext | null = null;

    if (user.role === 'OWNER' && user.merchant) {
      const allPerms = createAllPermissions();
      shopAccesses = user.merchant.shops.map((s) => ({
        shopId: s.id,
        shopName: s.name,
        slug: s.slug,
        logoUrl: s.logoUrl ?? null,
        status: s.status as TenantStatus,
        dbStatus: s.dbStatus,
        permissions: allPerms,
        maxDiscountPercent: 100,
        maxExpenseAmountXof: 100_000_000,
      }));
    } else if (user.role === 'AGENT') {
      shopAccesses = user.shopAccesses.map((access) => ({
        shopId: access.shopId,
        shopName: access.shop.name,
        slug: access.shop.slug,
        logoUrl: access.shop.logoUrl ?? null,
        status: access.shop.status as TenantStatus,
        dbStatus: access.shop.dbStatus,
        permissions: normalizePermissionMap(access.permissions),
        maxDiscountPercent: access.maxDiscountPercent,
        maxExpenseAmountXof: access.maxExpenseAmountXof,
      }));
    } else if (user.role === 'SUPER_ADMIN') {
      const supportGrantId = req.header('x-support-grant-id')?.trim();
      if (supportGrantId) {
        const grant = await this.controlPrisma.supportAccessGrant.findUnique({
          where: { id: supportGrantId },
          include: {
            merchant: {
              include: { shops: { orderBy: { createdAt: 'asc' } } },
            },
          },
        });

        if (
          !grant ||
          grant.superAdminId !== user.id ||
          grant.revokedAt !== null ||
          grant.expiresAt <= new Date()
        ) {
          throw new ForbiddenException({
            code: 'SUPPORT_GRANT_INVALID',
            message: 'Le mandat d’accès d’assistance est invalide, révoqué ou expiré.',
          });
        }

        merchantId = grant.merchantId;
        merchantStatus = grant.merchant.status as TenantStatus;
        supportGrant = {
          grantId: grant.id,
          merchantId: grant.merchantId,
          readOnly: grant.readOnly,
          expiresAt: grant.expiresAt.toISOString(),
        };
        const allPerms = createAllPermissions();
        shopAccesses = grant.merchant.shops.map((s) => ({
          shopId: s.id,
          shopName: s.name,
          slug: s.slug,
          logoUrl: s.logoUrl ?? null,
          status: s.status as TenantStatus,
          dbStatus: s.dbStatus,
          permissions: allPerms,
          maxDiscountPercent: 0,
          maxExpenseAmountXof: 0,
        }));
      }
    }

    const authUser: AuthenticatedUser = {
      userId: user.id,
      sessionId: session.id,
      email: user.email,
      fullName: user.fullName,
      role: user.role as UserRole,
      merchantId,
      merchantStatus,
      totpEnabled: user.totpEnabled,
      shopAccesses,
      supportGrant,
    };

    req.user = authUser;
    return true;
  }

  private extractToken(req: RequestWithAuth): string | null {
    const authHeader = req.header('authorization');
    if (authHeader && authHeader.toLowerCase().startsWith('bearer ')) {
      return authHeader.slice(7).trim();
    }
    const cookieToken = req.cookies?.sc_access_token;
    if (typeof cookieToken === 'string' && cookieToken.length > 0) {
      return cookieToken;
    }
    return null;
  }
}
