import * as fs from 'fs';
import * as path from 'path';
import * as crypto from 'crypto';
import { Client } from 'pg';

export interface ShopMigrationResult {
  latestVersion: string;
  appliedVersions: string[];
}

export function resolveShopMigrationsDir(): string {
  const candidates = [
    path.resolve(process.cwd(), 'prisma/shop/migrations'),
    path.resolve(process.cwd(), 'apps/api/prisma/shop/migrations'),
    path.resolve(__dirname, '../../../../prisma/shop/migrations'),
    path.resolve(__dirname, '../../../../../prisma/shop/migrations'),
  ];

  for (const dir of candidates) {
    if (fs.existsSync(dir) && fs.statSync(dir).isDirectory()) {
      return dir;
    }
  }
  throw new Error(
    `Impossible de localiser le répertoire prisma/shop/migrations (testé : ${candidates.join(', ')})`,
  );
}

/**
 * Applique de façon transactionnelle et idempotente toutes les migrations SQL versionnées
 * dans la base de données dédiée d'une boutique.
 */
export async function runShopMigrations(shopDatabaseUrl: string): Promise<ShopMigrationResult> {
  const migrationsDir = resolveShopMigrationsDir();
  const entries = fs
    .readdirSync(migrationsDir, { withFileTypes: true })
    .filter((d) => d.isDirectory())
    .map((d) => d.name)
    .sort();

  const client = new Client({ connectionString: shopDatabaseUrl });
  await client.connect();

  const appliedVersions: string[] = [];
  let latestVersion = '';

  try {
    await client.query('BEGIN');
    // Verrou consultatif empêchant deux migrations concurrentes sur la même base boutique
    await client.query('SELECT pg_advisory_xact_lock(7042026)');

    await client.query(`
      CREATE TABLE IF NOT EXISTS "_shop_schema_migrations" (
        "version" VARCHAR(80) PRIMARY KEY,
        "checksum" VARCHAR(64) NOT NULL,
        "applied_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP
      );
    `);

    const existingRows = await client.query<{ version: string; checksum: string }>(
      'SELECT version, checksum FROM "_shop_schema_migrations" ORDER BY version ASC',
    );
    const existingMap = new Map(existingRows.rows.map((r) => [r.version, r.checksum]));

    for (const version of entries) {
      const sqlPath = path.join(migrationsDir, version, 'migration.sql');
      if (!fs.existsSync(sqlPath)) {
        continue;
      }
      const sql = fs.readFileSync(sqlPath, 'utf8');
      const checksum = crypto.createHash('sha256').update(sql).digest('hex');

      const alreadyChecksum = existingMap.get(version);
      if (alreadyChecksum) {
        if (alreadyChecksum !== checksum) {
          throw new Error(
            `Checksum divergent détecté pour la migration boutique ${version}. Ne jamais modifier une migration déjà appliquée.`,
          );
        }
        latestVersion = version;
        continue;
      }

      await client.query(sql);
      await client.query(
        'INSERT INTO "_shop_schema_migrations" ("version", "checksum") VALUES ($1, $2)',
        [version, checksum],
      );
      appliedVersions.push(version);
      latestVersion = version;
    }

    await client.query('COMMIT');
    return { latestVersion, appliedVersions };
  } catch (err) {
    await client.query('ROLLBACK').catch(() => undefined);
    throw err;
  } finally {
    await client.end().catch(() => undefined);
  }
}
