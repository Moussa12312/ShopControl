import * as crypto from 'crypto';
import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import * as argon2 from 'argon2';
import * as jwt from 'jsonwebtoken';
import * as QRCode from 'qrcode';
import {
  createAllPermissions,
  normalizeBusinessProfile,
  normalizePermissionMap,
  normalizeShopType,
  TenantStatus,
  UserRole,
} from '@shopcontrol/shared';
import { getEnv } from '../../common/config/env.config';
import { ControlPrismaService } from '../../common/database/control-prisma.service';
import { RedisService } from '../../common/redis/redis.module';
import {
  buildTotpOtpAuthUri,
  decryptAes256Gcm,
  encryptAes256Gcm,
  generateTotpSecret,
  sha256Hex,
  verifyTotpCode,
} from '../../common/crypto/security.util';
import { AuditService } from '../audit/audit.service';
import { AuthenticatedUser } from '../../common/auth/request-context.types';

const MAX_FAILED_LOGINS = 5;
const LOCKOUT_MINUTES = 15;

export interface RequestMeta {
  ipAddress?: string | null;
  userAgent?: string | null;
  correlationId?: string | null;
}

@Injectable()
export class AuthService {
  constructor(
    private readonly controlPrisma: ControlPrismaService,
    private readonly redis: RedisService,
    private readonly auditService: AuditService,
  ) {}

  async login(
    input: { email: string; password: string; deviceName?: string },
    meta: RequestMeta,
  ) {
    const email = input.email.trim().toLowerCase();
    const lockKey = `auth:lock:${email}`;

    const lockedUntilRedis = await this.redis.get(lockKey);
    if (lockedUntilRedis) {
      throw new ForbiddenException({
        code: 'ACCOUNT_LOCKED',
        message: `Compte temporairement verrouillé après plusieurs tentatives échouées. Réessayez dans quelques minutes.`,
      });
    }

    const user = await this.controlPrisma.user.findUnique({
      where: { email },
      include: {
        merchant: true,
      },
    });

    if (!user || !user.isActive) {
      await this.auditService.recordControl({
        action: 'AUTH_LOGIN_FAILED',
        entityType: 'User',
        entityId: user?.id ?? null,
        afterData: { email, reason: user ? 'account_disabled' : 'unknown_email' },
        ipAddress: meta.ipAddress,
        userAgent: meta.userAgent,
        correlationId: meta.correlationId,
      });
      throw new UnauthorizedException({
        code: 'INVALID_CREDENTIALS',
        message: 'Identifiants invalides ou compte désactivé.',
      });
    }

    if (user.lockedUntil && user.lockedUntil > new Date()) {
      throw new ForbiddenException({
        code: 'ACCOUNT_LOCKED',
        message: 'Compte temporairement verrouillé après plusieurs tentatives échouées.',
      });
    }

    const passwordValid = await argon2.verify(user.passwordHash, input.password).catch(() => false);
    if (!passwordValid) {
      const nextCount = user.failedLoginCount + 1;
      const shouldLock = nextCount >= MAX_FAILED_LOGINS;
      const lockedUntil = shouldLock ? new Date(Date.now() + LOCKOUT_MINUTES * 60_000) : null;

      await this.controlPrisma.user.update({
        where: { id: user.id },
        data: {
          failedLoginCount: shouldLock ? 0 : nextCount,
          lockedUntil,
        },
      });

      if (shouldLock) {
        await this.redis.set(lockKey, lockedUntil!.toISOString(), LOCKOUT_MINUTES * 60);
      }

      await this.auditService.recordControl({
        merchantId: user.merchantId,
        actorUserId: user.id,
        actorRole: user.role as UserRole,
        action: shouldLock ? 'AUTH_LOCKOUT' : 'AUTH_LOGIN_FAILED',
        entityType: 'User',
        entityId: user.id,
        afterData: { failedCount: nextCount, locked: shouldLock },
        ipAddress: meta.ipAddress,
        userAgent: meta.userAgent,
        correlationId: meta.correlationId,
      });

      if (shouldLock) {
        throw new ForbiddenException({
          code: 'ACCOUNT_LOCKED',
          message: `Trop de tentatives échouées. Compte verrouillé pendant ${LOCKOUT_MINUTES} minutes.`,
        });
      }

      throw new UnauthorizedException({
        code: 'INVALID_CREDENTIALS',
        message: 'Identifiants invalides.',
      });
    }

    // Réinitialise le compteur d'échecs dès que le mot de passe est correct
    if (user.failedLoginCount > 0 || user.lockedUntil) {
      await this.controlPrisma.user.update({
        where: { id: user.id },
        data: { failedLoginCount: 0, lockedUntil: null },
      });
    }

    if (user.totpEnabled && user.totpSecretEncrypted) {
      const env = getEnv();
      const challengeToken = jwt.sign(
        { sub: user.id, typ: '2fa_challenge', deviceName: input.deviceName ?? null },
        env.JWT_ACCESS_SECRET,
        { expiresIn: '5m' },
      );
      return {
        requiresTwoFactor: true as const,
        challengeToken,
      };
    }

    return this.issueSessionForUser(user.id, input.deviceName, meta);
  }

  async verifyTwoFactorLogin(
    input: { challengeToken: string; code: string; deviceName?: string },
    meta: RequestMeta,
  ) {
    const env = getEnv();
    let payload: { sub: string; typ: string; deviceName?: string | null };
    try {
      payload = jwt.verify(input.challengeToken, env.JWT_ACCESS_SECRET) as {
        sub: string;
        typ: string;
        deviceName?: string | null;
      };
      if (payload.typ !== '2fa_challenge') {
        throw new Error('Bad token');
      }
    } catch {
      throw new UnauthorizedException({
        code: 'CHALLENGE_EXPIRED',
        message: 'La demande de vérification 2FA a expiré. Veuillez vous reconnecter.',
      });
    }

    const user = await this.controlPrisma.user.findUnique({ where: { id: payload.sub } });
    if (!user || !user.isActive || !user.totpEnabled || !user.totpSecretEncrypted) {
      throw new UnauthorizedException({
        code: 'INVALID_2FA',
        message: 'Impossible de valider le second facteur.',
      });
    }

    const secret = decryptAes256Gcm(user.totpSecretEncrypted, env.TOTP_ENCRYPTION_KEY);
    if (!verifyTotpCode(secret, input.code)) {
      await this.auditService.recordControl({
        merchantId: user.merchantId,
        actorUserId: user.id,
        actorRole: user.role as UserRole,
        action: 'AUTH_LOGIN_FAILED',
        entityType: 'User',
        entityId: user.id,
        afterData: { reason: 'invalid_totp' },
        ipAddress: meta.ipAddress,
        userAgent: meta.userAgent,
        correlationId: meta.correlationId,
      });
      throw new UnauthorizedException({
        code: 'INVALID_2FA_CODE',
        message: 'Code de vérification 2FA invalide.',
      });
    }

    return this.issueSessionForUser(user.id, input.deviceName ?? payload.deviceName ?? undefined, meta);
  }

  async setupTwoFactor(user: AuthenticatedUser) {
    if (user.role === 'AGENT' || user.role === 'CLIENT') {
      throw new ForbiddenException({
        code: 'ROLE_FORBIDDEN',
        message: 'L’authentification à deux facteurs est réservée aux Propriétaires et Super Admins.',
      });
    }

    const secret = generateTotpSecret();
    const env = getEnv();
    const encrypted = encryptAes256Gcm(secret, env.TOTP_ENCRYPTION_KEY);
    await this.redis.set(`auth:2fa:pending:${user.userId}`, encrypted, 600);

    const otpauthUri = buildTotpOtpAuthUri(user.email, secret, 'ShopControl');
    const qrCodeDataUrl = await QRCode.toDataURL(otpauthUri);

    return { secret, otpauthUri, qrCodeDataUrl };
  }

  async confirmTwoFactor(user: AuthenticatedUser, code: string, meta: RequestMeta) {
    const env = getEnv();
    const pendingEncrypted = await this.redis.get(`auth:2fa:pending:${user.userId}`);
    if (!pendingEncrypted) {
      throw new BadRequestException({
        code: '2FA_SETUP_EXPIRED',
        message: 'Aucune configuration 2FA en cours ou délai expiré. Recommencez l’initialisation.',
      });
    }

    const secret = decryptAes256Gcm(pendingEncrypted, env.TOTP_ENCRYPTION_KEY);
    if (!verifyTotpCode(secret, code)) {
      throw new BadRequestException({
        code: 'INVALID_2FA_CODE',
        message: 'Code 2FA incorrect. Vérifiez l’heure de votre appareil et réessayez.',
      });
    }

    await this.controlPrisma.user.update({
      where: { id: user.userId },
      data: {
        totpSecretEncrypted: pendingEncrypted,
        totpEnabled: true,
      },
    });
    await this.redis.del(`auth:2fa:pending:${user.userId}`);

    await this.auditService.recordControl({
      merchantId: user.merchantId,
      actorUserId: user.userId,
      actorRole: user.role,
      action: 'AUTH_2FA_ENABLED',
      entityType: 'User',
      entityId: user.userId,
      ipAddress: meta.ipAddress,
      userAgent: meta.userAgent,
      correlationId: meta.correlationId,
    });

    return { totpEnabled: true };
  }

  async disableTwoFactor(user: AuthenticatedUser, code: string, meta: RequestMeta) {
    if (user.role === 'SUPER_ADMIN') {
      throw new ForbiddenException({
        code: '2FA_MANDATORY_FOR_ADMIN',
        message: 'La double authentification est obligatoire pour les comptes Super Admin.',
      });
    }

    const env = getEnv();
    const dbUser = await this.controlPrisma.user.findUnique({ where: { id: user.userId } });
    if (!dbUser?.totpEnabled || !dbUser.totpSecretEncrypted) {
      throw new BadRequestException({
        code: '2FA_NOT_ENABLED',
        message: 'La double authentification n’est pas activée sur ce compte.',
      });
    }

    const secret = decryptAes256Gcm(dbUser.totpSecretEncrypted, env.TOTP_ENCRYPTION_KEY);
    if (!verifyTotpCode(secret, code)) {
      throw new BadRequestException({
        code: 'INVALID_2FA_CODE',
        message: 'Code 2FA invalide.',
      });
    }

    await this.controlPrisma.user.update({
      where: { id: user.userId },
      data: { totpEnabled: false, totpSecretEncrypted: null },
    });

    await this.auditService.recordControl({
      merchantId: user.merchantId,
      actorUserId: user.userId,
      actorRole: user.role,
      action: 'AUTH_2FA_DISABLED',
      entityType: 'User',
      entityId: user.userId,
      ipAddress: meta.ipAddress,
      userAgent: meta.userAgent,
      correlationId: meta.correlationId,
    });

    return { totpEnabled: false };
  }

  async refresh(refreshToken: string, meta: RequestMeta) {
    const env = getEnv();
    let payload: { sub: string; sid: string; typ: string };
    try {
      payload = jwt.verify(refreshToken, env.JWT_REFRESH_SECRET) as {
        sub: string;
        sid: string;
        typ: string;
      };
      if (payload.typ !== 'refresh') {
        throw new Error('Bad refresh token');
      }
    } catch {
      throw new UnauthorizedException({
        code: 'REFRESH_INVALID',
        message: 'Jeton de rafraîchissement invalide ou expiré.',
      });
    }

    const incomingHash = sha256Hex(refreshToken);
    const session = await this.controlPrisma.userSession.findUnique({
      where: { id: payload.sid },
      include: { user: true },
    });

    if (
      !session ||
      session.revokedAt ||
      session.expiresAt <= new Date() ||
      !session.user?.isActive
    ) {
      throw new UnauthorizedException({
        code: 'SESSION_REVOKED',
        message: 'Session révoquée ou expirée.',
      });
    }

    // Détection de réutilisation d'un ancien refresh token -> révocation immédiate de la session
    if (session.refreshTokenHash !== incomingHash) {
      await this.controlPrisma.userSession.update({
        where: { id: session.id },
        data: { revokedAt: new Date() },
      });
      await this.auditService.recordControl({
        merchantId: session.user.merchantId,
        actorUserId: session.user.id,
        actorRole: session.user.role as UserRole,
        action: 'SESSION_REVOKED',
        entityType: 'UserSession',
        entityId: session.id,
        reason: 'Réutilisation suspecte d’un jeton de rafraîchissement',
        ipAddress: meta.ipAddress,
        userAgent: meta.userAgent,
        correlationId: meta.correlationId,
      });
      throw new UnauthorizedException({
        code: 'TOKEN_REUSE_DETECTED',
        message: 'Activité de session suspecte détectée. Veuillez vous reconnecter.',
      });
    }

    const ttlHours = this.getSessionHoursForRole(session.user.role as UserRole);
    const newExpiresAt = new Date(Date.now() + ttlHours * 3600_000);
    const newRefreshToken = jwt.sign(
      { sub: session.user.id, sid: session.id, typ: 'refresh', jti: crypto.randomUUID() },
      env.JWT_REFRESH_SECRET,
      { expiresIn: `${ttlHours}h` },
    );
    const newAccessToken = jwt.sign(
      { sub: session.user.id, sid: session.id, role: session.user.role, typ: 'access' },
      env.JWT_ACCESS_SECRET,
      { expiresIn: env.JWT_ACCESS_TTL_SECONDS },
    );

    await this.controlPrisma.userSession.update({
      where: { id: session.id },
      data: {
        refreshTokenHash: sha256Hex(newRefreshToken),
        expiresAt: newExpiresAt,
        lastActiveAt: new Date(),
      },
    });

    return {
      accessToken: newAccessToken,
      refreshToken: newRefreshToken,
      refreshTtlMs: ttlHours * 3600_000,
    };
  }

  async logout(user: AuthenticatedUser, meta: RequestMeta): Promise<void> {
    await this.controlPrisma.userSession.updateMany({
      where: { id: user.sessionId, userId: user.userId, revokedAt: null },
      data: { revokedAt: new Date(), revokedByUserId: user.userId },
    });

    await this.auditService.recordControl({
      merchantId: user.merchantId,
      actorUserId: user.userId,
      actorRole: user.role,
      action: 'AUTH_LOGOUT',
      entityType: 'UserSession',
      entityId: user.sessionId,
      ipAddress: meta.ipAddress,
      userAgent: meta.userAgent,
      correlationId: meta.correlationId,
    });
  }

  async getMe(user: AuthenticatedUser) {
    const dbUser = await this.controlPrisma.user.findUnique({
      where: { id: user.userId },
      include: {
        merchant: true,
      },
    });

    let merchantSummary: {
      id: string;
      name: string;
      status: TenantStatus;
      statusReason: string | null;
      gracePeriodEndsAt: string | null;
      currency: string;
      defaultTimezone: string;
    } | null = null;

    if (user.merchantId) {
      const m =
        dbUser?.merchant ??
        (await this.controlPrisma.merchant.findUnique({ where: { id: user.merchantId } }));
      if (m) {
        merchantSummary = {
          id: m.id,
          name: m.name,
          status: m.status as TenantStatus,
          statusReason: m.statusReason,
          gracePeriodEndsAt: m.gracePeriodEndsAt?.toISOString() ?? null,
          currency: m.currency,
          defaultTimezone: m.defaultTimezone,
        };
      }
    }

    return {
      user: {
        id: user.userId,
        email: user.email,
        fullName: user.fullName,
        role: user.role,
        totpEnabled: user.totpEnabled,
        mustSetupTwoFactor: user.role === 'SUPER_ADMIN' && !user.totpEnabled,
      },
      merchant: merchantSummary,
      shops: user.shopAccesses,
      supportGrant: user.supportGrant ?? null,
    };
  }

  async listSessions(userId: string, currentSessionId: string) {
    const sessions = await this.controlPrisma.userSession.findMany({
      where: { userId, revokedAt: null, expiresAt: { gt: new Date() } },
      orderBy: { lastActiveAt: 'desc' },
    });

    return sessions.map((s) => ({
      id: s.id,
      deviceName: s.deviceName || 'Navigateur web',
      userAgent: s.userAgent,
      ipAddress: s.ipAddress,
      lastActiveAt: s.lastActiveAt.toISOString(),
      createdAt: s.createdAt.toISOString(),
      expiresAt: s.expiresAt.toISOString(),
      isCurrent: s.id === currentSessionId,
    }));
  }

  async revokeOwnSession(user: AuthenticatedUser, sessionId: string, meta: RequestMeta) {
    const target = await this.controlPrisma.userSession.findFirst({
      where: { id: sessionId, userId: user.userId },
    });
    if (!target) {
      throw new BadRequestException({
        code: 'SESSION_NOT_FOUND',
        message: 'Session introuvable.',
      });
    }

    await this.controlPrisma.userSession.update({
      where: { id: target.id },
      data: { revokedAt: new Date(), revokedByUserId: user.userId },
    });

    await this.auditService.recordControl({
      merchantId: user.merchantId,
      actorUserId: user.userId,
      actorRole: user.role,
      action: 'SESSION_REVOKED',
      entityType: 'UserSession',
      entityId: target.id,
      reason: 'Déconnexion à distance par l’utilisateur',
      ipAddress: meta.ipAddress,
      userAgent: meta.userAgent,
      correlationId: meta.correlationId,
    });

    return { ok: true };
  }

  async changePassword(
    user: AuthenticatedUser,
    input: { currentPassword: string; newPassword: string },
    meta: RequestMeta,
  ) {
    const dbUser = await this.controlPrisma.user.findUnique({ where: { id: user.userId } });
    if (!dbUser || !dbUser.isActive) {
      throw new UnauthorizedException({
        code: 'ACCOUNT_DISABLED',
        message: 'Compte introuvable ou désactivé.',
      });
    }

    const ok = await argon2.verify(dbUser.passwordHash, input.currentPassword);
    if (!ok) {
      throw new BadRequestException({
        code: 'INVALID_CURRENT_PASSWORD',
        message: 'Le mot de passe actuel est incorrect.',
      });
    }

    const nextHash = await argon2.hash(input.newPassword, { type: argon2.argon2id });
    await this.controlPrisma.user.update({
      where: { id: user.userId },
      data: { passwordHash: nextHash },
    });

    await this.auditService.recordControl({
      merchantId: user.merchantId,
      actorUserId: user.userId,
      actorRole: user.role,
      action: 'AUTH_PASSWORD_CHANGED',
      entityType: 'User',
      entityId: user.userId,
      ipAddress: meta.ipAddress,
      userAgent: meta.userAgent,
      correlationId: meta.correlationId,
    });

    return { ok: true };
  }

  private getSessionHoursForRole(role: UserRole): number {
    const env = getEnv();
    if (role === 'AGENT') return env.SESSION_TTL_AGENT_HOURS;
    if (role === 'SUPER_ADMIN') return env.SESSION_TTL_SUPER_ADMIN_HOURS;
    return env.SESSION_TTL_OWNER_HOURS;
  }

  private async issueSessionForUser(userId: string, deviceName: string | undefined, meta: RequestMeta) {
    const env = getEnv();
    const user = await this.controlPrisma.user.findUniqueOrThrow({
      where: { id: userId },
      include: {
        merchant: { include: { shops: { orderBy: { createdAt: 'asc' } } } },
        shopAccesses: { where: { isActive: true }, include: { shop: true } },
      },
    });

    const role = user.role as UserRole;
    const ttlHours = this.getSessionHoursForRole(role);
    const sessionId = crypto.randomUUID();
    const expiresAt = new Date(Date.now() + ttlHours * 3600_000);

    const refreshToken = jwt.sign(
      { sub: user.id, sid: sessionId, typ: 'refresh', jti: crypto.randomUUID() },
      env.JWT_REFRESH_SECRET,
      { expiresIn: `${ttlHours}h` },
    );
    const accessToken = jwt.sign(
      { sub: user.id, sid: sessionId, role, typ: 'access' },
      env.JWT_ACCESS_SECRET,
      { expiresIn: env.JWT_ACCESS_TTL_SECONDS },
    );

    await this.controlPrisma.$transaction([
      this.controlPrisma.userSession.create({
        data: {
          id: sessionId,
          userId: user.id,
          refreshTokenHash: sha256Hex(refreshToken),
          deviceName: deviceName || null,
          userAgent: meta.userAgent?.slice(0, 500) || null,
          ipAddress: meta.ipAddress || null,
          expiresAt,
        },
      }),
      this.controlPrisma.user.update({
        where: { id: user.id },
        data: { lastLoginAt: new Date() },
      }),
    ]);

    await this.auditService.recordControl({
      merchantId: user.merchantId,
      shopId: role === 'AGENT' ? (user.shopAccesses[0]?.shopId ?? null) : null,
      actorUserId: user.id,
      actorRole: role,
      action: 'AUTH_LOGIN',
      entityType: 'UserSession',
      entityId: sessionId,
      afterData: { deviceName: deviceName || null },
      ipAddress: meta.ipAddress,
      userAgent: meta.userAgent,
      correlationId: meta.correlationId,
    });

    const shops =
      role === 'OWNER' && user.merchant
        ? user.merchant.shops.map((s) => ({
            shopId: s.id,
            shopName: s.name,
            slug: s.slug,
            logoUrl: s.logoUrl ?? null,
            shopType: normalizeShopType(s.shopType),
            businessProfile: normalizeBusinessProfile(s.shopType, s.businessProfile),
            status: s.status as TenantStatus,
            dbStatus: s.dbStatus,
            permissions: createAllPermissions(),
            maxDiscountPercent: 100,
            maxExpenseAmountXof: 100_000_000,
          }))
        : role === 'AGENT'
          ? user.shopAccesses.map((a) => ({
              shopId: a.shopId,
              shopName: a.shop.name,
              slug: a.shop.slug,
              logoUrl: a.shop.logoUrl ?? null,
              shopType: normalizeShopType(a.shop.shopType),
              businessProfile: normalizeBusinessProfile(a.shop.shopType, a.shop.businessProfile),
              status: a.shop.status as TenantStatus,
              dbStatus: a.shop.dbStatus,
              permissions: normalizePermissionMap(a.permissions),
              maxDiscountPercent: a.maxDiscountPercent,
              maxExpenseAmountXof: a.maxExpenseAmountXof,
            }))
          : [];

    return {
      requiresTwoFactor: false as const,
      accessToken,
      refreshToken,
      refreshTtlMs: ttlHours * 3600_000,
      user: {
        id: user.id,
        email: user.email,
        fullName: user.fullName,
        role,
        totpEnabled: user.totpEnabled,
        mustSetupTwoFactor: role === 'SUPER_ADMIN' && !user.totpEnabled,
      },
      merchant: user.merchant
        ? {
            id: user.merchant.id,
            name: user.merchant.name,
            status: user.merchant.status as TenantStatus,
            statusReason: user.merchant.statusReason,
            gracePeriodEndsAt: user.merchant.gracePeriodEndsAt?.toISOString() ?? null,
            currency: user.merchant.currency,
            defaultTimezone: user.merchant.defaultTimezone,
          }
        : null,
      shops,
    };
  }
}
