import {
  Injectable,
  Logger,
  OnModuleDestroy,
  ServiceUnavailableException,
} from '@nestjs/common';
import { Client } from 'pg';
import { PrismaClient as ShopPrismaClient } from '../../generated/prisma-shop';
import { DEFAULT_EXPENSE_CATEGORY_NAMES } from '@shopcontrol/shared';
import { getEnv } from '../config/env.config';
import { ControlPrismaService } from './control-prisma.service';
import { runShopMigrations } from './shop-migration.runner';

const SAFE_PG_DB_NAME = /^[a-z][a-z0-9_]{3,58}$/;

interface PooledShopClient {
  client: ShopPrismaClient;
  dbName: string;
  lastUsedAt: number;
}

export interface ShopProvisionInput {
  id: string;
  merchantId: string;
  name: string;
  slug: string;
  dbName: string;
  shopType?: string;
  businessProfile?: unknown;
  currency: string;
  timezone: string;
  dailyReportTime: string;
  taxMode: string;
  defaultTaxRateBps: number;
  requireOperatorPin: boolean;
  paymentMethods: unknown;
  openingHours: unknown;
}

/**
 * Gère le cycle de vie des bases PostgreSQL dédiées par boutique :
 * - Provisionnement automatique (`CREATE DATABASE` + migrations SQL versionnées)
 * - Pool LRU borné de clients Prisma dédiés par boutique (isolation physique stricte)
 */
@Injectable()
export class ShopDatabaseManagerService implements OnModuleDestroy {
  private readonly logger = new Logger(ShopDatabaseManagerService.name);
  private readonly pool = new Map<string, PooledShopClient>();

  constructor(private readonly controlPrisma: ControlPrismaService) {}

  buildShopDatabaseName(shopId: string): string {
    const env = getEnv();
    const compactId = shopId.replace(/-/g, '').toLowerCase().slice(0, 20);
    const dbName = `${env.SHOP_DB_PREFIX}${compactId}`;
    this.assertSafeDatabaseName(dbName);
    return dbName;
  }

  assertSafeDatabaseName(dbName: string): void {
    if (!SAFE_PG_DB_NAME.test(dbName)) {
      throw new Error(`Nom de base de données boutique invalide : "${dbName}"`);
    }
  }

  buildShopDatabaseUrl(dbName: string, connectionLimit?: number): string {
    this.assertSafeDatabaseName(dbName);
    const env = getEnv();
    const limit = connectionLimit ?? env.SHOP_DB_CONNECTION_LIMIT;
    const encodedUser = encodeURIComponent(env.POSTGRES_USER);
    const encodedPass = encodeURIComponent(env.POSTGRES_PASSWORD);
    return `postgresql://${encodedUser}:${encodedPass}@${env.POSTGRES_HOST}:${env.POSTGRES_PORT}/${dbName}?schema=public&connection_limit=${limit}&pool_timeout=10`;
  }

  /**
   * Crée physiquement la base PostgreSQL de la boutique, applique toutes les migrations
   * versionnées (dont le trigger d'audit immuable), et initialise `shop_local_config`.
   */
  async provisionShopDatabase(input: ShopProvisionInput): Promise<{ dbName: string; schemaVersion: string }> {
    const env = getEnv();
    this.assertSafeDatabaseName(input.dbName);

    const adminClient = new Client({ connectionString: env.POSTGRES_ADMIN_URL });
    await adminClient.connect();
    try {
      const exists = await adminClient.query(
        'SELECT 1 FROM pg_database WHERE datname = $1',
        [input.dbName],
      );
      if (exists.rowCount === 0) {
        // Identifiant validé par regex stricte SAFE_PG_DB_NAME
        await adminClient.query(`CREATE DATABASE "${input.dbName}"`);
        this.logger.log(`Base de données boutique créée : ${input.dbName}`);
      }
    } finally {
      await adminClient.end().catch(() => undefined);
    }

    const migrationUrl = this.buildShopDatabaseUrl(input.dbName, 2);
    const { latestVersion } = await runShopMigrations(migrationUrl);

    const shopClient = this.createOrAttachClient(input.id, input.dbName);
    await shopClient.shopLocalConfig.upsert({
      where: { id: 'default' },
      create: {
        id: 'default',
        shopId: input.id,
        merchantId: input.merchantId,
        shopName: input.name,
        slug: input.slug,
        shopType: input.shopType || 'GENERAL',
        businessProfile: (input.businessProfile ?? {}) as object,
        currency: input.currency,
        timezone: input.timezone,
        dailyReportTime: input.dailyReportTime,
        taxMode: input.taxMode,
        defaultTaxRateBps: input.defaultTaxRateBps,
        requireOperatorPin: input.requireOperatorPin,
        paymentMethods: input.paymentMethods as object,
        openingHours: input.openingHours as object,
      },
      update: {
        shopName: input.name,
        slug: input.slug,
        ...(input.shopType ? { shopType: input.shopType } : {}),
        ...(input.businessProfile !== undefined
          ? { businessProfile: (input.businessProfile ?? {}) as object }
          : {}),
        currency: input.currency,
        timezone: input.timezone,
        dailyReportTime: input.dailyReportTime,
        taxMode: input.taxMode,
        defaultTaxRateBps: input.defaultTaxRateBps,
        requireOperatorPin: input.requireOperatorPin,
        paymentMethods: input.paymentMethods as object,
        openingHours: input.openingHours as object,
      },
    });

    // Initialise la caisse principale et les catégories de dépenses par défaut dans la BDD boutique
    await shopClient.cashRegister.upsert({
      where: { name: 'Caisse Principale' },
      create: { name: 'Caisse Principale', isActive: true },
      update: {},
    });

    for (const catName of DEFAULT_EXPENSE_CATEGORY_NAMES) {
      await shopClient.expenseCategory.upsert({
        where: { name: catName },
        create: { name: catName, isActive: true },
        update: {},
      });
    }

    return { dbName: input.dbName, schemaVersion: latestVersion };
  }

  /**
   * Retourne un client Prisma connecté EXCLUSIVEMENT à la base PostgreSQL dédiée de la boutique.
   */
  async getClientForShop(shopId: string): Promise<ShopPrismaClient> {
    const existing = this.pool.get(shopId);
    if (existing) {
      existing.lastUsedAt = Date.now();
      return existing.client;
    }

    const shop = await this.controlPrisma.shop.findUnique({
      where: { id: shopId },
      select: { id: true, dbName: true, dbStatus: true },
    });

    if (!shop) {
      throw new ServiceUnavailableException('Boutique introuvable ou base indisponible.');
    }

    if (shop.dbStatus !== 'READY') {
      throw new ServiceUnavailableException(
        `La base de données de cette boutique n’est pas encore prête (statut : ${shop.dbStatus}).`,
      );
    }

    return this.createOrAttachClient(shop.id, shop.dbName);
  }

  async syncShopLocalConfig(input: ShopProvisionInput): Promise<void> {
    const client = await this.getClientForShop(input.id);
    await client.shopLocalConfig.upsert({
      where: { id: 'default' },
      create: {
        id: 'default',
        shopId: input.id,
        merchantId: input.merchantId,
        shopName: input.name,
        slug: input.slug,
        shopType: input.shopType || 'GENERAL',
        businessProfile: (input.businessProfile ?? {}) as object,
        currency: input.currency,
        timezone: input.timezone,
        dailyReportTime: input.dailyReportTime,
        taxMode: input.taxMode,
        defaultTaxRateBps: input.defaultTaxRateBps,
        requireOperatorPin: input.requireOperatorPin,
        paymentMethods: input.paymentMethods as object,
        openingHours: input.openingHours as object,
      },
      update: {
        shopName: input.name,
        slug: input.slug,
        ...(input.shopType ? { shopType: input.shopType } : {}),
        ...(input.businessProfile !== undefined
          ? { businessProfile: (input.businessProfile ?? {}) as object }
          : {}),
        currency: input.currency,
        timezone: input.timezone,
        dailyReportTime: input.dailyReportTime,
        taxMode: input.taxMode,
        defaultTaxRateBps: input.defaultTaxRateBps,
        requireOperatorPin: input.requireOperatorPin,
        paymentMethods: input.paymentMethods as object,
        openingHours: input.openingHours as object,
      },
    });
  }

  async evictClient(shopId: string): Promise<void> {
    const entry = this.pool.get(shopId);
    if (entry) {
      this.pool.delete(shopId);
      await entry.client.$disconnect().catch(() => undefined);
    }
  }

  /**
   * Uniquement utilisé dans le nettoyage des tests automatisés (NODE_ENV === 'test').
   * Jamais exposé en production (une boutique suspendue ou résiliée conserve ses données).
   */
  async dropShopDatabaseForTest(dbName: string): Promise<void> {
    const env = getEnv();
    if (env.NODE_ENV !== 'test') {
      throw new Error('dropShopDatabaseForTest est strictement interdit hors environnement de test.');
    }
    this.assertSafeDatabaseName(dbName);

    for (const [shopId, entry] of this.pool.entries()) {
      if (entry.dbName === dbName) {
        await this.evictClient(shopId);
      }
    }

    const adminClient = new Client({ connectionString: env.POSTGRES_ADMIN_URL });
    await adminClient.connect();
    try {
      await adminClient.query(
        'SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE datname = $1 AND pid <> pg_backend_pid()',
        [dbName],
      );
      await adminClient.query(`DROP DATABASE IF EXISTS "${dbName}"`);
    } finally {
      await adminClient.end().catch(() => undefined);
    }
  }

  async onModuleDestroy(): Promise<void> {
    const disconnectOps = Array.from(this.pool.values()).map((entry) =>
      entry.client.$disconnect().catch(() => undefined),
    );
    this.pool.clear();
    await Promise.all(disconnectOps);
  }

  private createOrAttachClient(shopId: string, dbName: string): ShopPrismaClient {
    const existing = this.pool.get(shopId);
    if (existing && existing.dbName === dbName) {
      existing.lastUsedAt = Date.now();
      return existing.client;
    }

    const env = getEnv();
    if (this.pool.size >= env.SHOP_DB_MAX_POOLED_CLIENTS) {
      this.evictLeastRecentlyUsed();
    }

    const url = this.buildShopDatabaseUrl(dbName);
    const client = new ShopPrismaClient({
      datasources: { db: { url } },
    });

    this.pool.set(shopId, {
      client,
      dbName,
      lastUsedAt: Date.now(),
    });
    return client;
  }

  private evictLeastRecentlyUsed(): void {
    let oldestShopId: string | null = null;
    let oldestTime = Infinity;

    for (const [shopId, entry] of this.pool.entries()) {
      if (entry.lastUsedAt < oldestTime) {
        oldestTime = entry.lastUsedAt;
        oldestShopId = shopId;
      }
    }

    if (oldestShopId) {
      const removed = this.pool.get(oldestShopId);
      this.pool.delete(oldestShopId);
      removed?.client.$disconnect().catch(() => undefined);
    }
  }
}
