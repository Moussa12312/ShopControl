import { Global, Injectable, Module } from '@nestjs/common';
import { UserRole } from '@shopcontrol/shared';
import { ControlPrismaService } from '../../common/database/control-prisma.service';
import { ShopDatabaseManagerService } from '../../common/database/shop-database-manager.service';
import { computeAuditEntryHash } from '../../common/crypto/security.util';

export interface RecordControlAuditInput {
  merchantId?: string | null;
  shopId?: string | null;
  actorUserId?: string | null;
  actorRole?: UserRole | null;
  declaredOperatorId?: string | null;
  declaredOperatorName?: string | null;
  action: string;
  entityType: string;
  entityId?: string | null;
  beforeData?: unknown;
  afterData?: unknown;
  reason?: string | null;
  ipAddress?: string | null;
  userAgent?: string | null;
  correlationId?: string | null;
}

export interface RecordShopAuditInput {
  shopId: string;
  actorUserId?: string | null;
  actorRole?: string | null;
  declaredOperatorId?: string | null;
  declaredOperatorName?: string | null;
  action: string;
  entityType: string;
  entityId?: string | null;
  beforeData?: unknown;
  afterData?: unknown;
  reason?: string | null;
  ipAddress?: string | null;
  userAgent?: string | null;
  correlationId?: string | null;
}

export interface AuditListQuery {
  shopId?: string;
  action?: string;
  declaredOperatorId?: string;
  from?: string;
  to?: string;
  page?: number;
  limit?: number;
}

export interface NormalizedAuditEntry {
  id: string;
  source: 'CONTROL' | 'SHOP_DB';
  sequenceNumber: string;
  merchantId: string | null;
  shopId: string | null;
  shopName: string | null;
  actorUserId: string | null;
  actorName: string | null;
  actorRole: string | null;
  declaredOperatorId: string | null;
  declaredOperatorName: string | null;
  action: string;
  entityType: string;
  entityId: string | null;
  beforeData: unknown;
  afterData: unknown;
  reason: string | null;
  ipAddress: string | null;
  correlationId: string | null;
  entryHash: string;
  createdAt: string;
}

@Injectable()
export class AuditService {
  constructor(
    private readonly controlPrisma: ControlPrismaService,
    private readonly shopDbManager: ShopDatabaseManagerService,
  ) {}

  async recordControl(input: RecordControlAuditInput): Promise<void> {
    await this.controlPrisma.$transaction(async (tx) => {
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(7049001)`;
      const last = await tx.auditLog.findFirst({
        orderBy: { sequenceNumber: 'desc' },
        select: { entryHash: true },
      });
      const prevHash = last?.entryHash ?? 'GENESIS';
      const hashPayload = {
        merchantId: input.merchantId ?? null,
        shopId: input.shopId ?? null,
        actorUserId: input.actorUserId ?? null,
        actorRole: input.actorRole ?? null,
        declaredOperatorId: input.declaredOperatorId ?? null,
        declaredOperatorName: input.declaredOperatorName ?? null,
        action: input.action,
        entityType: input.entityType,
        entityId: input.entityId ?? null,
        beforeData: input.beforeData ?? null,
        afterData: input.afterData ?? null,
        reason: input.reason ?? null,
      };
      const entryHash = computeAuditEntryHash(prevHash, hashPayload);

      await tx.auditLog.create({
        data: {
          merchantId: input.merchantId ?? null,
          shopId: input.shopId ?? null,
          actorUserId: input.actorUserId ?? null,
          actorRole: input.actorRole ?? null,
          declaredOperatorId: input.declaredOperatorId ?? null,
          declaredOperatorName: input.declaredOperatorName ?? null,
          action: input.action,
          entityType: input.entityType,
          entityId: input.entityId ?? null,
          beforeData: (input.beforeData as object) ?? undefined,
          afterData: (input.afterData as object) ?? undefined,
          reason: input.reason ?? null,
          ipAddress: input.ipAddress ?? null,
          userAgent: input.userAgent?.slice(0, 500) ?? null,
          correlationId: input.correlationId ?? null,
          prevHash,
          entryHash,
        },
      });
    });
  }

  async recordShop(input: RecordShopAuditInput): Promise<void> {
    const shopClient = await this.shopDbManager.getClientForShop(input.shopId);
    await shopClient.$transaction(async (tx) => {
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(7049002)`;
      const last = await tx.shopAuditLog.findFirst({
        orderBy: { sequenceNumber: 'desc' },
        select: { entryHash: true },
      });
      const prevHash = last?.entryHash ?? 'GENESIS';
      const hashPayload = {
        actorUserId: input.actorUserId ?? null,
        actorRole: input.actorRole ?? null,
        declaredOperatorId: input.declaredOperatorId ?? null,
        declaredOperatorName: input.declaredOperatorName ?? null,
        action: input.action,
        entityType: input.entityType,
        entityId: input.entityId ?? null,
        beforeData: input.beforeData ?? null,
        afterData: input.afterData ?? null,
        reason: input.reason ?? null,
      };
      const entryHash = computeAuditEntryHash(prevHash, hashPayload);

      await tx.shopAuditLog.create({
        data: {
          actorUserId: input.actorUserId ?? null,
          actorRole: input.actorRole ?? null,
          declaredOperatorId: input.declaredOperatorId ?? null,
          declaredOperatorName: input.declaredOperatorName ?? null,
          action: input.action,
          entityType: input.entityType,
          entityId: input.entityId ?? null,
          beforeData: (input.beforeData as object) ?? undefined,
          afterData: (input.afterData as object) ?? undefined,
          reason: input.reason ?? null,
          ipAddress: input.ipAddress ?? null,
          userAgent: input.userAgent?.slice(0, 500) ?? null,
          correlationId: input.correlationId ?? null,
          prevHash,
          entryHash,
        },
      });
    });
  }

  async verifyControlChain(): Promise<{
    valid: boolean;
    checkedCount: number;
    brokenAtSequence: string | null;
  }> {
    const rows = await this.controlPrisma.auditLog.findMany({
      orderBy: { sequenceNumber: 'asc' },
    });

    let expectedPrev = 'GENESIS';
    for (const row of rows) {
      if (row.action === 'BOOTSTRAP_SUPER_ADMIN') {
        expectedPrev = row.entryHash;
        continue;
      }
      if (row.prevHash !== expectedPrev) {
        return {
          valid: false,
          checkedCount: rows.length,
          brokenAtSequence: row.sequenceNumber.toString(),
        };
      }
      const recomputed = computeAuditEntryHash(row.prevHash, {
        merchantId: row.merchantId ?? null,
        shopId: row.shopId ?? null,
        actorUserId: row.actorUserId ?? null,
        actorRole: row.actorRole ?? null,
        declaredOperatorId: row.declaredOperatorId ?? null,
        declaredOperatorName: row.declaredOperatorName ?? null,
        action: row.action,
        entityType: row.entityType,
        entityId: row.entityId ?? null,
        beforeData: row.beforeData ?? null,
        afterData: row.afterData ?? null,
        reason: row.reason ?? null,
      });
      if (recomputed !== row.entryHash) {
        return {
          valid: false,
          checkedCount: rows.length,
          brokenAtSequence: row.sequenceNumber.toString(),
        };
      }
      expectedPrev = row.entryHash;
    }

    return { valid: true, checkedCount: rows.length, brokenAtSequence: null };
  }

  async verifyShopChain(shopId: string): Promise<{
    shopId: string;
    valid: boolean;
    checkedCount: number;
    brokenAtSequence: string | null;
  }> {
    const shopClient = await this.shopDbManager.getClientForShop(shopId);
    const rows = await shopClient.shopAuditLog.findMany({
      orderBy: { sequenceNumber: 'asc' },
    });

    let expectedPrev = 'GENESIS';
    for (const row of rows) {
      if (row.prevHash !== expectedPrev) {
        return {
          shopId,
          valid: false,
          checkedCount: rows.length,
          brokenAtSequence: row.sequenceNumber.toString(),
        };
      }
      const recomputed = computeAuditEntryHash(row.prevHash, {
        actorUserId: row.actorUserId ?? null,
        actorRole: row.actorRole ?? null,
        declaredOperatorId: row.declaredOperatorId ?? null,
        declaredOperatorName: row.declaredOperatorName ?? null,
        action: row.action,
        entityType: row.entityType,
        entityId: row.entityId ?? null,
        beforeData: row.beforeData ?? null,
        afterData: row.afterData ?? null,
        reason: row.reason ?? null,
      });
      if (recomputed !== row.entryHash) {
        return {
          shopId,
          valid: false,
          checkedCount: rows.length,
          brokenAtSequence: row.sequenceNumber.toString(),
        };
      }
      expectedPrev = row.entryHash;
    }

    return { shopId, valid: true, checkedCount: rows.length, brokenAtSequence: null };
  }

  async listPlatformAuditLogs(query: AuditListQuery & { merchantId?: string }) {
    const page = Math.max(1, Number(query.page) || 1);
    const limit = Math.min(100, Math.max(1, Number(query.limit) || 25));

    const where: Record<string, unknown> = {};
    if (query.merchantId) where.merchantId = query.merchantId;
    if (query.shopId) where.shopId = query.shopId;
    if (query.action) where.action = query.action;
    if (query.from || query.to) {
      where.createdAt = {
        ...(query.from ? { gte: new Date(query.from) } : {}),
        ...(query.to ? { lte: new Date(query.to) } : {}),
      };
    }

    const [total, rows] = await Promise.all([
      this.controlPrisma.auditLog.count({ where }),
      this.controlPrisma.auditLog.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        skip: (page - 1) * limit,
        take: limit,
        include: {
          actor: { select: { fullName: true, email: true } },
          shop: { select: { name: true } },
        },
      }),
    ]);

    const items: NormalizedAuditEntry[] = rows.map((r) => ({
      id: r.id,
      source: 'CONTROL',
      sequenceNumber: r.sequenceNumber.toString(),
      merchantId: r.merchantId,
      shopId: r.shopId,
      shopName: r.shop?.name ?? null,
      actorUserId: r.actorUserId,
      actorName: r.actor?.fullName ?? null,
      actorRole: r.actorRole,
      declaredOperatorId: r.declaredOperatorId,
      declaredOperatorName: r.declaredOperatorName,
      action: r.action,
      entityType: r.entityType,
      entityId: r.entityId,
      beforeData: r.beforeData,
      afterData: r.afterData,
      reason: r.reason,
      ipAddress: r.ipAddress,
      correlationId: r.correlationId,
      entryHash: r.entryHash,
      createdAt: r.createdAt.toISOString(),
    }));

    return { items, total, page, limit };
  }

  async listMerchantAuditLogs(merchantId: string, query: AuditListQuery) {
    const page = Math.max(1, Number(query.page) || 1);
    const limit = Math.min(100, Math.max(1, Number(query.limit) || 25));
    const maxFetch = page * limit;

    const shops = await this.controlPrisma.shop.findMany({
      where: {
        merchantId,
        ...(query.shopId ? { id: query.shopId } : {}),
      },
      select: { id: true, name: true, dbStatus: true },
    });

    const shopNameMap = new Map(shops.map((s) => [s.id, s.name]));

    const dateFilter =
      query.from || query.to
        ? {
            ...(query.from ? { gte: new Date(query.from) } : {}),
            ...(query.to ? { lte: new Date(query.to) } : {}),
          }
        : undefined;

    const controlRows = await this.controlPrisma.auditLog.findMany({
      where: {
        merchantId,
        ...(query.shopId ? { shopId: query.shopId } : {}),
        ...(query.action ? { action: { contains: query.action, mode: 'insensitive' } } : {}),
        ...(query.declaredOperatorId ? { declaredOperatorId: query.declaredOperatorId } : {}),
        ...(dateFilter ? { createdAt: dateFilter } : {}),
      },
      orderBy: { createdAt: 'desc' },
      take: maxFetch,
      include: {
        actor: { select: { fullName: true } },
      },
    });

    const users = await this.controlPrisma.user.findMany({
      where: { merchantId },
      select: { id: true, fullName: true },
    });
    const userMap = new Map(users.map((u) => [u.id, u.fullName]));

    const shopEntriesLists = await Promise.all(
      shops
        .filter((s) => s.dbStatus === 'READY')
        .map(async (shop) => {
          const client = await this.shopDbManager.getClientForShop(shop.id);
          const rows = await client.shopAuditLog.findMany({
            where: {
              ...(query.action ? { action: { contains: query.action, mode: 'insensitive' } } : {}),
              ...(query.declaredOperatorId ? { declaredOperatorId: query.declaredOperatorId } : {}),
              ...(dateFilter ? { createdAt: dateFilter } : {}),
            },
            orderBy: { createdAt: 'desc' },
            take: maxFetch,
          });
          return rows.map<NormalizedAuditEntry>((r) => ({
            id: r.id,
            source: 'SHOP_DB',
            sequenceNumber: r.sequenceNumber.toString(),
            merchantId,
            shopId: shop.id,
            shopName: shop.name,
            actorUserId: r.actorUserId,
            actorName: r.actorUserId ? (userMap.get(r.actorUserId) ?? null) : null,
            actorRole: r.actorRole,
            declaredOperatorId: r.declaredOperatorId,
            declaredOperatorName: r.declaredOperatorName,
            action: r.action,
            entityType: r.entityType,
            entityId: r.entityId,
            beforeData: r.beforeData,
            afterData: r.afterData,
            reason: r.reason,
            ipAddress: r.ipAddress,
            correlationId: r.correlationId,
            entryHash: r.entryHash,
            createdAt: r.createdAt.toISOString(),
          }));
        }),
    );

    const controlNormalized: NormalizedAuditEntry[] = controlRows.map((r) => ({
      id: r.id,
      source: 'CONTROL',
      sequenceNumber: r.sequenceNumber.toString(),
      merchantId: r.merchantId,
      shopId: r.shopId,
      shopName: r.shopId ? (shopNameMap.get(r.shopId) ?? null) : null,
      actorUserId: r.actorUserId,
      actorName: r.actor?.fullName ?? null,
      actorRole: r.actorRole,
      declaredOperatorId: r.declaredOperatorId,
      declaredOperatorName: r.declaredOperatorName,
      action: r.action,
      entityType: r.entityType,
      entityId: r.entityId,
      beforeData: r.beforeData,
      afterData: r.afterData,
      reason: r.reason,
      ipAddress: r.ipAddress,
      correlationId: r.correlationId,
      entryHash: r.entryHash,
      createdAt: r.createdAt.toISOString(),
    }));

    const merged = [...controlNormalized, ...shopEntriesLists.flat()].sort(
      (a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime(),
    );

    const start = (page - 1) * limit;
    return {
      items: merged.slice(start, start + limit),
      total: merged.length,
      page,
      limit,
    };
  }
}

@Global()
@Module({
  providers: [AuditService],
  exports: [AuditService],
})
export class AuditCoreModule {}
