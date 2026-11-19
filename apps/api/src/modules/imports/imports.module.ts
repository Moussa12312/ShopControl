import * as crypto from 'crypto';
import {
  BadRequestException,
  Body,
  ConflictException,
  Controller,
  Get,
  Injectable,
  Module,
  NotFoundException,
  Param,
  Post,
  Req,
  UseGuards,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { csvImportSchema, ImportEntityType } from '@shopcontrol/shared';
import { CurrentUser, Roles } from '../../common/auth/auth.decorators';
import { AuthenticatedUser, RequestWithAuth } from '../../common/auth/request-context.types';
import { ShopDatabaseManagerService } from '../../common/database/shop-database-manager.service';
import { ShopScopeGuard } from '../../common/guards/shop-scope.guard';
import { ZodValidationPipe } from '../../common/validation/zod-validation.pipe';
import { AuditService } from '../audit/audit.service';
import { InventoryService } from '../inventory/inventory.module';
import { RequestMeta } from '../auth/auth.service';

export interface ParsedCsvRow {
  lineNumber: number;
  raw: Record<string, string>;
  normalized?: Record<string, unknown>;
  error?: string;
}

/**
 * Parseur CSV léger supportant délimiteurs `;` (Excel FR) et `,` ainsi que les guillemets.
 */
export function parseCsvRecords(csvContent: string): {
  headers: string[];
  rows: Array<{ lineNumber: number; values: Record<string, string> }>;
} {
  const clean = csvContent.replace(/^\uFEFF/, '').replace(/\r\n/g, '\n').trim();
  const lines = clean.split('\n').filter((l) => l.trim().length > 0);
  if (lines.length < 2) {
    throw new BadRequestException({
      code: 'CSV_EMPTY',
      message: 'Le fichier CSV doit contenir une ligne d’en-tête et au moins une ligne de données.',
    });
  }

  const headerLine = lines[0];
  const delimiter = headerLine.split(';').length >= headerLine.split(',').length ? ';' : ',';

  const splitLine = (line: string): string[] => {
    const out: string[] = [];
    let current = '';
    let inQuotes = false;
    for (let i = 0; i < line.length; i += 1) {
      const ch = line[i];
      if (ch === '"') {
        if (inQuotes && line[i + 1] === '"') {
          current += '"';
          i += 1;
        } else {
          inQuotes = !inQuotes;
        }
      } else if (ch === delimiter && !inQuotes) {
        out.push(current.trim());
        current = '';
      } else {
        current += ch;
      }
    }
    out.push(current.trim());
    return out;
  };

  const headers = splitLine(headerLine).map((h) => h.toLowerCase().trim());
  const rows = lines.slice(1).map((line, idx) => {
    const cells = splitLine(line);
    const values: Record<string, string> = {};
    headers.forEach((h, colIdx) => {
      values[h] = cells[colIdx] ?? '';
    });
    return { lineNumber: idx + 2, values };
  });

  return { headers, rows };
}

@Injectable()
export class ImportsService {
  constructor(
    private readonly shopDbManager: ShopDatabaseManagerService,
    private readonly inventoryService: InventoryService,
    private readonly auditService: AuditService,
  ) {}

  async preview(
    shopId: string,
    input: { entityType: ImportEntityType; csvContent: string; fileName?: string },
  ) {
    const { headers, rows } = parseCsvRecords(input.csvContent);
    const client = await this.shopDbManager.getClientForShop(shopId);

    const validated: ParsedCsvRow[] = [];

    if (input.entityType === 'PRODUCTS') {
      const existingSkus = new Set(
        (await client.product.findMany({ select: { sku: true } })).map((p) => p.sku.toLowerCase()),
      );
      const seenInFile = new Set<string>();

      for (const row of rows) {
        const name = row.values.nom || row.values.name || '';
        const sku = row.values.sku || row.values.reference || row.values.ref || '';
        const priceRaw = row.values.prix_vente || row.values.sale_price_xof || row.values.prix || '';
        const costRaw = row.values.cout_achat || row.values.cost_price_xof || row.values.cout || '';
        const stockRaw = row.values.stock_initial || row.values.stock || '0';
        const categoryName = row.values.categorie || row.values.category || '';
        const unit = row.values.unite || row.values.unit || 'unité';
        const thresholdRaw = row.values.seuil_alerte || row.values.alert_threshold || '5';
        const statusRaw = (row.values.statut || row.values.status || 'PUBLISHED').toUpperCase();

        const salePriceXof = Number(priceRaw);
        const costPriceXof = costRaw !== '' ? Number(costRaw) : null;
        const initialStock = Number(stockRaw || '0');
        const alertThreshold = Number(thresholdRaw || '5');

        let error: string | undefined;
        if (name.length < 2) error = 'Nom produit manquant ou trop court.';
        else if (!sku) error = 'Référence SKU obligatoire.';
        else if (existingSkus.has(sku.toLowerCase())) error = `SKU « ${sku} » déjà présent en base.`;
        else if (seenInFile.has(sku.toLowerCase())) error = `SKU « ${sku} » en doublon dans le fichier.`;
        else if (!Number.isInteger(salePriceXof) || salePriceXof < 0)
          error = 'Prix de vente XOF entier positif invalide.';
        else if (costPriceXof !== null && (!Number.isInteger(costPriceXof) || costPriceXof < 0))
          error = 'Coût d’achat XOF invalide.';
        else if (!Number.isInteger(initialStock) || initialStock < 0)
          error = 'Stock initial entier positif invalide.';
        else if (!Number.isInteger(alertThreshold) || alertThreshold < 0)
          error = 'Seuil d’alerte invalide.';

        if (!error) seenInFile.add(sku.toLowerCase());

        validated.push({
          lineNumber: row.lineNumber,
          raw: row.values,
          error,
          normalized: error
            ? undefined
            : {
                name,
                sku,
                barcode: row.values.code_barres || row.values.barcode || null,
                categoryName: categoryName || null,
                unit,
                salePriceXof,
                costPriceXof,
                initialStock,
                alertThreshold,
                status: ['DRAFT', 'PUBLISHED', 'UNAVAILABLE'].includes(statusRaw)
                  ? statusRaw
                  : 'PUBLISHED',
              },
        });
      }
    } else if (input.entityType === 'SUPPLIERS') {
      for (const row of rows) {
        const name = row.values.nom || row.values.name || '';
        const error = name.length < 2 ? 'Nom du fournisseur requis.' : undefined;
        validated.push({
          lineNumber: row.lineNumber,
          raw: row.values,
          error,
          normalized: error
            ? undefined
            : {
                name,
                phone: row.values.telephone || row.values.phone || null,
                email: row.values.email || null,
                address: row.values.adresse || row.values.address || null,
              },
        });
      }
    } else if (input.entityType === 'CLIENTS') {
      const existingPhones = new Set(
        (await client.client.findMany({ select: { phone: true } })).map((c) => c.phone),
      );
      const seenPhones = new Set<string>();

      for (const row of rows) {
        const fullName = row.values.nom || row.values.full_name || row.values.name || '';
        const phone = row.values.telephone || row.values.phone || '';
        const creditLimit = Number(row.values.plafond_credit || row.values.credit_limit_xof || '0');

        let error: string | undefined;
        if (fullName.length < 2) error = 'Nom du client requis.';
        else if (phone.length < 6) error = 'Numéro de téléphone invalide.';
        else if (existingPhones.has(phone)) error = `Téléphone « ${phone} » déjà existant.`;
        else if (seenPhones.has(phone)) error = `Téléphone « ${phone} » en doublon dans le fichier.`;
        else if (!Number.isInteger(creditLimit) || creditLimit < 0)
          error = 'Plafond crédit XOF invalide.';

        if (!error) seenPhones.add(phone);

        validated.push({
          lineNumber: row.lineNumber,
          raw: row.values,
          error,
          normalized: error
            ? undefined
            : {
                fullName,
                phone,
                email: row.values.email || null,
                address: row.values.adresse || row.values.address || null,
                creditLimitXof: creditLimit,
              },
        });
      }
    }

    const validRows = validated.filter((v) => !v.error);
    const errorRows = validated.filter((v) => Boolean(v.error));

    return {
      entityType: input.entityType,
      fileName: input.fileName || 'import.csv',
      headers,
      totalRows: validated.length,
      validCount: validRows.length,
      errorCount: errorRows.length,
      preview: validated.slice(0, 100),
      errors: errorRows.map((e) => ({ lineNumber: e.lineNumber, message: e.error! })),
    };
  }

  /**
   * Exécute l'import des lignes valides dans la base dédiée de la boutique
   * et enregistre le lot `ImportBatch` pour permettre une annulation (rollback, Section 2.2).
   */
  async commit(
    shopId: string,
    input: { entityType: ImportEntityType; csvContent: string; fileName?: string },
    actor: AuthenticatedUser,
    meta: RequestMeta,
  ) {
    const preview = await this.preview(shopId, input);
    const validItems = preview.preview.filter((r) => !r.error && r.normalized);
    if (validItems.length === 0) {
      throw new BadRequestException({
        code: 'IMPORT_NO_VALID_ROWS',
        message: 'Aucune ligne valide à importer. Corrigez les erreurs indiquées dans l’aperçu.',
        errors: preview.errors.map((e) => ({ path: `ligne ${e.lineNumber}`, message: e.message })),
      });
    }

    const client = await this.shopDbManager.getClientForShop(shopId);
    const batchId = crypto.randomUUID();

    const batch = await client.$transaction(async (tx) => {
      const createdIds: string[] = [];

      if (input.entityType === 'PRODUCTS') {
        const categoryCache = new Map<string, string>();
        const existingCats = await tx.category.findMany();
        for (const c of existingCats) categoryCache.set(c.name.toLowerCase(), c.id);

        for (const row of validItems) {
          const d = row.normalized as any;
          let categoryId: string | null = null;
          if (d.categoryName) {
            const key = String(d.categoryName).toLowerCase();
            if (categoryCache.has(key)) {
              categoryId = categoryCache.get(key)!;
            } else {
              const cat = await tx.category.create({ data: { name: d.categoryName } });
              categoryCache.set(key, cat.id);
              categoryId = cat.id;
            }
          }

          const prod = await tx.product.create({
            data: {
              name: d.name,
              sku: d.sku,
              barcode: d.barcode,
              categoryId,
              unit: d.unit,
              salePriceXof: d.salePriceXof,
              costPriceXof: d.costPriceXof,
              alertThreshold: d.alertThreshold,
              status: d.status,
              importBatchId: batchId,
            },
          });
          createdIds.push(prod.id);

          if (d.initialStock > 0) {
            await this.inventoryService.applyMovementInTx(tx, {
              productId: prod.id,
              movementType: 'INITIAL_IMPORT',
              quantityDelta: d.initialStock,
              unitCostXof: d.costPriceXof,
              referenceType: 'CSV_IMPORT',
              referenceId: batchId,
              reason: `Import CSV (${preview.fileName})`,
              actorUserId: actor.userId,
            });
          }
        }
      } else if (input.entityType === 'SUPPLIERS') {
        for (const row of validItems) {
          const d = row.normalized as any;
          const sup = await tx.supplier.create({
            data: {
              name: d.name,
              phone: d.phone,
              email: d.email,
              address: d.address,
              importBatchId: batchId,
            },
          });
          createdIds.push(sup.id);
        }
      } else if (input.entityType === 'CLIENTS') {
        for (const row of validItems) {
          const d = row.normalized as any;
          const cl = await tx.client.create({
            data: {
              fullName: d.fullName,
              phone: d.phone,
              email: d.email,
              address: d.address,
              creditLimitXof: d.creditLimitXof,
              importBatchId: batchId,
            },
          });
          createdIds.push(cl.id);
        }
      }

      return tx.importBatch.create({
        data: {
          id: batchId,
          entityType: input.entityType,
          fileName: preview.fileName,
          totalRows: preview.totalRows,
          importedCount: createdIds.length,
          errorCount: preview.errorCount,
          status: 'COMMITTED',
          createdEntityIds: createdIds,
          actorUserId: actor.userId,
        },
      });
    });

    await this.auditService.recordShop({
      shopId,
      actorUserId: actor.userId,
      actorRole: actor.role,
      action: 'CSV_IMPORT_COMMITTED',
      entityType: 'ImportBatch',
      entityId: batch.id,
      afterData: {
        entityType: batch.entityType,
        fileName: batch.fileName,
        importedCount: batch.importedCount,
        errorCount: batch.errorCount,
      },
      ipAddress: meta.ipAddress,
      userAgent: meta.userAgent,
      correlationId: meta.correlationId,
    });

    return {
      batch,
      errors: preview.errors,
    };
  }

  async listBatches(shopId: string) {
    const client = await this.shopDbManager.getClientForShop(shopId);
    const batches = await client.importBatch.findMany({
      orderBy: { createdAt: 'desc' },
      take: 30,
    });
    return batches.map((b) => ({
      ...b,
      rolledBackAt: b.rolledBackAt?.toISOString() ?? null,
      createdAt: b.createdAt.toISOString(),
    }));
  }

  /**
   * Annulation propre d'un import CSV (Section 2.2) :
   * - Pour les produits : passe les produits importés en `ARCHIVED` et annule le stock restant par mouvement inverse tracé.
   * - Pour fournisseurs/clients : désactive ou bloque les fiches créées (sans détruire d'éventuelles références historiques).
   */
  async rollbackBatch(
    shopId: string,
    batchId: string,
    actor: AuthenticatedUser,
    meta: RequestMeta,
  ) {
    const client = await this.shopDbManager.getClientForShop(shopId);

    const updated = await client.$transaction(async (tx) => {
      const batch = await tx.importBatch.findUnique({ where: { id: batchId } });
      if (!batch) {
        throw new NotFoundException({ code: 'IMPORT_BATCH_NOT_FOUND', message: 'Lot d’import introuvable.' });
      }
      if (batch.status === 'ROLLED_BACK') {
        throw new ConflictException({
          code: 'IMPORT_ALREADY_ROLLED_BACK',
          message: 'Ce lot d’import a déjà été annulé.',
        });
      }

      const ids = Array.isArray(batch.createdEntityIds) ? (batch.createdEntityIds as string[]) : [];

      if (batch.entityType === 'PRODUCTS' && ids.length > 0) {
        for (const prodId of ids) {
          const bal = await tx.stockBalance.findUnique({
            where: { productId_variantKey: { productId: prodId, variantKey: 'BASE' } },
          });
          if (bal && bal.physicalQty > 0) {
            await this.inventoryService.applyMovementInTx(tx, {
              productId: prodId,
              movementType: 'MANUAL_OUT',
              quantityDelta: -bal.physicalQty,
              referenceType: 'CSV_IMPORT_ROLLBACK',
              referenceId: batchId,
              reason: `Annulation lot import CSV ${batch.fileName || batchId}`,
              actorUserId: actor.userId,
            });
          }
          await tx.product.updateMany({
            where: { id: prodId },
            data: { status: 'ARCHIVED' },
          });
        }
      } else if (batch.entityType === 'SUPPLIERS' && ids.length > 0) {
        await tx.supplier.updateMany({
          where: { id: { in: ids } },
          data: { isActive: false },
        });
      } else if (batch.entityType === 'CLIENTS' && ids.length > 0) {
        await tx.client.updateMany({
          where: { id: { in: ids } },
          data: { isBlocked: true, notes: 'Annulé suite rollback import CSV' },
        });
      }

      return tx.importBatch.update({
        where: { id: batchId },
        data: { status: 'ROLLED_BACK', rolledBackAt: new Date() },
      });
    });

    await this.auditService.recordShop({
      shopId,
      actorUserId: actor.userId,
      actorRole: actor.role,
      action: 'CSV_IMPORT_ROLLED_BACK',
      entityType: 'ImportBatch',
      entityId: batchId,
      reason: `Annulation du lot d’import ${updated.fileName || batchId}`,
      ipAddress: meta.ipAddress,
      userAgent: meta.userAgent,
      correlationId: meta.correlationId,
    });

    return updated;
  }
}

@ApiTags('Import CSV')
@ApiBearerAuth()
@Controller('shops/:shopId/imports')
@UseGuards(ShopScopeGuard)
@Roles('OWNER')
export class ImportsController {
  constructor(private readonly importsService: ImportsService) {}

  @Get()
  @ApiOperation({ summary: 'Historique des lots d’import CSV de la boutique' })
  list(@Param('shopId') shopId: string) {
    return this.importsService.listBatches(shopId);
  }

  @Post('preview')
  @ApiOperation({ summary: 'Prévisualiser et valider ligne par ligne un fichier CSV avant import' })
  preview(
    @Param('shopId') shopId: string,
    @Body(new ZodValidationPipe(csvImportSchema))
    body: { entityType: ImportEntityType; csvContent: string; fileName?: string },
  ) {
    return this.importsService.preview(shopId, body);
  }

  @Post('commit')
  @ApiOperation({ summary: 'Importer les lignes valides dans la base dédiée de la boutique' })
  commit(
    @Param('shopId') shopId: string,
    @Body(new ZodValidationPipe(csvImportSchema))
    body: { entityType: ImportEntityType; csvContent: string; fileName?: string },
    @CurrentUser() user: AuthenticatedUser,
    @Req() req: RequestWithAuth,
  ) {
    return this.importsService.commit(shopId, body, user, {
      ipAddress: req.ip || null,
      userAgent: req.header('user-agent') || null,
      correlationId: req.correlationId || null,
    });
  }

  @Post(':batchId/rollback')
  @ApiOperation({ summary: 'Annuler proprement un lot d’import CSV (mouvements inverses & archivage)' })
  rollback(
    @Param('shopId') shopId: string,
    @Param('batchId') batchId: string,
    @CurrentUser() user: AuthenticatedUser,
    @Req() req: RequestWithAuth,
  ) {
    return this.importsService.rollbackBatch(shopId, batchId, user, {
      ipAddress: req.ip || null,
      userAgent: req.header('user-agent') || null,
      correlationId: req.correlationId || null,
    });
  }
}

@Module({
  controllers: [ImportsController],
  providers: [ImportsService],
})
export class ImportsModule {}
